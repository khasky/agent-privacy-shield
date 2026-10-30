// The Claude Code plugin installs only adapters/claude-code, so it carries a copy of core/.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const SHARED = ['privacy-engine.js', 'runtime.mjs', 'vault-cli.mjs', 'dpapi.ps1'];
export const LIB = 'adapters/claude-code/hooks/lib';

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] || '')) {
  for (const f of SHARED) fs.copyFileSync(`core/${f}`, `${LIB}/${f}`);
  console.log(`synced ${SHARED.length} files into ${LIB}`);
}
