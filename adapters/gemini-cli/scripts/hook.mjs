import { createRuntime } from '../../../core/runtime.mjs';
import { containsMaskedSecret } from '../../../core/privacy-engine.js';

let input=''; for await (const chunk of process.stdin) input += chunk;
try {
  const e = JSON.parse(input || '{}');
  const rt = createRuntime(e.cwd || process.env.GEMINI_CWD || process.cwd());
  const event = e.hook_event_name || e.hookEventName || '';
  let out = { suppressOutput:true };
  if (event === 'BeforeModel') {
    out.hookSpecificOutput = { llm_request: rt.safe(e.llm_request || {}, 'Gemini BeforeModel request') };
  } else if (event === 'BeforeTool') {
    const toolInput = e.tool_input || {};
    if (containsMaskedSecret(toolInput)) throw new Error('the tool arguments contain a masked secret placeholder (<SECRET_n>); its real value is never restored, so leave that text unchanged or ask the user for the value');
    const shell = e.tool_name === 'run_shell_command';
    out.hookSpecificOutput = { tool_input: rt.engine.detokenizeDeep(toolInput, { shell }) };
  }
  rt.persist();
  process.stdout.write(JSON.stringify(out));
} catch (err) {
  // Exit code 2 is Gemini's blocking failure; any other failure would let the request through with a warning.
  const reason = `Agent Privacy Shield: ${String(err.message || err)}`;
  process.stdout.write(JSON.stringify({ decision:'deny', reason, suppressOutput:true }));
  process.stderr.write(reason);
  process.exitCode = 2;
}
