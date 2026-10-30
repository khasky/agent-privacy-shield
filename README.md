# Agent Privacy Shield

**Agent Privacy Shield** is a local semantic privacy layer for coding agents. It virtualizes identifying paths and workspace identity into stable aliases such as `<PROJECT_ROOT>` while preserving the technical structure the agent needs to work correctly.

Supported targets in this repository:

| Agent | Adapter | Current protection level |
|---|---|---|
| Claude Code | native function-hook plugin | **FULL** |
| Gemini CLI | extension using `BeforeModel` / `BeforeTool` | **FULL** |
| Kilo Code | in-process plugin using `experimental.chat.*` and `tool.*` hooks | **FULL** |
| Codex | portable plugin + lifecycle hooks | **PARTIAL / conservative** |
| Cursor | plugin + `beforeSubmitPrompt` / `preToolUse` hooks | **PARTIAL / conservative** |
| Antigravity | native plugin + lifecycle hooks | **PARTIAL** |

`FULL` means the host exposes a documented point where the outgoing model request can be rewritten before it reaches the remote model. `PARTIAL` is intentionally not presented as equivalent privacy.

> Security-sensitive MVP: read [SECURITY.md](SECURITY.md). This project reduces disclosure; it is not a formal security boundary against an administrator who controls your endpoint.

## What the model sees

Local:

```text
C:\Users\Anna\Dev\ProjectNightfall\Source\AI\Enemy.cpp
```

Remote model:

```text
<PROJECT_ROOT>\Source\AI\Enemy.cpp
```

Automatically inferred aliases include:

```text
<PROJECT_ROOT>
<PROJECT_ROOT_SLUG>
<PROJECT_NAME>
<HOME>
<LOCAL_USER>
<GIT_REMOTE>
<GIT_ORG>
<REPO_NAME>
<HOSTNAME>
<EMAIL_3f2a9c1b07>
<PRIVATE_IP_8d41e0a2c5>
<EXTERNAL_ROOT_b19c77e403>
```

Names keep their casing on the way back: `Server`, `SERVER` and `server` get `<PROJECT_NAME_TITLE>`, `<PROJECT_NAME_UPPER>` and `<PROJECT_NAME_LOWER>` when the canonical name differs. Dynamic aliases (emails, IPs, external roots) carry a random suffix, so two agents running at once never hand out the same alias for different values.

High-risk credentials are one-way masked as `<SECRET_n>`. Because the real value is never restored, every adapter refuses a local tool call whose arguments contain a `<SECRET_n>` placeholder instead of writing the placeholder into a file or command.

## Install

Install the plugin with your agent's own plugin command; no clone or setup script is needed. Each agent has its own plugin system, so install once per agent you use. The plugin works in whichever project you open; there is nothing to configure.

```powershell
claude plugin install agent-privacy-shield --marketplace khasky/agent-privacy-shield
gemini extensions install https://github.com/khasky/agent-privacy-shield --consent
agy plugin install https://github.com/khasky/agent-privacy-shield
codex plugin marketplace add khasky/agent-privacy-shield
codex plugin add agent-privacy-shield@agent-privacy-shield
```

Kilo Code and Cursor have no install command for a plugin from a Git repository; see [Kilo Code](#kilo-code) and [Cursor](#cursor) for their steps.

Things to know before you start:

- **Requirements:** `node` 18 or newer and `git` on `PATH`; the workspace is discovered with `git`. The Gemini CLI, Codex, Cursor and Antigravity hooks are `node` commands, so without `node` they do not run and nothing is sanitized. Claude Code runs the hooks itself and needs `node` only for the alias vault; without it protection stays on with `memory-only` persistence.
- **Restart the agent** after installing. Protection starts with the next session; a session that was already open stays unprotected.
- **Codex needs one trust step.** Codex skips plugin hooks until you approve them: start `codex`, run `/hooks` and trust the agent-privacy-shield hooks. Codex asks again after every update, because trust is tied to the hook definition.
- **Local clone:** each command also takes the path of a clone in place of the GitHub source, for example `claude plugin install agent-privacy-shield --marketplace D:\src\agent-privacy-shield`. Gemini copies the extension at install time, so after pulling changes run `gemini extensions update agent-privacy-shield`.
- **Persistence is Windows-only for now.** On macOS and Linux the plugin works, but aliases for emails, IPs and outside paths are not remembered between hook calls; see [Shared alias vault](#shared-alias-vault).
- **Gemini CLI or Antigravity CLI:** Google moved unpaid-tier and Google One users from Gemini CLI to Antigravity CLI. Install into whichever of the two you actually run; Antigravity protection is PARTIAL.

Update or remove:

| Agent | Update | Remove |
|---|---|---|
| Claude Code | `claude plugin update agent-privacy-shield`, then restart | `claude plugin uninstall agent-privacy-shield` |
| Gemini CLI | `gemini extensions update agent-privacy-shield` | `gemini extensions uninstall agent-privacy-shield` |
| Antigravity | no update command; `agy plugin uninstall`, then install again | `agy plugin uninstall agent-privacy-shield` |
| Codex | `codex plugin marketplace upgrade`, then `codex plugin add agent-privacy-shield@agent-privacy-shield` and trust the hooks again in `/hooks` | `codex plugin remove agent-privacy-shield@agent-privacy-shield` |
| Kilo Code | `git pull` in the clone, then restart Kilo | remove the entry from `"plugin"` in `kilo.json` |
| Cursor | `git pull` in the clone, then **Developer: Reload Window** | delete `~/.cursor/plugins/local/agent-privacy-shield` |

Removing the plugin leaves the alias vault in place; delete `%LOCALAPPDATA%\AgentPrivacyShield` to remove it too.

### Claude Code

`--marketplace` adds the repository's marketplace and installs the plugin in one step; the plugin is enabled at once. To check that protection is on, run inside Claude Code:

```text
/privacy-shield
```

It should report `Agent Privacy Shield: active` and `Mapping persistence: windows-dpapi` (on macOS and Linux, `memory-only`).

The hooks module sanitizes the per-session system prompt sections (`prompt.compose`), the first-message context blocks such as `claudeMd` and `userEmail` (`prompt.context`), each prompt, local tool arguments and results, and every transcript row. A section or block that still holds a known sensitive value after rewriting is dropped rather than sent.

### Gemini CLI

The repository root is a valid Gemini extension. `--consent` accepts the extension's security notice without the interactive prompt; leave it out to read the notice first.

Gemini's `BeforeModel` hook sanitizes the stable SDK-agnostic LLM request immediately before it is sent, history included. `BeforeTool` resolves aliases only for local execution. A hook failure exits with code 2, which Gemini treats as a block; any other failure would let the request through with a warning.

### Codex

The repository root is also a portable Agent Plugin and includes a Codex marketplace at `.agents/plugins/marketplace.json`. `codex plugin marketplace add` registers it and `codex plugin add` installs and enables the plugin; the hooks still need the one-time trust in `/hooks` described above. The current adapter is deliberately conservative: it localizes tool aliases, and because Codex `UserPromptSubmit` cannot replace a prompt it blocks one that carries a raw local path, email, private IP or secret. Bare project, user, org and host names are let through. `PreToolUse` answers only when it actually resolved an alias (Codex accepts `updatedInput` only together with `allow`); otherwise Codex's own approval flow is untouched. Use this mode as a guardrail, not as a full prompt-privacy guarantee.

### Kilo Code

Kilo installs plugins only from npm or from a file, so clone the repository and list the plugin file in the `"plugin"` array of a Kilo config: `kilo.json` in a project, or `~/.config/kilo/kilo.json` for every project.

```json
{
  "plugin": ["file:///D:/src/agent-privacy-shield/adapters/kilo/plugin.js"]
}
```

Restart Kilo afterwards. The plugin runs inside Kilo, so it needs no `node` of its own. It sanitizes each prompt, the system prompt, tool descriptions and the whole message history right before the model request is built, and resolves aliases only for local tools (`bash`, `read`, `write`, `edit`, `glob`, `grep` and the like). Kilo appends an `<environment_details>` block with the working directory after the history hook has run; the plugin supplies that block itself, already aliased, so Kilo does not add a raw one. These message hooks are marked experimental in Kilo and may change between releases.

### Cursor

Cursor installs plugins from its marketplace or from a local folder. Clone the repository into `~/.cursor/plugins/local/agent-privacy-shield` (on Windows `%USERPROFILE%\.cursor\plugins\local\agent-privacy-shield`), then run **Developer: Reload Window**. The manifest is `.cursor-plugin/plugin.json`; its hooks are in `adapters/cursor/hooks.json`.

Cursor hooks cannot rewrite a prompt, so the adapter works like the Codex one: `beforeSubmitPrompt` blocks a prompt that carries a raw local path, email, private IP or secret, and `preToolUse` resolves aliases for local tools through `updated_input`, leaving MCP tools and subagent prompts untouched. Both hooks are `failClosed`, so a crash or timeout blocks instead of letting data through. File contents the agent reads are not rewritten. This adapter follows Cursor's hook documentation but has not been run against Cursor itself yet.

### Antigravity

The same repository root is an Antigravity plugin via `.antigravity-plugin/plugin.json`; its hooks run as soon as the plugin is enabled. Current Antigravity hooks can rewrite local tool arguments, but the documented `PreInvocation` API injects steps rather than replacing the existing prompt. Therefore the adapter reports **PARTIAL**.

## Shared alias vault

All adapters use the same project-keyed local mapping store. On Windows the dynamic mapping state is protected with **DPAPI / CurrentUser** and stored under:

```text
%LOCALAPPDATA%\AgentPrivacyShield\vault-v1.json
```

The file contains encrypted blobs, not plaintext alias mappings. Writers take a lock file and merge with what is stored, so concurrent hook processes never drop each other's aliases. The vault is read only when a dynamic value or alias actually needs it.

This makes aliases stable across agents when you switch between Claude Code, Gemini CLI, Kilo Code, Codex, Cursor and Antigravity in the same project.

On macOS and Linux there is no protected store yet, so dynamic aliases live in memory only. Gemini CLI, Codex, Cursor and Antigravity run each hook as a new process, so there an alias such as `<EMAIL_…>` created in one hook cannot be resolved by the next one; known aliases (`<PROJECT_ROOT>`, `<HOME>`, names) work everywhere. `/privacy-shield` in Claude Code reports the persistence mode actually in effect.

## Design principle

**Remove identity, preserve relationships and structure.**

Bad:

```text
<FILE_8472>
```

Good:

```text
<PROJECT_ROOT>\Source\Character\Inventory\InventoryComponent.cpp
```

The second form hides identity without removing the structural information the coding agent needs.

## Repository layout

```text
agent-privacy-shield/
├── core/                       # canonical privacy engine + shared DPAPI vault
├── adapters/
│   ├── claude-code/
│   ├── codex/
│   ├── gemini-cli/
│   ├── kilo/
│   ├── cursor/
│   └── antigravity/
├── hooks/                      # Gemini extension hooks
├── hooks.json                  # Antigravity plugin hooks
├── plugin.json                 # portable Codex Agent Plugin manifest
├── gemini-extension.json       # Gemini extension manifest
├── .antigravity-plugin/        # Antigravity manifest
├── .cursor-plugin/             # Cursor manifest
├── .claude-plugin/             # Claude marketplace
├── .agents/plugins/            # Codex marketplace
├── gateway/                    # optional provider-agnostic final leak scanner
├── scripts/                    # repository checks
└── tests/
```

## Development

```powershell
npm test
npm run check
```

The repository tests core sanitization, simulated Gemini, Codex, Cursor and Antigravity hook payloads, the Kilo plugin hooks, and the Claude Code hooks module against a stand-in engine interface. Vendor CLIs are not required for unit tests. Tests write their vault to a temporary directory through `AGENT_PRIVACY_SHIELD_DATA`.

The Claude Code plugin installs only `adapters/claude-code`, so it carries a copy of `core/` in `adapters/claude-code/hooks/lib`. After editing `core/`, run `npm run sync:claude-lib`; `npm run check` fails while the copy is stale. The hooks module runs without Node APIs: it reaches git and the environment through the engine interface and the vault through `node hooks/lib/vault-cli.mjs`, so `node` must be on `PATH`. Check the module with `claude plugin validate adapters/claude-code`.

## Hard-boundary gateway

`gateway/privacy-gateway.mjs` is a provider-agnostic **block-only** final scanner. It does not silently rewrite a request at the network boundary. If a raw path, private email, private IP or common secret survives the native adapter, it rejects the request with HTTP 451.

The exact environment/configuration used to route an agent through a custom base URL differs by provider and changes over time, so this repository intentionally keeps hard-gateway launch configuration explicit rather than modifying vendor credentials automatically.

## Threat model

Agent Privacy Shield protects best against accidental disclosure of identifying local data to a remote model/transcript. It does not claim to hide task semantics from a remote model that must understand the task, and it cannot defeat endpoint administrators, EDR, organization-managed hooks that run before user hooks, or an agent host that disables third-party hooks.

See [SECURITY.md](SECURITY.md).
