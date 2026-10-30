import test from 'node:test';
import assert from 'node:assert/strict';
import { PrivacyEngine, containsMaskedSecret } from '../core/privacy-engine.js';
import { mergeStates } from '../core/runtime.mjs';

const make = (o = {}) => new PrivacyEngine({ projectRoot:'C:\\Users\\Anna\\Dev\\SecretGame', cwd:'C:\\Users\\Anna\\Dev\\SecretGame', home:'C:\\Users\\Anna', temp:'C:\\Users\\Anna\\AppData\\Local\\Temp', computerName:'ANNAPC', gitRemote:'git@github.com:SecretStudio/SecretGame.git', ...o });
const DYN = kind => new RegExp(`<${kind}_[0-9a-f]{10}>`);

test('preserves technical tail while hiding project identity', () => {
  const e=make();
  const x=e.tokenizeString('Open C:\\Users\\Anna\\Dev\\SecretGame\\Source\\AI\\Enemy.cpp');
  assert.match(x, /<PROJECT_ROOT>\\Source\\AI\\Enemy\.cpp/);
  assert.doesNotMatch(x,/Anna|SecretGame|SecretStudio/i);
});

test('local tool detokenization restores real path', () => {
  const e=make();
  const x=e.detokenizeString('<PROJECT_ROOT>\\Source\\Foo.cpp');
  assert.equal(x,'C:\\Users\\Anna\\Dev\\SecretGame\\Source\\Foo.cpp');
});

test('emails and private ips become stable aliases', () => {
  const e=make();
  const a=e.tokenizeString('mail anna@corp.invalid ip 192.168.1.25');
  const b=e.tokenizeString('again anna@corp.invalid 192.168.1.25');
  assert.match(a,DYN('EMAIL')); assert.match(a,DYN('PRIVATE_IP'));
  assert.equal(a.match(DYN('EMAIL'))[0], b.match(DYN('EMAIL'))[0]);
  assert.equal(a.match(DYN('PRIVATE_IP'))[0], b.match(DYN('PRIVATE_IP'))[0]);
  assert.equal(e.detokenizeString(a),'mail anna@corp.invalid ip 192.168.1.25');
});

test('common secrets are one-way masked', () => {
  const e=make();
  const x=e.tokenizeString('token=sk-ant-abcdefghijklmnopqrstuvwxyz1234567890');
  assert.match(x,/<SECRET_\d+>/); assert.doesNotMatch(x,/sk-ant-/);
});

test('every casing of a scalar identity restores exactly', () => {
  const e=make({ projectRoot:'C:\\w\\server', cwd:'C:\\w\\server', gitRemote:'' });
  const src='const Server = new HttpServer(); // SERVER start\nserver.listen(); sErVeR';
  const tok=e.tokenizeString(src);
  assert.doesNotMatch(tok,/(?<![A-Za-z])server/i);
  assert.equal(e.detokenizeString(tok),src);
});

test('kebab-case compounds and project-root slugs do not leak identity', () => {
  const e=make();
  const x=e.tokenizeString('repo secretstudio-tools; memory at C:\\Users\\Anna\\.claude\\projects\\C--Users-Anna-Dev-SecretGame\\memory');
  assert.doesNotMatch(x,/Anna|SecretGame|SecretStudio/i);
  assert.match(x,/<HOME>\\\.claude\\projects\\<PROJECT_ROOT_SLUG>\\memory/);
  assert.equal(e.scanForLeaks(x).length,0);
  assert.equal(e.detokenizeString(x),'repo secretstudio-tools; memory at C:\\Users\\Anna\\.claude\\projects\\C--Users-Anna-Dev-SecretGame\\memory');
});

test('code that only names a secret is left intact', () => {
  const e=make();
  const code='password = request.form["pw"]\ntoken = getAccessToken()\napi_key: process.env.API_KEY\nsecret = accessTokenValue';
  assert.equal(e.tokenizeString(code),code);
});

test('literal secrets in assignments are masked', () => {
  const e=make();
  const x=e.tokenizeString('password = "hunter2pass"\ntoken=abc123def456');
  assert.equal(x,'password = "<SECRET_1>"\ntoken=<SECRET_2>');
});

test('the same secret keeps one alias', () => {
  const e=make();
  assert.equal(e.tokenizeString('k sk-ant-abcdefghijklmnopqrstuvwxyz123'),'k <SECRET_1>');
  assert.equal(e.tokenizeString('k sk-ant-abcdefghijklmnopqrstuvwxyz123'),'k <SECRET_1>');
});

test('bearer tokens, URL passwords and Google API keys are masked', () => {
  const e=make();
  const x=e.tokenizeString('Authorization: Bearer abcdefghijklmnop1234 postgres://admin:hunter2pass@db.internal:5432/app AIzaSyA1234567890abcdefghijklmnopqrstuv');
  assert.match(x,/^Authorization: Bearer <SECRET_\d> postgres:\/\/admin:<SECRET_\d>@db\.internal:5432\/app <SECRET_\d>$/);
});

test('file names with @ are not emails', () => {
  const e=make();
  const s='import logo from "./logo@2x.png"; pkg foo@1.2.3.tgz';
  assert.equal(e.tokenizeString(s),s);
});

test('regex bodies and bare drives are not paths', () => {
  const e=make();
  const s='re /a:\\d+/ then C:\\file.txt then abc: def';
  assert.equal(e.tokenizeString(s),s);
});

test('a bare path with spaces is aliased whole', () => {
  const e=make();
  const x=e.tokenizeString('open D:\\My Games\\Secret Title\\save.dat now');
  assert.doesNotMatch(x,/Games|Secret Title/);
  assert.match(x,/\\save\.dat now$/);
  assert.equal(e.detokenizeString(x),'open D:\\My Games\\Secret Title\\save.dat now');
});

test('file URLs with a drive are still aliased', () => {
  const e=make();
  assert.match(e.tokenizeString('file:///D:/Clients/Acme/x.txt'),/^file:\/\/\/<EXTERNAL_ROOT_[0-9a-f]{10}>\/x\.txt$/);
});

test('aliases from concurrent engines never collide and merge losslessly', () => {
  const p1=make(); const p2=make();
  const a=p1.tokenizeString('D:\\data\\alpha\\x.txt');
  const b=p2.tokenizeString('E:\\other\\beta\\y.txt');
  assert.notEqual(a.match(DYN('EXTERNAL_ROOT'))[0], b.match(DYN('EXTERNAL_ROOT'))[0]);
  const merged=mergeStates(p1.exportState(),p2.exportState());
  const p3=make({ persisted:merged });
  assert.equal(p3.detokenizeString(a),'D:\\data\\alpha\\x.txt');
  assert.equal(p3.detokenizeString(b),'E:\\other\\beta\\y.txt');
});

test('the vault is loaded lazily, only when a dynamic value needs it', () => {
  let loads=0;
  const state=make().exportState();
  const e=make({ loadPersisted:() => { loads+=1; return state; } });
  e.tokenizeString('C:\\Users\\Anna\\Dev\\SecretGame\\a.ts');
  e.detokenizeString('<PROJECT_ROOT>\\a.ts');
  assert.equal(loads,0);
  e.tokenizeString('mail bob@corp.invalid');
  assert.equal(loads,1);
});

test('an alias unknown in memory triggers a vault load', () => {
  const first=make();
  const alias=first.tokenizeString('bob@corp.invalid');
  const e=make({ loadPersisted:() => first.exportState() });
  assert.equal(e.detokenizeString(`to ${alias}`),'to bob@corp.invalid');
});

test('masked secret placeholders are detectable in tool arguments', () => {
  assert.equal(containsMaskedSecret({ content:'key=<SECRET_3>' }),true);
  assert.equal(containsMaskedSecret({ content:'<PROJECT_ROOT>' }),false);
});

test('shell detokenization quotes roots with spaces and uses forward slashes', () => {
  const e=make({ projectRoot:'C:\\My Projects\\proj', cwd:'C:\\My Projects\\proj' });
  assert.equal(e.detokenizeString('type <PROJECT_ROOT>\\src\\a.txt',{ shell:true }),'type "C:/My Projects/proj/src/a.txt"');
});
