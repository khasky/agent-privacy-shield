import fs from 'node:fs'; import path from 'node:path'; import { spawnSync } from 'node:child_process';
const roots=['core','gateway','adapters','tests','scripts']; let bad=0;
function walk(p){ for(const e of fs.readdirSync(p,{withFileTypes:true})){ const q=path.join(p,e.name); if(e.isDirectory()) walk(q); else if(/\.(mjs|js)$/.test(e.name)){ const r=spawnSync(process.execPath,['--check',q],{encoding:'utf8'}); if(r.status!==0){ console.error(q,r.stderr); bad++; } } } }
for(const r of roots) if(fs.existsSync(r)) walk(r); if(bad) process.exit(1); console.log('syntax: ok');
