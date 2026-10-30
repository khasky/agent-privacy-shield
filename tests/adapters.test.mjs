import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// Never touch the real %LOCALAPPDATA% vault from tests.
const env={ ...process.env, AGENT_PRIVACY_SHIELD_DATA: fs.mkdtempSync(path.join(os.tmpdir(),'aps-test-')) };
test.after(()=>fs.rmSync(env.AGENT_PRIVACY_SHIELD_DATA,{recursive:true,force:true}));
const win=process.platform==='win32';
function raw(rel,payload){ return spawnSync(process.execPath,[path.join(root,rel)],{input:JSON.stringify(payload),encoding:'utf8',env}); }
function run(rel,payload){ const r=raw(rel,payload); assert.equal(r.status,0,r.stderr); return r.stdout ? JSON.parse(r.stdout) : null; }
const GEMINI='adapters/gemini-cli/scripts/hook.mjs', CODEX='adapters/codex/scripts/hook.mjs', AGY='adapters/antigravity/scripts/hook.mjs', CURSOR='adapters/cursor/scripts/hook.mjs';
const CWD='C:\\Users\\Anna\\SecretGame';

test('Gemini BeforeModel rewrites outgoing request',()=>{
 const o=run(GEMINI,{hook_event_name:'BeforeModel',cwd:CWD,llm_request:{messages:[{role:'user',content:'read C:\\Users\\Anna\\SecretGame\\src\\a.ts'}]}});
 assert.match(JSON.stringify(o),/<PROJECT_ROOT>/); assert.doesNotMatch(JSON.stringify(o),/C:\\\\Users\\\\Anna/);
});

test('Gemini BeforeTool restores project alias locally',()=>{
 const o=run(GEMINI,{hook_event_name:'BeforeTool',cwd:CWD,tool_name:'read_file',tool_input:{file_path:'<PROJECT_ROOT>\\src\\a.ts'}});
 assert.match(JSON.stringify(o),/SecretGame/);
});

test('Gemini blocks with exit code 2 on a masked secret placeholder',()=>{
 const r=raw(GEMINI,{hook_event_name:'BeforeTool',cwd:CWD,tool_name:'write_file',tool_input:{content:'key=<SECRET_1>'}});
 assert.equal(r.status,2); assert.equal(JSON.parse(r.stdout).decision,'deny');
});

test('Gemini dynamic alias created in BeforeModel resolves in a later BeforeTool process',{skip:!win && 'DPAPI vault is Windows-only'},()=>{
 const o=run(GEMINI,{hook_event_name:'BeforeModel',cwd:CWD,llm_request:{messages:[{role:'user',content:'read D:\\Clients\\Acme\\notes.txt'}]}});
 const alias=JSON.stringify(o).match(/<EXTERNAL_ROOT_[0-9a-f]{10}>/)[0];
 const t=run(GEMINI,{hook_event_name:'BeforeTool',cwd:CWD,tool_name:'read_file',tool_input:{file_path:`${alias}\\notes.txt`}});
 assert.equal(t.hookSpecificOutput.tool_input.file_path,'D:\\Clients\\Acme\\notes.txt');
});

test('concurrent hook processes keep every alias in the vault',{skip:!win && 'DPAPI vault is Windows-only'},async()=>{
 const one=i=>new Promise((resolve,reject)=>{
  const c=spawn(process.execPath,[path.join(root,GEMINI)],{env});
  let out=''; c.stdout.on('data',d=>{out+=d;}); c.on('error',reject);
  c.on('close',code=>code===0?resolve(JSON.stringify(JSON.parse(out)).match(/<EMAIL_[0-9a-f]{10}>/)[0]):reject(new Error(`exit ${code}`)));
  c.stdin.end(JSON.stringify({hook_event_name:'BeforeModel',cwd:CWD,llm_request:{messages:[{role:'user',content:`mail user${i}@corp.invalid`}]}}));
 });
 const aliases=await Promise.all([0,1,2,3].map(one));
 for(const [i,alias] of aliases.entries()){
  const t=run(GEMINI,{hook_event_name:'BeforeTool',cwd:CWD,tool_name:'write_file',tool_input:{content:alias}});
  assert.equal(t.hookSpecificOutput.tool_input.content,`user${i}@corp.invalid`);
 }
});

test('Codex blocks a prompt that carries a raw local path',()=>{
 const o=run(CODEX,{hook_event_name:'UserPromptSubmit',cwd:CWD,prompt:'open C:\\Users\\Anna\\SecretGame\\a.ts'});
 assert.equal(o.decision,'block'); assert.match(o.reason,/PROJECT_ROOT/); assert.doesNotMatch(o.reason,/hard mode/);
});

test('Codex lets a prompt that only names the project through',()=>{
 assert.equal(run(CODEX,{hook_event_name:'UserPromptSubmit',cwd:CWD,prompt:'add a test to SecretGame'}),null);
});

test('Codex PreToolUse stays silent when nothing needs localizing',()=>{
 assert.equal(run(CODEX,{hook_event_name:'PreToolUse',cwd:CWD,tool_name:'Bash',tool_input:{command:'rm -rf build'}}),null);
});

test('Codex PreToolUse rewrites aliases without unsupported fields',()=>{
 const o=run(CODEX,{hook_event_name:'PreToolUse',cwd:CWD,tool_name:'Bash',tool_input:{command:'cat <PROJECT_ROOT>/a.ts'}});
 assert.deepEqual(o,{hookSpecificOutput:{hookEventName:'PreToolUse',permissionDecision:'allow',updatedInput:{command:'cat C:/Users/Anna/SecretGame/a.ts'}}});
});

test('Codex PreToolUse denies a masked secret placeholder',()=>{
 const o=run(CODEX,{hook_event_name:'PreToolUse',cwd:CWD,tool_name:'apply_patch',tool_input:{command:'+key=<SECRET_2>'}});
 assert.equal(o.hookSpecificOutput.permissionDecision,'deny');
});

test('Antigravity local tool args are detokenized',()=>{
 const o=run(AGY,{workspacePaths:[CWD],toolCall:{name:'view_file',args:{AbsolutePath:'<PROJECT_ROOT>\\a.ts'}}});
 assert.equal(o.decision,'allow'); assert.match(JSON.stringify(o.overwrite),/SecretGame/);
});

test('Antigravity denies a masked secret placeholder',()=>{
 const o=run(AGY,{workspacePaths:[CWD],toolCall:{name:'write_to_file',args:{CodeContent:'key=<SECRET_1>'}}});
 assert.equal(o.decision,'deny');
});

test('Cursor blocks a prompt with a raw path and lets a project name through',()=>{
 const o=run(CURSOR,{hook_event_name:'beforeSubmitPrompt',workspace_roots:[CWD],prompt:'open C:\\Users\\Anna\\SecretGame\\a.ts'});
 assert.equal(o.continue,false); assert.match(o.user_message,/PROJECT_ROOT/);
 assert.deepEqual(run(CURSOR,{hook_event_name:'beforeSubmitPrompt',workspace_roots:[CWD],prompt:'add a test to SecretGame'}),{continue:true});
});

test('Cursor preToolUse localizes a shell command from the payload workspace',()=>{
 const o=run(CURSOR,{hook_event_name:'preToolUse',cwd:CWD,tool_name:'Shell',tool_input:{command:'cat <PROJECT_ROOT>/a.ts'}});
 assert.deepEqual(o,{permission:'allow',updated_input:{command:'cat C:/Users/Anna/SecretGame/a.ts'}});
 assert.deepEqual(run(CURSOR,{hook_event_name:'preToolUse',cwd:CWD,tool_name:'Shell',tool_input:{command:'ls'}}),{permission:'allow'});
});

test('Cursor preToolUse denies a masked secret and leaves MCP tools alone',()=>{
 assert.equal(run(CURSOR,{hook_event_name:'preToolUse',cwd:CWD,tool_name:'Write',tool_input:{contents:'key=<SECRET_1>'}}).permission,'deny');
 assert.deepEqual(run(CURSOR,{hook_event_name:'preToolUse',cwd:CWD,tool_name:'MCP:search',tool_input:{q:'<PROJECT_ROOT>'}}),{permission:'allow'});
});
