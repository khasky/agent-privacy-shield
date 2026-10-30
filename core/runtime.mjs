import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PrivacyEngine, fingerprint } from './privacy-engine.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const VAULT_DIR = process.env.AGENT_PRIVACY_SHIELD_DATA ||
  (process.platform === 'win32'
    ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'AgentPrivacyShield')
    : path.join(os.homedir(), '.agent-privacy-shield'));
const VAULT_FILE = path.join(VAULT_DIR, 'vault-v1.json');
const LOCK_FILE = `${VAULT_FILE}.lock`;
const LOCK_STALE_MS = 10_000;
const LOCK_WAIT_MS = 5_000;

function runGit(cwd, args) {
  try { return execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf8', stdio: ['ignore','pipe','ignore'] }).trim(); }
  catch { return ''; }
}

export function discoverWorkspace(cwd = process.cwd()) {
  const root = runGit(cwd, ['rev-parse','--show-toplevel']) || cwd;
  const remote = runGit(root, ['config','--get','remote.origin.url']);
  return {
    cwd,
    projectRoot: root,
    gitRemote: remote,
    home: process.env.USERPROFILE || process.env.HOME || os.homedir(),
    temp: process.env.TEMP || process.env.TMP || os.tmpdir(),
    computerName: process.env.COMPUTERNAME || os.hostname()
  };
}

function psDpapi(mode, text) {
  if (process.platform !== 'win32') throw new Error('DPAPI is only available on Windows');
  const helper = path.join(HERE, 'dpapi.ps1');
  const r = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File', helper, '-Mode', mode], {
    input: text, encoding:'utf8', windowsHide:true, maxBuffer: 16 * 1024 * 1024
  });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error((r.stderr || `DPAPI ${mode} failed`).trim());
  return (r.stdout || '').trim();
}

function readVault() {
  try {
    const v = JSON.parse(fs.readFileSync(VAULT_FILE, 'utf8'));
    return v && typeof v === 'object' ? v : { version:1, projects:{} };
  } catch { return { version:1, projects:{} }; }
}

function writeVault(vault) {
  fs.mkdirSync(VAULT_DIR, { recursive:true });
  const tmp = `${VAULT_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(vault, null, 2), { encoding:'utf8', mode:0o600 });
  fs.renameSync(tmp, VAULT_FILE);
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

// Serializes read-merge-write so concurrent hook processes never drop each other's aliases.
function withVaultLock(fn) {
  fs.mkdirSync(VAULT_DIR, { recursive:true });
  const deadline = Date.now() + LOCK_WAIT_MS;
  let fd;
  while (fd === undefined) {
    try { fd = fs.openSync(LOCK_FILE, 'wx'); }
    catch (err) {
      if (err.code !== 'EEXIST') throw err;
      try { if (Date.now() - fs.statSync(LOCK_FILE).mtimeMs > LOCK_STALE_MS) fs.rmSync(LOCK_FILE, { force:true }); } catch {}
      if (Date.now() > deadline) throw new Error('vault lock timeout');
      sleepSync(25);
    }
  }
  try { return fn(); }
  finally { fs.closeSync(fd); fs.rmSync(LOCK_FILE, { force:true }); }
}

export function projectKey(projectRoot) {
  return fingerprint(String(projectRoot || '').replaceAll('\\','/').toLowerCase());
}

function unprotectRow(row) {
  return row?.blob ? JSON.parse(psDpapi('unprotect', row.blob)) : undefined;
}

// Returns the stored state, undefined when there is none, and throws when the vault cannot be read.
export function loadPersisted(projectRoot) {
  if (process.platform !== 'win32') throw new Error('no protected store on this platform'); // fail-private: never plaintext-persist aliases
  return unprotectRow(readVault().projects?.[projectKey(projectRoot)]);
}

export function savePersisted(projectRoot, state) {
  if (process.platform !== 'win32') throw new Error('no protected store on this platform');
  return withVaultLock(() => {
    const vault = readVault();
    vault.projects ||= {};
    const key = projectKey(projectRoot);
    const stored = unprotectRow(vault.projects[key]);
    const merged = mergeStates(stored, state);
    vault.projects[key] = { version:2, mode:'windows-dpapi', blob: psDpapi('protect', JSON.stringify(merged)) };
    writeVault(vault);
    return merged;
  });
}

// Union by alias; a stored row wins, so an alias another agent already handed out keeps its meaning.
export function mergeStates(stored, ours) {
  const rows = new Map();
  for (const row of [...(stored?.dynamicMappings || []), ...(ours?.dynamicMappings || [])]) {
    if (row && typeof row.alias === 'string' && !rows.has(row.alias)) rows.set(row.alias, row);
  }
  return { version: 2, dynamicMappings: [...rows.values()] };
}

export function createRuntime(cwd = process.cwd()) {
  const meta = discoverWorkspace(cwd);
  let persistence = process.platform === 'win32' ? 'windows-dpapi (not loaded yet)' : 'memory-only (no protected store on this platform)';
  const engine = new PrivacyEngine({
    ...meta,
    loadPersisted: () => {
      try {
        const state = loadPersisted(meta.projectRoot);
        persistence = 'windows-dpapi';
        return state;
      } catch (err) {
        persistence = `memory-only (${String(err.message || err).split(/\r?\n/)[0]})`;
        return undefined;
      }
    }
  });
  const persist = () => {
    if (!engine.consumeDirty()) return persistence;
    try {
      engine.mergeState(savePersisted(meta.projectRoot, engine.exportState()));
      persistence = 'windows-dpapi';
    } catch (err) {
      persistence = `memory-only (${String(err.message || err).split(/\r?\n/)[0]})`;
    }
    return persistence;
  };
  // Long-lived hosts call this when another agent may have added aliases since the first load.
  const reload = () => {
    try { engine.mergeState(loadPersisted(meta.projectRoot)); } catch {}
  };
  const safe = (value, where='payload') => engine.sanitize(value, where);
  return { engine, meta, persist, reload, safe, persistence: () => persistence };
}
