import { createRuntime } from '../../../core/runtime.mjs';
import { containsMaskedSecret } from '../../../core/privacy-engine.js';
let input=''; for await (const chunk of process.stdin) input += chunk;
try {
  const e = JSON.parse(input || '{}');
  const cwd = (Array.isArray(e.workspacePaths) && e.workspacePaths[0]) || process.cwd();
  const rt = createRuntime(cwd);
  const event = process.env.APS_ANTIGRAVITY_EVENT || (e.toolCall ? 'PreToolUse' : (typeof e.invocationNum === 'number' ? 'PreInvocation' : 'SessionStart'));
  if (e.toolCall && containsMaskedSecret(e.toolCall.args)) {
    process.stdout.write(JSON.stringify({ decision:'deny', reason:'Agent Privacy Shield: the arguments contain a masked secret placeholder (<SECRET_n>). Its real value is never restored; leave that text unchanged or ask the user for the value.' }));
  } else if (e.toolCall) {
    const shell = e.toolCall.name === 'run_command';
    const localized = rt.engine.detokenizeDeep(e.toolCall.args || {}, {shell});
    process.stdout.write(JSON.stringify({ decision:'allow', overwrite: localized, reason:'Agent Privacy Shield localized semantic aliases for local execution.' }));
  } else if (typeof e.invocationNum === 'number') {
    process.stdout.write(JSON.stringify({ injectSteps:[{ ephemeralMessage:'Agent Privacy Shield native Antigravity adapter protects tool aliases, but Antigravity PreInvocation cannot rewrite the original prompt. Do not treat this mode as full prompt privacy.' }] }));
  } else {
    process.stdout.write(JSON.stringify({ injectSteps:[{ systemMessage:{ systemMessage:'Agent Privacy Shield is active in PARTIAL mode: local tool aliases are protected; prompt-body rewriting is not available through current Antigravity hooks.' } }] }));
  }
  rt.persist();
} catch (err) {
  process.stdout.write(JSON.stringify({ decision:'deny', reason:String(err.message || err) }));
}
