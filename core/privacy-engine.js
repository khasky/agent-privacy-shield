const TECHNICAL_MARKERS = new Set([
  'src', 'source', 'sources', 'lib', 'libs', 'app', 'apps', 'packages', 'pkg',
  'docs', 'doc', 'test', 'tests', 'spec', 'specs', 'scripts', 'tools', 'assets',
  'content', 'config', 'configs', 'include', 'public', 'server', 'client', 'backend',
  'frontend', 'engine', 'plugins', 'modules', 'components', 'features', 'api'
]);

const KNOWN_PATH_KINDS = ['PROJECT_ROOT', 'PROJECT_SLUG', 'HOME', 'TEMP', 'GIT_REMOTE', 'HOST'];
const SCALAR_KINDS = ['PROJECT_NAME', 'LOCAL_USER', 'GIT_ORG', 'REPO_NAME', 'HOSTNAME'];
const KNOWN_KINDS = [...KNOWN_PATH_KINDS, ...SCALAR_KINDS];
const PATH_KINDS = [...KNOWN_PATH_KINDS, 'EXTERNAL_ROOT', 'UNC_ROOT'];
// A scalar seen in a casing other than its canonical one gets its own alias so it restores exactly.
const VARIANT_KIND = 'SCALAR_VARIANT';

const SECRET_PATTERNS = [
  { name: 'private-key', re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g },
  { name: 'anthropic-key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/g },
  { name: 'openai-key', re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g },
  { name: 'github-token', re: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g },
  { name: 'aws-access-key', re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: 'google-api-key', re: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { name: 'jwt', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: 'bearer-token', re: /(?<=\bBearer\s+)[A-Za-z0-9._~+/-]{16,}=*/g },
  { name: 'url-credentials', re: /(?<=\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(?=@)/g }
];

// Quoted literal without whitespace, or a bare token that is not an identifier, call or member access.
const SENSITIVE_ASSIGNMENT_RE = /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password|passwd|pwd|client[_-]?secret|private[_-]?key)\b(\s*[:=]\s*)(?:(["'])([^\s"']{8,})\3|([A-Za-z0-9_\-+/=]{8,})(?![\w(.[]))/gi;
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const FILE_EXTENSION_TLDS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'ico', 'bmp', 'avif', 'tgz', 'gz', 'zip', 'tar',
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'css', 'scss', 'json', 'map', 'md', 'txt', 'yml', 'yaml',
  'xml', 'html', 'wasm', 'lock'
]);
const PRIVATE_IP_RE = /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/g;
const WIN_QUOTED_PATH_RE = /(["'])([A-Za-z]:[\\/][^"'\r\n]+)\1/g;
// A drive letter not glued to a word, path or regex body (`/a:\d/`); `file:///C:/` still counts.
// Spaces are allowed inside a component only when another separator follows it.
const WIN_BARE_PATH_RE = /(?<![\w\\.:-])(?<=^|[^/]|\/\/\/)[A-Za-z]:[\\/](?:[^\s<>"'|?*\\/:]+(?: +[^\s<>"'|?*\\/:]+)*[\\/])*[^\s<>"'|?*\\/:]*/g;
const UNC_BARE_PATH_RE = /\\\\[^\s\\/]+[\\/][^\s<>"'|?*]+(?:[\\/][^\s<>"'|?*]+)*/g;
const POSIX_PATH_RE = /(^|[\s("'`])\/(?:Users|home|root|mnt|srv|opt|var|tmp)\/[A-Za-z0-9._~+@%:/\\-]+/g;
const SECRET_ALIAS_RE = /<SECRET_\d+>/;
const DYNAMIC_ALIAS_RE = /<[A-Z_]+_[0-9a-f]{10}>/g;

function cloneJson(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(cloneJson);
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = cloneJson(v);
    return out;
  }
  return value;
}

function replaceAllInsensitive(text, needle, replacement) {
  if (!needle || needle === replacement) return text;
  const lower = text.toLowerCase();
  const n = needle.toLowerCase();
  let at = 0;
  let out = '';
  let hit = lower.indexOf(n, at);
  if (hit < 0) return text;
  while (hit >= 0) {
    out += text.slice(at, hit) + replacement;
    at = hit + needle.length;
    hit = lower.indexOf(n, at);
  }
  return out + text.slice(at);
}

function normalizeSlashes(s) {
  return s.replace(/\\/g, '/');
}

function stripTrailingSlash(s) {
  if (/^[A-Za-z]:[\\/]$/.test(s)) return s;
  return s.replace(/[\\/]+$/, '');
}

function looksLikeFile(component) {
  return /\.[A-Za-z0-9]{1,12}$/.test(component);
}

function splitPath(path) {
  const sep = path.includes('\\') ? '\\' : '/';
  const normalized = path.replace(/[\\/]+/g, sep);
  return { sep, parts: normalized.split(sep).filter(Boolean) };
}

function pathPrefixForExternal(path) {
  const { sep, parts } = splitPath(path);
  if (parts.length <= 1) return { prefix: path, tail: '' };

  let markerIndex = -1;
  for (let i = 0; i < parts.length; i += 1) {
    if (TECHNICAL_MARKERS.has(parts[i].toLowerCase())) {
      markerIndex = i;
      break;
    }
  }

  let prefixCount;
  if (markerIndex > 0) {
    prefixCount = markerIndex;
  } else if (looksLikeFile(parts.at(-1) ?? '')) {
    prefixCount = Math.max(1, parts.length - 1);
  } else {
    prefixCount = parts.length;
  }

  const isWindowsDrive = /^[A-Za-z]:$/.test(parts[0]);
  const leading = path.startsWith('\\\\') ? '\\\\' : (path.startsWith('/') ? '/' : '');
  const prefixBody = parts.slice(0, prefixCount).join(sep);
  const prefix = isWindowsDrive ? prefixBody : leading + prefixBody;
  const tailParts = parts.slice(prefixCount);
  const tail = tailParts.length ? sep + tailParts.join(sep) : '';
  return { prefix, tail };
}

function isSafeExampleEmail(email) {
  const lower = email.toLowerCase();
  return lower.endsWith('@example.com') || lower.endsWith('@example.org') || lower.endsWith('@example.net') || lower.endsWith('@test.invalid');
}

function looksLikeFileName(email) {
  return FILE_EXTENSION_TLDS.has(email.slice(email.lastIndexOf('.') + 1).toLowerCase());
}

function stablePathVariants(path) {
  const p = stripTrailingSlash(path);
  return [...new Set([p, p.replace(/\\/g, '/'), p.replace(/\//g, '\\')])].filter(Boolean);
}

function basenameAny(path) {
  const p = stripTrailingSlash(String(path || ''));
  const parts = p.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) || '';
}

function parseGitRemote(remote) {
  const raw = String(remote || '').trim();
  if (!raw) return {};
  let path = '';
  if (/^[^@\s]+@[^:]+:.+/.test(raw)) {
    path = raw.slice(raw.indexOf(':') + 1);
  } else {
    try {
      path = new URL(raw).pathname.replace(/^\/+/, '');
    } catch {
      path = raw;
    }
  }
  path = path.replace(/\.git$/i, '').replace(/^\/+|\/+$/g, '');
  const parts = path.split('/').filter(Boolean);
  if (!parts.length) return {};
  return {
    repo: parts.at(-1) || '',
    org: parts.length > 1 ? parts.at(-2) || '' : ''
  };
}

// "-" counts as a boundary so kebab-case compounds such as "acme-tools" do not leak "acme".
function scalarRegExp(needle, flags) {
  const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_])${escaped}(?![A-Za-z0-9_])`, flags);
}

function containsScalarInsensitive(text, needle) {
  if (!needle || needle.length < 3) return false;
  return scalarRegExp(needle, 'i').test(text);
}

function titleCase(s) {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function randomSuffix() {
  const bytes = new Uint8Array(5);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}

function mappingKey(kind, real) {
  if (kind === VARIANT_KIND) return `${VARIANT_KIND}:${real}`;
  if (kind === 'EMAIL') return String(real).toLowerCase();
  return normalizeSlashes(String(real)).toLowerCase();
}

export function containsMaskedSecret(value) {
  return SECRET_ALIAS_RE.test(typeof value === 'string' ? value : JSON.stringify(value ?? ''));
}

export function fingerprint(text) {
  // FNV-1a 32-bit. This is only a non-secret local store key, not cryptography.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

export class PrivacyEngine {
  #loadPersisted;

  constructor({ projectRoot, cwd, home, temp, computerName, gitRemote, persisted, loadPersisted } = {}) {
    this.projectRoot = stripTrailingSlash(projectRoot || cwd || '');
    this.cwd = stripTrailingSlash(cwd || this.projectRoot || '');
    this.home = stripTrailingSlash(home || '');
    this.temp = stripTrailingSlash(temp || '');
    this.computerName = computerName || '';
    this.gitRemote = gitRemote || '';
    this.reversible = [];
    this.scalars = [];
    this.aliasToReal = new Map();
    this.realToAlias = new Map();
    this.secretAliases = new Map();
    this.secretCount = 0;
    this.seenKinds = new Set();
    this.stats = { stringsChanged: 0, secretsMasked: 0, dynamicAliases: 0 };
    this.dirty = false;
    this.#loadPersisted = typeof loadPersisted === 'function' ? loadPersisted : null;

    this.#installKnownMappings();
    if (persisted && typeof persisted === 'object') this.mergeState(persisted);
  }

  #installKnownMappings() {
    if (this.projectRoot) this.#addMapping(this.projectRoot, '<PROJECT_ROOT>', 'PROJECT_ROOT');
    // Agents name per-project state folders after the root with every non-alphanumeric turned into "-".
    const slug = this.projectRoot.replace(/[^A-Za-z0-9]/g, '-');
    if (slug.length >= 3 && slug !== this.projectRoot) this.#addMapping(slug, '<PROJECT_ROOT_SLUG>', 'PROJECT_SLUG');
    if (this.home && !this.#samePath(this.home, this.projectRoot)) this.#addMapping(this.home, '<HOME>', 'HOME');
    if (this.temp && !this.#samePath(this.temp, this.projectRoot) && !this.#samePath(this.temp, this.home)) this.#addMapping(this.temp, '<TEMP>', 'TEMP');
    if (this.gitRemote) this.#addMapping(this.gitRemote, '<GIT_REMOTE>', 'GIT_REMOTE');
    if (this.computerName && this.computerName.length >= 3) this.#addMapping(`\\\\${this.computerName}\\`, '<HOST>\\', 'HOST');

    const projectName = basenameAny(this.projectRoot);
    const localUser = basenameAny(this.home);
    const { org: gitOrg = '', repo: gitRepo = '' } = parseGitRemote(this.gitRemote);
    const seen = new Set();
    const addScalar = (real, kind) => {
      if (real.length < 3 || seen.has(real.toLowerCase())) return;
      seen.add(real.toLowerCase());
      const alias = `<${kind}>`;
      const scalar = { kind, real, alias, re: scalarRegExp(real, 'gi') };
      this.scalars.push(scalar);
      this.aliasToReal.set(alias, real);
      // Common casings restore deterministically without the vault.
      for (const [suffix, variant] of [['LOWER', real.toLowerCase()], ['UPPER', real.toUpperCase()], ['TITLE', titleCase(real)]]) {
        if (variant === real) continue;
        const variantAlias = `<${kind}_${suffix}>`;
        if (this.aliasToReal.has(variantAlias)) continue;
        this.realToAlias.set(mappingKey(VARIANT_KIND, variant), variantAlias);
        this.aliasToReal.set(variantAlias, variant);
      }
    };
    addScalar(projectName, 'PROJECT_NAME');
    addScalar(localUser, 'LOCAL_USER');
    addScalar(gitOrg, 'GIT_ORG');
    addScalar(gitRepo, 'REPO_NAME');
    addScalar(this.computerName, 'HOSTNAME');
    this.scalars.sort((a, b) => b.real.length - a.real.length);
  }

  #samePath(a, b) {
    if (!a || !b) return false;
    return normalizeSlashes(stripTrailingSlash(a)).toLowerCase() === normalizeSlashes(stripTrailingSlash(b)).toLowerCase();
  }

  #addMapping(real, alias, kind) {
    if (!real || !alias || real === alias) return alias;
    const canonical = String(real);
    const key = mappingKey(kind, canonical);
    if (this.realToAlias.has(key)) return this.realToAlias.get(key);
    if (this.aliasToReal.has(alias)) return null;
    this.reversible.push({ real: canonical, alias, kind });
    this.realToAlias.set(key, alias);
    this.aliasToReal.set(alias, canonical);
    this.reversible.sort((a, b) => b.real.length - a.real.length);
    return alias;
  }

  #ensureLoaded() {
    if (!this.#loadPersisted) return;
    const load = this.#loadPersisted;
    this.#loadPersisted = null;
    const state = load();
    if (state && typeof state === 'object') this.mergeState(state);
  }

  #aliasFor(kind, real) {
    const key = mappingKey(kind, real);
    if (!this.realToAlias.has(key)) this.#ensureLoaded();
    const existing = this.realToAlias.get(key);
    if (existing) return existing;
    const prefix = kind === VARIANT_KIND ? this.#variantPrefix(real) : kind;
    let alias;
    do alias = `<${prefix}_${randomSuffix()}>`; while (this.aliasToReal.has(alias));
    this.#addMapping(String(real), alias, kind);
    this.dirty = true;
    this.stats.dynamicAliases += 1;
    return alias;
  }

  #variantPrefix(real) {
    const scalar = this.scalars.find(s => s.real.toLowerCase() === real.toLowerCase());
    return scalar ? scalar.kind : 'SCALAR';
  }

  #secretAlias(value) {
    this.stats.secretsMasked += 1;
    this.seenKinds.add('SECRET');
    const existing = this.secretAliases.get(value);
    if (existing) return existing;
    this.secretCount += 1;
    const alias = `<SECRET_${this.secretCount}>`;
    this.secretAliases.set(value, alias);
    return alias;
  }

  mergeState(state) {
    if (!state || !Array.isArray(state.dynamicMappings)) return;
    for (const row of state.dynamicMappings) {
      if (!row || typeof row.real !== 'string' || typeof row.alias !== 'string') continue;
      this.#addMapping(row.real, row.alias, row.kind || 'DYNAMIC');
    }
  }

  exportState() {
    return {
      version: 2,
      dynamicMappings: this.reversible
        .filter(row => !KNOWN_KINDS.includes(row.kind))
        .map(row => ({ real: row.real, alias: row.alias, kind: row.kind }))
    };
  }

  consumeDirty() {
    const wasDirty = this.dirty;
    this.dirty = false;
    return wasDirty;
  }

  // True when the value carries a dynamic alias this engine cannot resolve yet.
  hasUnknownAliases(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    return [...text.matchAll(DYNAMIC_ALIAS_RE)].some(([alias]) => !this.aliasToReal.has(alias));
  }

  #maskSecrets(text) {
    let out = text;
    for (const { re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      out = out.replace(re, m => this.#secretAlias(m));
    }
    SENSITIVE_ASSIGNMENT_RE.lastIndex = 0;
    out = out.replace(SENSITIVE_ASSIGNMENT_RE, (m, key, sep, quote, quoted, bare) => {
      if (bare !== undefined && !(/\d/.test(bare) && /[A-Za-z]/.test(bare))) return m;
      const q = quote || '';
      return `${key}${sep}${q}${this.#secretAlias(quoted ?? bare)}${q}`;
    });
    return out;
  }

  #replacePathMappings(text) {
    let out = text;
    for (const row of this.reversible) {
      if (!PATH_KINDS.includes(row.kind)) continue;
      for (const variant of stablePathVariants(row.real)) {
        const next = replaceAllInsensitive(out, variant, row.alias);
        if (next !== out) this.seenKinds.add(row.kind);
        out = next;
      }
    }
    return out;
  }

  #replaceScalarMappings(text) {
    let out = text;
    for (const scalar of this.scalars) {
      scalar.re.lastIndex = 0;
      out = out.replace(scalar.re, match => {
        this.seenKinds.add(scalar.kind);
        if (match === scalar.real) return scalar.alias;
        return this.realToAlias.get(mappingKey(VARIANT_KIND, match)) || this.#aliasFor(VARIANT_KIND, match);
      });
    }
    return out;
  }

  #virtualizePath(path) {
    const original = path;
    let out = this.#replacePathMappings(original);
    if (out !== original || /^<[^>]+>/.test(out)) return out;

    const kind = path.startsWith('\\\\') ? 'UNC_ROOT' : 'EXTERNAL_ROOT';
    const { prefix, tail } = pathPrefixForExternal(path);
    // A bare drive identifies nobody, and aliasing "C:" would rewrite every "c:" in later text.
    if (/^[A-Za-z]:[\\/]?$/.test(prefix || path)) return path;
    this.seenKinds.add(kind);
    if (!prefix || prefix === path && !tail) return this.#aliasFor(kind, path);
    return this.#aliasFor(kind, prefix) + tail;
  }

  tokenizeString(input) {
    if (typeof input !== 'string' || input.length === 0) return input;
    let out = input;

    out = this.#maskSecrets(out);
    out = this.#replacePathMappings(out);

    EMAIL_RE.lastIndex = 0;
    out = out.replace(EMAIL_RE, email => {
      if (isSafeExampleEmail(email) || looksLikeFileName(email)) return email;
      this.seenKinds.add('EMAIL');
      return this.#aliasFor('EMAIL', email);
    });

    PRIVATE_IP_RE.lastIndex = 0;
    out = out.replace(PRIVATE_IP_RE, ip => {
      this.seenKinds.add('PRIVATE_IP');
      return this.#aliasFor('PRIVATE_IP', ip);
    });

    WIN_QUOTED_PATH_RE.lastIndex = 0;
    out = out.replace(WIN_QUOTED_PATH_RE, (_m, quote, path) => `${quote}${this.#virtualizePath(path)}${quote}`);

    UNC_BARE_PATH_RE.lastIndex = 0;
    out = out.replace(UNC_BARE_PATH_RE, path => this.#virtualizePath(path));

    WIN_BARE_PATH_RE.lastIndex = 0;
    out = out.replace(WIN_BARE_PATH_RE, path => this.#virtualizePath(path));

    POSIX_PATH_RE.lastIndex = 0;
    out = out.replace(POSIX_PATH_RE, (m, prefix) => {
      const path = m.slice(prefix.length);
      return prefix + this.#virtualizePath(path);
    });

    // Run scalar identity aliases after emails and paths have been recognized.
    out = this.#replacePathMappings(out);
    out = this.#replaceScalarMappings(out);

    if (out !== input) this.stats.stringsChanged += 1;
    return out;
  }

  detokenizeString(input, { shell = false } = {}) {
    if (typeof input !== 'string' || input.length === 0) return input;
    if (this.hasUnknownAliases(input)) this.#ensureLoaded();
    let out = input;
    const pairs = [...this.aliasToReal.entries()].sort((a, b) => b[0].length - a[0].length);
    for (const [alias, real] of pairs) {
      if (!out.includes(alias)) continue;
      if (!shell) {
        out = out.split(alias).join(real);
        continue;
      }
      // For shell commands, preserve correctness when the real root contains spaces.
      // We only auto-quote a naked alias/path token that was not already quoted.
      const slashReal = real.replace(/\\/g, '/');
      const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tokenRe = new RegExp(`(?<!["'])${escaped}([^\\s;&|)]*)`, 'g');
      out = out.replace(tokenRe, (_m, tail) => {
        const full = slashReal + (tail || '').replace(/\\/g, '/');
        return /\s/.test(full) ? `"${full.replace(/"/g, '\\"')}"` : full;
      });
      out = out.split(`"${alias}`).join(`"${slashReal}`);
      out = out.split(`'${alias}`).join(`'${slashReal}`);
    }
    return out;
  }

  tokenizeDeep(value) {
    if (typeof value === 'string') return this.tokenizeString(value);
    if (Array.isArray(value)) return value.map(v => this.tokenizeDeep(v));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.tokenizeDeep(v);
      return out;
    }
    return value;
  }

  detokenizeDeep(value, { shell = false } = {}) {
    if (typeof value === 'string') return this.detokenizeString(value, { shell });
    if (Array.isArray(value)) return value.map(v => this.detokenizeDeep(v, { shell }));
    if (value && typeof value === 'object') {
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = this.detokenizeDeep(v, { shell });
      return out;
    }
    return value;
  }

  scanForLeaks(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
    const leaks = [];
    for (const scalar of this.scalars) {
      if (containsScalarInsensitive(text, scalar.real)) leaks.push({ kind: scalar.kind, sample: scalar.alias });
    }
    for (const row of this.reversible) {
      if (!row.real || row.real.length < 3 || row.kind === VARIANT_KIND) continue;
      if (text.toLowerCase().includes(row.real.toLowerCase())) leaks.push({ kind: row.kind, sample: row.alias });
      const slash = row.real.replace(/\\/g, '/');
      if (slash !== row.real && text.toLowerCase().includes(slash.toLowerCase())) leaks.push({ kind: row.kind, sample: row.alias });
    }
    for (const { name, re } of SECRET_PATTERNS) {
      re.lastIndex = 0;
      if (re.test(text)) leaks.push({ kind: name, sample: '<SECRET>' });
    }
    SENSITIVE_ASSIGNMENT_RE.lastIndex = 0;
    for (const m of text.matchAll(SENSITIVE_ASSIGNMENT_RE)) {
      const bare = m[5];
      if (bare !== undefined && !(/\d/.test(bare) && /[A-Za-z]/.test(bare))) continue;
      leaks.push({ kind: 'sensitive-assignment', sample: '<SECRET>' });
      break;
    }
    return leaks;
  }

  forceSafe(value) {
    const sanitized = this.tokenizeDeep(cloneJson(value));
    const leaks = this.scanForLeaks(sanitized);
    return { value: sanitized, leaks };
  }

  // Tokenizes a copy of `value`; throws when a known sensitive value survives (fail closed).
  sanitize(value, where = 'payload') {
    const checked = this.forceSafe(value);
    if (checked.leaks.length) {
      const kinds = [...new Set(checked.leaks.map(x => x.kind))].join(', ');
      const err = new Error(`Agent Privacy Shield blocked ${where}: residual sensitive data (${kinds || 'unknown'}).`);
      err.leaks = checked.leaks;
      throw err;
    }
    return checked.value;
  }

  status() {
    return {
      projectAlias: this.projectRoot ? '<PROJECT_ROOT>' : null,
      reversibleAliases: this.aliasToReal.size,
      secretsMasked: this.stats.secretsMasked,
      stringsChanged: this.stats.stringsChanged,
      dynamicAliases: this.stats.dynamicAliases
    };
  }
}

export { SCALAR_KINDS };
