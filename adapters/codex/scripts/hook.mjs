import { createRuntime } from '../../../core/runtime.mjs';
import { containsMaskedSecret, SCALAR_KINDS } from '../../../core/privacy-engine.js';

const SECRET_DENY = 'Agent Privacy Shield: the arguments contain a masked secret placeholder (<SECRET_n>). Its real value is never restored; leave that text unchanged or ask the user for the value.';
let input=''; for await (const chunk of process.stdin) input += chunk;
let event = '';
try {
  const e = JSON.parse(input || '{}');
  event = e.hook_event_name || e.hookEventName || '';
  const rt = createRuntime(e.cwd || process.cwd());
  if (event === 'SessionStart') {
    process.stdout.write(JSON.stringify({ hookSpecificOutput:{ hookEventName:'SessionStart', additionalContext:'Agent Privacy Shield is active for local tool aliases such as <PROJECT_ROOT>. Codex cannot rewrite prompts, so prompts carrying raw local paths, emails, private IPs or secrets are blocked.' } }));
  } else if (event === 'UserPromptSubmit') {
    // Codex UserPromptSubmit has no prompt replacement field, so a prompt that needs a rewrite is blocked.
    // Bare project/user/org/host names are let through: blocking every mention of the repo would make the agent unusable.
    rt.engine.tokenizeString(e.prompt || '');
    const kinds = [...rt.engine.seenKinds].filter(k => !SCALAR_KINDS.includes(k));
    if (kinds.length) process.stdout.write(JSON.stringify({ decision:'block', reason:`Agent Privacy Shield: the prompt contains ${kinds.join(', ')}. Codex cannot rewrite prompts, so replace local paths with aliases such as <PROJECT_ROOT>\\src and remove emails, private IPs and secrets, then send it again.` }));
  } else if (event === 'PreToolUse') {
    const toolInput = e.tool_input || {};
    if (containsMaskedSecret(toolInput)) {
      process.stdout.write(JSON.stringify({ hookSpecificOutput:{ hookEventName:'PreToolUse', permissionDecision:'deny', permissionDecisionReason:SECRET_DENY } }));
    } else {
      const shell = e.tool_name === 'Bash' || e.tool_name === 'exec_command';
      const localized = rt.engine.detokenizeDeep(toolInput, { shell });
      // updatedInput is only accepted with "allow", so emit it only when an alias was actually resolved.
      if (JSON.stringify(localized) !== JSON.stringify(toolInput)) {
        process.stdout.write(JSON.stringify({ hookSpecificOutput:{ hookEventName:'PreToolUse', permissionDecision:'allow', updatedInput: localized } }));
      }
    }
  }
  rt.persist();
} catch (err) {
  const reason = `Agent Privacy Shield failed: ${String(err.message || err)}`;
  if (event === 'PreToolUse') process.stdout.write(JSON.stringify({ hookSpecificOutput:{ hookEventName:'PreToolUse', permissionDecision:'deny', permissionDecisionReason:reason } }));
  else process.stdout.write(JSON.stringify({ decision:'block', reason }));
}
