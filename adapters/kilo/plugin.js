// Kilo Code plugin. Kilo calls these hooks in-process and reads the mutated `output` objects.
import { createRuntime } from '../../core/runtime.mjs';
import { containsMaskedSecret } from '../../core/privacy-engine.js';

const LOCAL_TOOLS = new Set(['bash','read','write','edit','multiedit','patch','apply_patch','glob','grep','list','ls']);
const SECRET_DENY = 'Agent Privacy Shield: the arguments contain a masked secret placeholder (<SECRET_n>). Its real value is never restored; leave that text unchanged or ask the user for the value.';

function replaceAll(list, fn) {
  list.splice(0, list.length, ...list.map(fn));
}

// Kilo appends an <environment_details> part with raw paths after messages.transform has run,
// unless the user message already carries one. So the plugin adds a sanitized one in the same shape.
function environmentDetails(info, directory, worktree) {
  const ctx = info.editorContext || {};
  const created = new Date(info.time?.created ?? Date.now()).toISOString().replace(/\.\d+Z$/, 'Z');
  const lines = [`Message time: ${created}`, `Working directory: ${directory}`, `Workspace root folder: ${worktree}`];
  if (ctx.activeFile) lines.push(`Active file: ${ctx.activeFile}`);
  if (ctx.visibleFiles?.length) lines.push('Visible files:', ...ctx.visibleFiles.map(f => `  ${f}`));
  if (ctx.openTabs?.length) lines.push('Open tabs:', ...ctx.openTabs.map(f => `  ${f}`));
  return ['', '', '<environment_details>', ...lines, '</environment_details>'].join('\n');
}

function hasEnvironmentDetails(parts) {
  return parts.some(p => p.type === 'text' && p.synthetic && p.text.trimStart().startsWith('<environment_details>'));
}

export const AgentPrivacyShield = async ({ directory, worktree }) => {
  // For a folder outside git Kilo reports the worktree as the drive root, so the session directory decides.
  const cwd = directory || process.cwd();
  const rt = createRuntime(cwd);
  const root = worktree && worktree !== '/' && !/^[A-Za-z]:[\\/]?$/.test(worktree) ? worktree : rt.meta.projectRoot;
  // A file part's url is where Kilo reads the attachment from, so it stays real; the content is sent as other parts.
  const safePart = (part, where) => {
    if (part?.type !== 'file') return rt.safe(part, where);
    const { url, ...rest } = part;
    return { ...rt.safe(rest, where), url };
  };

  return {
    'chat.message': async (input, output) => {
      for (const part of output.parts) if (part.type === 'text') part.text = rt.safe(part.text, 'user prompt');
      rt.persist();
    },

    'experimental.chat.system.transform': async (input, output) => {
      replaceAll(output.system, text => rt.safe(text, 'system prompt'));
      rt.persist();
    },

    'tool.definition': async (input, output) => {
      output.description = rt.safe(output.description, `tool definition ${input.toolID}`);
      output.parameters = rt.safe(output.parameters, `tool definition ${input.toolID}`);
    },

    // The model request is built from this history, so it is the boundary that makes Kilo FULL.
    'experimental.chat.messages.transform': async (input, output) => {
      for (const message of output.messages) {
        message.info = rt.safe(message.info, 'message history');
        replaceAll(message.parts, part => safePart(part, 'message history'));
        if (message.info.role === 'user' && !hasEnvironmentDetails(message.parts)) {
          message.parts.push({
            id: `prt_aps${message.info.id}`,
            sessionID: message.info.sessionID,
            messageID: message.info.id,
            type: 'text',
            text: rt.safe(environmentDetails(message.info, cwd, root), 'environment details'),
            synthetic: true
          });
        }
      }
      rt.persist();
    },

    'tool.execute.before': async (input, output) => {
      if (!LOCAL_TOOLS.has(input.tool)) return;
      if (containsMaskedSecret(output.args)) throw new Error(SECRET_DENY);
      if (rt.engine.hasUnknownAliases(output.args)) rt.reload();
      const localized = rt.engine.detokenizeDeep(output.args, { shell: input.tool === 'bash' });
      for (const [key, value] of Object.entries(localized)) output.args[key] = value;
    },

    'tool.execute.after': async (input, output) => {
      if (typeof output.output === 'string') output.output = rt.engine.tokenizeString(output.output);
      if (typeof output.title === 'string') output.title = rt.engine.tokenizeString(output.title);
      rt.persist();
    }
  };
};

export default { id: 'agent-privacy-shield', server: AgentPrivacyShield };
