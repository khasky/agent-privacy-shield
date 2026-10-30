// Vault access for hosts whose hook runtime has no Node APIs (the Claude Code hooks module).
// Usage: node vault-cli.mjs load <projectRoot>
//        node vault-cli.mjs save <projectRoot>   (state JSON on stdin)
// Prints {"state": ...} and exits 0, or prints the error on stderr and exits 1.
import { loadPersisted, savePersisted } from './runtime.mjs';

const [mode, projectRoot] = process.argv.slice(2);
try {
  if (!projectRoot) throw new Error('usage: vault-cli.mjs load|save <projectRoot>');
  let state;
  if (mode === 'load') {
    state = loadPersisted(projectRoot);
  } else if (mode === 'save') {
    let input = '';
    for await (const chunk of process.stdin) input += chunk;
    state = savePersisted(projectRoot, JSON.parse(input || '{}'));
  } else {
    throw new Error(`unknown mode: ${mode}`);
  }
  process.stdout.write(JSON.stringify({ state: state ?? null }));
} catch (err) {
  process.stderr.write(String(err.message || err));
  process.exitCode = 1;
}
