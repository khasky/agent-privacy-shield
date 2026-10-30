import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
// Never touch the real %LOCALAPPDATA% vault from tests; the runtime reads this at import time.
process.env.AGENT_PRIVACY_SHIELD_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'aps-kilo-'));
test.after(() => fs.rmSync(process.env.AGENT_PRIVACY_SHIELD_DATA, { recursive: true, force: true }));
const { default: plugin } = await import('../adapters/kilo/plugin.js');

const CWD = 'C:\\Users\\Anna\\SecretGame';
// Kilo reports the drive root as the worktree for a folder outside git.
const hooks = await plugin.server({ directory: CWD, worktree: 'C:\\' });

test('Kilo plugin exports the v1 module shape', () => {
  assert.equal(plugin.id, 'agent-privacy-shield');
  assert.equal(typeof plugin.server, 'function');
});

test('Kilo chat.message and system transform alias paths', async () => {
  const parts = [{ type: 'text', text: 'open C:\\Users\\Anna\\SecretGame\\src\\a.ts' }];
  await hooks['chat.message']({}, { message: {}, parts });
  assert.equal(parts[0].text, 'open <PROJECT_ROOT>\\src\\a.ts');
  const system = ['cwd is C:\\Users\\Anna\\SecretGame'];
  await hooks['experimental.chat.system.transform']({}, { system });
  assert.deepEqual(system, ['cwd is <PROJECT_ROOT>']);
});

test('Kilo tool.definition aliases paths in descriptions', async () => {
  const output = { description: 'Runs in C:\\Users\\Anna\\SecretGame', parameters: { type: 'object' } };
  await hooks['tool.definition']({ toolID: 'bash' }, output);
  assert.equal(output.description, 'Runs in <PROJECT_ROOT>');
});

test('Kilo history transform adds sanitized environment details once', async () => {
  const info = { id: 'msg_1', sessionID: 'ses_1', role: 'user', time: { created: 0 } };
  const messages = [{ info, parts: [{ type: 'text', text: 'hi from C:\\Users\\Anna\\SecretGame' }] }];
  await hooks['experimental.chat.messages.transform']({}, { messages });
  await hooks['experimental.chat.messages.transform']({}, { messages });
  const details = messages[0].parts.filter(p => p.synthetic);
  assert.equal(details.length, 1);
  assert.match(details[0].text, /Working directory: <PROJECT_ROOT>\nWorkspace root folder: <PROJECT_ROOT>/);
  assert.doesNotMatch(JSON.stringify(messages), /Anna/);
});

test('Kilo keeps a file part url real', async () => {
  const url = 'file:///C:/Users/Anna/SecretGame/a.png';
  const messages = [{ info: { id: 'msg_2', sessionID: 'ses_1', role: 'assistant' }, parts: [{ type: 'file', url, filename: 'C:\\Users\\Anna\\SecretGame\\a.png' }] }];
  await hooks['experimental.chat.messages.transform']({}, { messages });
  assert.equal(messages[0].parts[0].url, url);
  assert.equal(messages[0].parts[0].filename, '<PROJECT_ROOT>\\a.png');
});

test('Kilo tool.execute.before localizes and after re-aliases', async () => {
  const args = { filePath: '<PROJECT_ROOT>\\notes.txt' };
  await hooks['tool.execute.before']({ tool: 'read' }, { args });
  assert.equal(args.filePath, 'C:\\Users\\Anna\\SecretGame\\notes.txt');
  const output = { title: 'C:\\Users\\Anna\\SecretGame\\notes.txt', output: 'owner anna@corp.lan', metadata: {} };
  await hooks['tool.execute.after']({ tool: 'read', args }, output);
  assert.equal(output.title, '<PROJECT_ROOT>\\notes.txt');
  assert.match(output.output, /^owner <EMAIL_[0-9a-f]{10}>$/);
});

test('Kilo refuses a tool call with a masked secret and skips MCP tools', async () => {
  await assert.rejects(hooks['tool.execute.before']({ tool: 'write' }, { args: { content: 'key=<SECRET_1>' } }), /masked secret/);
  const args = { path: '<PROJECT_ROOT>' };
  await hooks['tool.execute.before']({ tool: 'github_search' }, { args });
  assert.equal(args.path, '<PROJECT_ROOT>');
});
