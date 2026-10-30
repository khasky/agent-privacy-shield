import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const pluginRoot=path.join(root,'adapters','claude-code');
const env={ ...process.env, AGENT_PRIVACY_SHIELD_DATA: fs.mkdtempSync(path.join(os.tmpdir(),'aps-claude-')) };
const cwd=path.join(fs.mkdtempSync(path.join(os.tmpdir(),'aps-ws-')),'SecretGame');
fs.mkdirSync(cwd);
test.after(()=>{ for (const dir of [env.AGENT_PRIVACY_SHIELD_DATA, path.dirname(cwd)]) fs.rmSync(dir,{recursive:true,force:true}); });
const hostEnv={ USERPROFILE:'C:\\Users\\Anna', TEMP:'C:\\Users\\Anna\\AppData\\Local\\Temp', COMPUTERNAME:'ANNAPC' };

// The engine interface a hooks module sees, backed by real processes for git and the vault CLI.
const $={
  plugin:{ name:'agent-privacy-shield', root:pluginRoot },
  session:{ cwd:async()=>cwd },
  env:{ get:async name=>hostEnv[name] },
  command:{ register:async()=>({}) },
  process:{ run:async(argv,init={})=>{
    const r=spawnSync(argv[0]==='node'?process.execPath:argv[0],argv.slice(1),{ input:init.stdin, encoding:'utf8', env });
    return { exitCode:r.status ?? 1, stdout:r.stdout || '', stderr:r.stderr || String(r.error || '') };
  } }
};

let instance=0;
async function load(){
  const hooks={};
  const mod=await import(`${pathToFileURL(path.join(pluginRoot,'hooks','register.js')).href}?i=${instance++}`);
  mod.register((name,matcherOrHook,maybeHook)=>{
    hooks[name]=maybeHook || matcherOrHook;
    return { catch(){ return this; } };
  });
  return hooks;
}
function nextReturning(value){
  const next=async e=>{ next.seen=e; return typeof value==='function' ? value(e) : value; };
  return next;
}

test('Claude adapter imports nothing but its own files', () => {
  const src=fs.readFileSync(path.join(pluginRoot,'hooks','register.js'),'utf8');
  for (const [,spec] of src.matchAll(/^import .* from '([^']+)'/gm)) assert.match(spec,/^\.\//);
  const engine=fs.readFileSync(path.join(pluginRoot,'hooks','lib','privacy-engine.js'),'utf8');
  assert.doesNotMatch(engine,/^import /m);
});

test('tool.call localizes arguments and virtualizes the result', async () => {
  const h=await load();
  const next=nextReturning({ ref:'r1', result:{ content:`see ${cwd}${path.sep}a.txt` }, text:'ok' });
  const out=await h['tool.call']($,{ tool:'Read', tool_use_id:'t1', file_path:'<PROJECT_ROOT>/a.txt' },next);
  assert.equal(next.seen.file_path,`${cwd}/a.txt`);
  assert.equal(next.seen.tool_use_id,'t1');
  assert.equal(out.ref,'r1');
  assert.match(out.result.content,/^see <PROJECT_ROOT>/);
});

test('tool.call refuses to write a masked secret placeholder', async () => {
  const h=await load();
  const next=nextReturning({ result:{} });
  const out=await h['tool.call']($,{ tool:'Write', file_path:'<PROJECT_ROOT>/.env', content:'KEY=<SECRET_1>' },next);
  assert.match(out.deny,/masked secret/);
  assert.equal(next.seen,undefined);
});

test('prompt.compose sanitizes session sections and keeps shared ones', async () => {
  const h=await load();
  const sections=[{ id:'intro', scope:'shared', text:'You are an agent.' }, { id:'env', scope:'session', text:`Working directory: ${cwd}\nUser: anna@corp.invalid` }];
  const out=await h['prompt.compose']($,{},nextReturning({ sections }));
  assert.equal(out.sections[0],sections[0]);
  assert.doesNotMatch(out.sections[1].text,/SecretGame|anna@/);
  assert.match(out.sections[1].text,/<PROJECT_ROOT>/);
});

test('prompt.context sanitizes context blocks', async () => {
  const h=await load();
  const out=await h['prompt.context']($,{ blocks:[] },nextReturning({ blocks:[{ name:'userEmail', text:'anna@corp.invalid' }] }));
  assert.match(out.blocks[0].text,/^<EMAIL_[0-9a-f]{10}>$/);
});

test('prompt.submit rewrites the prompt and adds the privacy note', async () => {
  const h=await load();
  const next=nextReturning(e=>({ text:e.text }));
  await h['prompt.submit']($,{ text:`fix ${cwd}${path.sep}b.ts`, context:[] },next);
  assert.match(next.seen.text,/^fix <PROJECT_ROOT>/);
  assert.match(next.seen.context.at(-1),/Agent Privacy Shield is active/);
});

test('session.append sanitizes transcript rows', async () => {
  const h=await load();
  const next=nextReturning(e=>e);
  await h['session.append']($,{ message:{ role:'user', content:[{ type:'text', text:`in ${cwd}` }] } },next);
  assert.equal(next.seen.message.content[0].text,'in <PROJECT_ROOT>');
});

test('dynamic aliases survive a module reload through the vault', { skip:process.platform!=='win32' && 'DPAPI vault is Windows-only' }, async () => {
  const first=await load();
  const out=await first['tool.call']($,{ tool:'Read', file_path:'x' },nextReturning({ result:{ content:'mail bob@corp.invalid' } }));
  const alias=out.result.content.match(/<EMAIL_[0-9a-f]{10}>/)[0];
  const second=await load();
  const status=await second['command.run']($,{ command:'privacy-shield' });
  assert.match(status.text,/Mapping persistence: windows-dpapi/);
  const next=nextReturning({ result:{} });
  await second['tool.call']($,{ tool:'Write', file_path:'x', content:alias },next);
  assert.equal(next.seen.content,'bob@corp.invalid');
});
