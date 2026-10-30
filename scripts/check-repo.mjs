import fs from 'node:fs';
import { SHARED, LIB } from './sync-claude-lib.mjs';
const required=['README.md','SECURITY.md','package.json','plugin.json','gemini-extension.json','.antigravity-plugin/plugin.json','.claude-plugin/marketplace.json','.agents/plugins/marketplace.json','hooks/hooks.json','hooks.json','core/privacy-engine.js','adapters/claude-code/.claude-plugin/plugin.json','adapters/codex/hooks/hooks.json','adapters/kilo/plugin.js','.cursor-plugin/plugin.json','adapters/cursor/hooks.json'];
for(const p of required){ if(!fs.existsSync(p)){ console.error('missing',p); process.exitCode=1; } }
const pkg=JSON.parse(fs.readFileSync('package.json','utf8')); if(pkg.name!=='agent-privacy-shield'){console.error('wrong package name');process.exitCode=1;}
for(const f of SHARED){ const copy=`${LIB}/${f}`; if(!fs.existsSync(copy)||!fs.readFileSync(`core/${f}`).equals(fs.readFileSync(copy))){ console.error(`stale copy ${copy}: run npm run sync:claude-lib`); process.exitCode=1; } }
if(!process.exitCode) console.log('repo: ok');
