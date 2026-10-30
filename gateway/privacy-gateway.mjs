import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { scanOutbound } from './leak-scanner.mjs';

const host = process.env.APS_HOST || '127.0.0.1';
const port = Number(process.env.APS_PORT || '7788');
const upstream = new URL(process.env.APS_UPSTREAM || 'https://api.anthropic.com');
const maxBody = Number(process.env.APS_MAX_BODY || String(64 * 1024 * 1024));

let extraTerms = [];
try {
  const parsed = JSON.parse(process.env.APS_DENY_TERMS_JSON || '[]');
  if (Array.isArray(parsed)) extraTerms = parsed.filter(x => typeof x === 'string' && x.trim().length >= 3);
} catch {
  console.error('[agent-privacy-shield] invalid APS_DENY_TERMS_JSON; hard gateway will use built-in leak patterns only');
}

if (!['https:', 'http:'].includes(upstream.protocol)) {
  throw new Error(`Unsupported upstream protocol: ${upstream.protocol}`);
}
if (upstream.hostname === host && Number(upstream.port || (upstream.protocol === 'https:' ? 443 : 80)) === port) {
  throw new Error('Privacy gateway upstream points back to itself.');
}

function joinPath(basePath, reqPath) {
  const a = (basePath || '').replace(/\/$/, '');
  const b = (reqPath || '/').startsWith('/') ? reqPath : `/${reqPath}`;
  return `${a}${b}` || '/';
}

function safeHeaders(headers, bodyLength) {
  const out = { ...headers };
  delete out.host;
  delete out['content-length'];
  delete out.connection;
  delete out['proxy-connection'];
  delete out['transfer-encoding'];
  out['content-length'] = String(bodyLength);
  out.host = upstream.host;
  return out;
}

function sendJson(res, status, obj) {
  const body = Buffer.from(JSON.stringify(obj));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store'
  });
  res.end(body);
}

const server = http.createServer((req, res) => {
  const chunks = [];
  let size = 0;
  req.on('data', chunk => {
    size += chunk.length;
    if (size > maxBody) {
      req.destroy(new Error('request body too large for Agent Privacy Shield gateway'));
      return;
    }
    chunks.push(chunk);
  });

  req.on('error', err => {
    if (!res.headersSent) sendJson(res, 413, { error: { type: 'privacy_gateway_error', message: String(err.message || err) } });
  });

  req.on('end', () => {
    const body = Buffer.concat(chunks);
    const contentType = String(req.headers['content-type'] || '');
    if (body.length && /json|text|x-www-form-urlencoded/i.test(contentType)) {
      const kinds = scanOutbound(body.toString('utf8'), extraTerms);
      if (kinds.length) {
        console.error(`[agent-privacy-shield] BLOCKED outbound request: ${kinds.join(', ')}`);
        sendJson(res, 451, {
          error: {
            type: 'privacy_shield_blocked',
            message: `Agent Privacy Shield blocked an outbound request because unsanitized sensitive data remained (${kinds.join(', ')}).`
          }
        });
        return;
      }
    }

    const client = upstream.protocol === 'https:' ? https : http;
    const options = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || undefined,
      method: req.method,
      path: joinPath(upstream.pathname, req.url),
      headers: safeHeaders(req.headers, body.length)
    };

    const upstreamReq = client.request(options, upstreamRes => {
      const responseHeaders = { ...upstreamRes.headers };
      delete responseHeaders.connection;
      delete responseHeaders['transfer-encoding'];
      delete responseHeaders['content-length'];
      res.writeHead(upstreamRes.statusCode || 502, responseHeaders);
      upstreamRes.on('data', chunk => {
        res.write(chunk);
        if (typeof res.flushHeaders === 'function') res.flushHeaders();
      });
      upstreamRes.on('end', () => res.end());
      upstreamRes.on('error', err => res.destroy(err));
    });

    upstreamReq.on('error', err => {
      if (!res.headersSent) {
        sendJson(res, 502, { error: { type: 'privacy_gateway_upstream_error', message: String(err.message || err) } });
      } else {
        res.destroy(err);
      }
    });

    if (body.length) upstreamReq.write(body);
    upstreamReq.end();
  });
});

server.listen(port, host, () => {
  console.error(`[agent-privacy-shield] hard gateway listening on http://${host}:${port} -> ${upstream.origin}${upstream.pathname === '/' ? '' : upstream.pathname}`);
});

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)));
}
