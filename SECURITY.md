# Security model

Agent Privacy Shield is a **data minimization and semantic virtualization layer**, not encryption of the model's entire semantic context.

## Intended guarantees

Where a host exposes a documented model-boundary rewrite hook, the project attempts to ensure that known local identity values are replaced before the outgoing model request:

- workspace/root paths
- local username/home directory
- project/repository/org names inferred from Git/workspace metadata
- host names
- private IPv4 addresses
- email addresses
- common credential/token patterns

Aliases are stable so the agent can reason across turns without seeing the underlying real value.

## Protection levels

### FULL

The adapter has a documented model-request rewrite boundary and can sanitize the request immediately before the LLM call. Current FULL adapters in this release: Claude Code, Gemini CLI and Kilo Code (through Kilo's `experimental.chat.*` hooks, which Kilo may change).

### PARTIAL

The adapter can virtualize local tool arguments and/or add guardrails but does not have a documented equivalent prompt-body replacement boundary. Current PARTIAL adapters: Codex (conservative native mode), Cursor (conservative, same approach as Codex) and Antigravity.

PARTIAL must never be interpreted as 'the provider cannot see the prompt'.

## Shared vault

On Windows, dynamic mappings are encrypted with Windows DPAPI using `CurrentUser`. The plaintext mapping is not intentionally persisted. If DPAPI is unavailable, persistence falls back to memory-only rather than plaintext storage, and the Claude Code `/privacy-shield` status names the reason. Masked secrets are never persisted, not even encrypted.

## Out of scope

This project does not protect against:

- an administrator/root process controlling the endpoint
- EDR/MDM/keylogging/screen capture
- organization-managed hooks that execute before user-level hooks
- provider/account usage metadata outside request bodies
- semantics that the remote model itself needs to understand
- unknown secret/PII forms not matched by current rules
- malicious code with the same OS-user privileges

## Fail closed

FULL adapters block an event when the sanitizer detects a residual known sensitive value after transformation, and when the hook itself fails: Claude Code hooks carry fail-closed `.catch` handlers, and the Gemini hook exits with code 2. PARTIAL adapters block rather than silently downgrade when a prompt requires a rewrite that their documented hook API cannot perform. Every adapter refuses a local tool call that would write a `<SECRET_n>` placeholder.

## Reporting

Please do not include real secrets or personal data in bug reports. Reproduce issues with synthetic values such as `C:\\Users\\Alice\\ExampleProject` and `alice@example.org`.
