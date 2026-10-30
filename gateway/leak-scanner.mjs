const PATTERNS = [
  ['windows-path', /\b[A-Za-z]:\\(?:[^\r\n"<>|?*]+\\)*[^\r\n"<>|?*]*/],
  ['windows-path-forward', /\b[A-Za-z]:\/(?:[^\r\n"<>|?*]+\/)*[^\r\n"<>|?*]*/],
  ['unc-path', /\\\\[^\s\\/]+[\\/][^\s"<>|?*]+/],
  ['posix-home-path', /\/(?:Users|home)\/[A-Za-z0-9._-]+\/[A-Za-z0-9._~+@%:/\\-]+/],
  ['private-ip', /\b(?:10(?:\.\d{1,3}){3}|192\.168(?:\.\d{1,3}){2}|172\.(?:1[6-9]|2\d|3[01])(?:\.\d{1,3}){2})\b/],
  ['anthropic-key', /\bsk-ant-[A-Za-z0-9_-]{20,}\b/],
  ['openai-key', /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['aws-access-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['private-key', /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/],
  ['git-ssh-remote', /\bgit@[A-Za-z0-9.-]+:[^\s"']+\/[^\s"']+(?:\.git)?\b/]
];

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

function safeExampleEmail(email) {
  const x = email.toLowerCase();
  return x.endsWith('@example.com') || x.endsWith('@example.org') || x.endsWith('@example.net') || x.endsWith('@test.invalid');
}

function extraTermAppears(text, term) {
  const value = String(term || '').trim();
  if (value.length < 3) return false;
  // Path/URL-like values are checked literally. Scalar workspace identities use
  // identifier boundaries to avoid false positives (e.g. user "Mark" vs "Marketing").
  if (/[\\/:@]/.test(value)) return text.toLowerCase().includes(value.toLowerCase());
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![A-Za-z0-9_-])${escaped}(?![A-Za-z0-9_-])`, 'i').test(text);
}

export function scanOutbound(text, extraTerms = []) {
  const kinds = [];
  for (const [kind, re] of PATTERNS) {
    re.lastIndex = 0;
    if (re.test(text)) kinds.push(kind);
  }
  EMAIL_RE.lastIndex = 0;
  for (const match of text.matchAll(EMAIL_RE)) {
    if (!safeExampleEmail(match[0])) {
      kinds.push('email');
      break;
    }
  }
  if (Array.isArray(extraTerms) && extraTerms.some(term => extraTermAppears(text, term))) {
    kinds.push('workspace-identity');
  }
  return [...new Set(kinds)];
}
