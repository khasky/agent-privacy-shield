// Claude Code hooks module. It runs without Node APIs: workspace discovery goes through
// $.process/$.env, and the DPAPI vault through lib/vault-cli.mjs in a Node child.
import { PrivacyEngine, containsMaskedSecret } from './lib/privacy-engine.js';

const LOCAL_TOOLS = new Set(['Read','Write','Edit','MultiEdit','Glob','Grep','NotebookEdit','LS','Bash','PowerShell']);
const RESERVED_KEYS = new Set(['tool','tool_use_id','agentId','consent','requestMeta']);
const PRIVACY_CONTEXT = 'Agent Privacy Shield is active. Paths and private identifiers may be stable semantic aliases such as <PROJECT_ROOT>. Use aliases normally; trusted local tools resolve them locally.';
const SECRET_DENY = 'Agent Privacy Shield: the arguments contain a masked secret placeholder (<SECRET_n>). Its real value is never restored, so this call would write the placeholder into the file or command. Leave that text unchanged (edit around it) or ask the user for the value.';

let ready = null;

async function run($, argv, init) {
  try { return await $.process.run(argv, init); }
  catch (err) { return { exitCode: 1, stdout: '', stderr: String(err.message || err) }; }
}

async function discover($, cwd) {
  const top = await run($, ['git', '-C', cwd, 'rev-parse', '--show-toplevel']);
  const projectRoot = top.exitCode === 0 && top.stdout.trim() ? top.stdout.trim() : cwd;
  const remote = await run($, ['git', '-C', projectRoot, 'config', '--get', 'remote.origin.url']);
  const home = (await $.env.get('USERPROFILE')) || (await $.env.get('HOME')) || '';
  const temp = (await $.env.get('TEMP')) || (await $.env.get('TMP')) || '';
  let computerName = (await $.env.get('COMPUTERNAME')) || '';
  if (!computerName) {
    const host = await run($, ['hostname']);
    if (host.exitCode === 0) computerName = host.stdout.trim();
  }
  return { cwd, projectRoot, gitRemote: remote.exitCode === 0 ? remote.stdout.trim() : '', home, temp, computerName };
}

async function vault($, mode, projectRoot, state) {
  const r = await run($, ['node', `${$.plugin.root}/hooks/lib/vault-cli.mjs`, mode, projectRoot], {
    stdin: state ? JSON.stringify(state) : '', timeoutMs: 20000
  });
  if (r.exitCode !== 0) throw new Error((r.stderr || `vault ${mode} failed`).trim().split(/\r?\n/)[0]);
  return JSON.parse(r.stdout).state ?? undefined;
}

function init($) {
  ready ??= (async () => {
    const meta = await discover($, await $.session.cwd());
    const rt = { meta, persistence: 'windows-dpapi' };
    let persisted;
    try { persisted = await vault($, 'load', meta.projectRoot); }
    catch (err) { rt.persistence = `memory-only (${err.message})`; }
    rt.engine = new PrivacyEngine({ ...meta, persisted });
    return rt;
  })();
  return ready;
}

async function persist($, rt) {
  if (!rt.engine.consumeDirty()) return;
  try {
    rt.engine.mergeState(await vault($, 'save', rt.meta.projectRoot, rt.engine.exportState()));
    rt.persistence = 'windows-dpapi';
  } catch (err) { rt.persistence = `memory-only (${err.message})`; }
}

async function reload($, rt) {
  try { rt.engine.mergeState(await vault($, 'load', rt.meta.projectRoot)); } catch {}
}

function withheld(message) {
  return { ...message, content:[{ type:'text', text:'[Agent Privacy Shield withheld an unsafe transcript row.]' }] };
}

function toolArgs(e) {
  const args = {};
  for (const [k, v] of Object.entries(e)) if (!RESERVED_KEYS.has(k)) args[k] = v;
  return args;
}

export function register(on) {
  on('session.start', async ($, e, next) => {
    try { await init($); } catch {}
    try { await $.command.register({ name:'privacy-shield', description:'Show Agent Privacy Shield status' }); } catch {}
    return next(e);
  });

  on('command.run', { command:'privacy-shield' }, async ($) => {
    let rt;
    try { rt = await init($); } catch (err) { return { text:`Agent Privacy Shield: NOT READY (${err.message || err})` }; }
    const s = rt.engine.status();
    return { text:[
      'Agent Privacy Shield: active', 'Agent: Claude Code', `Workspace: ${s.projectAlias || '(none)'}`,
      `Reversible aliases: ${s.reversibleAliases}`, `Dynamic aliases: ${s.dynamicAliases}`,
      `Secrets masked: ${s.secretsMasked}`, `Mapping persistence: ${rt.persistence}`
    ].join('\n') };
  });

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e);
    // Shared sections are identical for every user of this build; session sections carry cwd, env and memory.
    let rt;
    try { rt = await init($); } catch { return { sections: composed.sections.filter(s => s.scope === 'shared') }; }
    const sections = [];
    for (const s of composed.sections) {
      if (s.scope === 'shared') { sections.push(s); continue; }
      try { sections.push({ ...s, text: rt.engine.sanitize(s.text, `system prompt section ${s.id}`) }); } catch {}
    }
    await persist($, rt);
    return { sections };
  }).catch(async ($e, e, next) => ({ sections: (await next(e)).sections.filter(s => s.scope === 'shared') }));

  on('prompt.context', async ($, e, next) => {
    const context = await next(e);
    let rt;
    try { rt = await init($); } catch { return { blocks: [] }; }
    const blocks = [];
    for (const b of context.blocks) {
      try { blocks.push({ ...b, text: rt.engine.sanitize(b.text, `context block ${b.name}`) }); } catch {}
    }
    await persist($, rt);
    return { blocks };
  }).catch(() => ({ blocks: [] }));

  on('prompt.submit', async ($, e, next) => {
    let rt;
    try { rt = await init($); } catch { return { drop:'Agent Privacy Shield is not initialized; prompt blocked fail-closed.' }; }
    let text;
    try { text = rt.engine.sanitize(e.text, 'user prompt'); }
    catch (err) { return { drop:String(err.message || err) }; }
    await persist($, rt);
    const context = [...(e.context ?? [])];
    if (!context.includes(PRIVACY_CONTEXT)) context.push(PRIVACY_CONTEXT);
    return next({ ...e, text, context });
  }).catch(($e, e, next) => next.called ? next(e) : { drop:'Agent Privacy Shield hook failed; prompt blocked fail-closed.' });

  on('tool.call', async ($, e, next) => {
    let rt;
    try { rt = await init($); } catch { return { deny:'Agent Privacy Shield is not initialized.' }; }
    const { engine } = rt;
    let call = e;
    if (LOCAL_TOOLS.has(e.tool)) {
      const args = toolArgs(e);
      if (containsMaskedSecret(args)) return { deny: SECRET_DENY };
      if (engine.hasUnknownAliases(args)) await reload($, rt);
      const shell = e.tool === 'Bash' || e.tool === 'PowerShell';
      call = { ...e, ...engine.detokenizeDeep(args, { shell }) };
    }
    const result = await next(call);
    try {
      if (result.deny !== undefined) return { deny: engine.tokenizeString(result.deny) };
      const { ref, ...rest } = result;
      const safeRest = engine.sanitize(rest, 'tool result');
      await persist($, rt);
      return ref === undefined ? safeRest : { ref, ...safeRest };
    } catch (err) { return { deny:String(err.message || err) }; }
  }).catch(() => ({ deny:'Agent Privacy Shield hook failed; call refused fail-closed.' }));

  on('session.append', async ($, e, next) => {
    if (!e.message) return next(e);
    let rt;
    try { rt = await init($); } catch { rt = null; }
    try {
      if (!rt) throw new Error('not initialized');
      const message = rt.engine.sanitize(e.message, 'session transcript');
      await persist($, rt);
      return next({ ...e, message });
    } catch {
      return next({ ...e, message:withheld(e.message) });
    }
  }).catch(($e, e, next) => next({ ...e, message:withheld(e.message) }));
}
