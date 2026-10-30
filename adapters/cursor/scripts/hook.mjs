import { createRuntime } from '../../../core/runtime.mjs';
import { containsMaskedSecret, SCALAR_KINDS } from '../../../core/privacy-engine.js';

const SECRET_DENY = 'Agent Privacy Shield: the arguments contain a masked secret placeholder (<SECRET_n>). Its real value is never restored; leave that text unchanged or ask the user for the value.';
let input=''; for await (const chunk of process.stdin) input += chunk;
let event = '';

// Plugin hooks run from the plugin's install directory, so the workspace comes from the payload.
function workspace(e) {
  const dir = e.cwd || e.workspace_roots?.[0] || process.cwd();
  return dir.replace(/^\/([A-Za-z]:[\\/])/, '$1');
}

try {
  const e = JSON.parse(input || '{}');
  event = e.hook_event_name || '';
  const rt = createRuntime(workspace(e));
  if (event === 'beforeSubmitPrompt') {
    // beforeSubmitPrompt can only stop a prompt, so one that needs a rewrite is blocked, as in Codex.
    rt.engine.tokenizeString(e.prompt || '');
    const kinds = [...rt.engine.seenKinds].filter(k => !SCALAR_KINDS.includes(k));
    process.stdout.write(JSON.stringify(kinds.length
      ? { continue:false, user_message:`Agent Privacy Shield: the prompt contains ${kinds.join(', ')}. Cursor cannot rewrite prompts, so replace local paths with aliases such as <PROJECT_ROOT>\\src and remove emails, private IPs and secrets, then send it again.` }
      : { continue:true }));
  } else if (event === 'preToolUse') {
    const toolInput = e.tool_input || {};
    // MCP tools and subagent prompts leave the machine, so aliases stay in them.
    if (String(e.tool_name).startsWith('MCP:') || e.tool_name === 'Task') {
      process.stdout.write(JSON.stringify({ permission:'allow' }));
    } else if (containsMaskedSecret(toolInput)) {
      process.stdout.write(JSON.stringify({ permission:'deny', user_message:SECRET_DENY, agent_message:SECRET_DENY }));
    } else {
      const localized = rt.engine.detokenizeDeep(toolInput, { shell: e.tool_name === 'Shell' });
      const changed = JSON.stringify(localized) !== JSON.stringify(toolInput);
      process.stdout.write(JSON.stringify(changed ? { permission:'allow', updated_input: localized } : { permission:'allow' }));
    }
  }
  rt.persist();
} catch (err) {
  const reason = `Agent Privacy Shield failed: ${String(err.message || err)}`;
  if (event === 'preToolUse') process.stdout.write(JSON.stringify({ permission:'deny', user_message:reason, agent_message:reason }));
  else process.stdout.write(JSON.stringify({ continue:false, user_message:reason }));
}
