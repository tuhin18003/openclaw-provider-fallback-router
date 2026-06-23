# openclaw-provider-fallback-router

OpenClaw plugin that automatically routes to a fallback provider when the primary hits rate limits, quota errors, or auth failures.

```
[provider-fallback-router] Provider failure detected: codex limit has been reached
[provider-fallback-router] Switching to fallback provider: claude-code
[provider-fallback-router] codex is in cooldown (~60m remaining), routing to claude-code
```

## What it does

When you use OpenClaw with Codex as your primary provider and it hits:

- _"codex limit has been reached"_ / _"weekly limit"_ / _"daily limit"_
- _"quota exceeded"_ / _"rate limit"_ / _"429 Too Many Requests"_
- _"auth expired"_ / _"login expired"_ / _"unauthorized"_

…this plugin detects those failures, puts Codex in a cooldown period, and injects a system-prompt notice directing the gateway to use `claude-code` (or whichever fallback you configured) for subsequent requests.

Cooldown state is stored in `~/.openclaw/fallback-router.state.json` and survives gateway restarts.

---

## Installation

```bash
# From npm (after publish)
openclaw plugins install openclaw-provider-fallback-router

# From GitHub (before npm publish)
openclaw plugins install github:YOUR_USERNAME/openclaw-provider-fallback-router
```

Restart the OpenClaw gateway after installing:

```bash
openclaw gateway restart
```

---

## Configuration

Add to your OpenClaw config (`~/.openclaw/config.json` or via `openclaw config`):

```json
{
  "plugins": {
    "allow": [
      "provider-fallback-router",
      "claude-code"
    ],
    "entries": {
      "provider-fallback-router": {
        "enabled": true,
        "config": {
          "primaryProvider": "codex",
          "fallbackChain": ["claude-code"],
          "cooldownMinutes": 720,
          "errorPatterns": [
            "weekly limit",
            "daily limit",
            "usage limit",
            "limit reached",
            "limit has been reached",
            "quota exceeded",
            "rate limit",
            "too many requests",
            "auth expired",
            "login expired",
            "unauthorized",
            "token expired",
            "model login expired",
            "codex limit has been reached"
          ]
        }
      }
    }
  }
}
```

> **Note:** If `plugins.allow` is set you must add `"provider-fallback-router"` to the allowlist and restart the gateway after any config change.

---

## Config Reference

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | boolean | `true` | Enable / disable without uninstalling |
| `primaryProvider` | string | `"codex"` | Provider tried first |
| `fallbackChain` | string[] | `["claude-code"]` | Ordered fallback providers |
| `cooldownMinutes` | integer | `60` | Minutes to skip a failed provider |
| `errorPatterns` | string[] | see below | Patterns that trigger fallback |
| `injectStatusHint` | boolean | `true` | Inject system-prompt notice when primary is in cooldown |
| `stateFile` | string \| null | `~/.openclaw/fallback-router.state.json` | Override state file path |

### Error Patterns

Patterns are matched case-insensitively against provider error text.
Plain strings = substring match. `"/regex/flags"` format = compiled to `RegExp`.

```json
"errorPatterns": [
  "weekly limit",
  "rate limit",
  "/quota[_\\s]exceeded/i",
  "subscription required"
]
```

---

## How it works

The plugin registers a `before_prompt_build` hook in the OpenClaw plugin API. On every LLM request:

1. Reads the cooldown state file
2. If the primary provider is in cooldown, prepends a system-prompt notice recommending the fallback
3. If `api.runtime.llm.complete` is available, wraps it to detect failures and set cooldown automatically

When an error pattern is matched in a runtime LLM response, the plugin:
- Logs the failure
- Sets the primary provider in cooldown for `cooldownMinutes`
- Retries the same request via the fallback provider

---

## State management (CLI)

After installing globally:

```bash
npm install -g openclaw-provider-fallback-router
```

```bash
# View current cooldown status
openclaw-fallback-router status
openclaw-fallback-router status --json

# Clear a provider's cooldown
openclaw-fallback-router clear codex
openclaw-fallback-router clear        # clear all

# Test if text would trigger fallback
openclaw-fallback-router test "weekly limit has been reached"   # exit 0 = match
openclaw-fallback-router test "connection refused"              # exit 1 = no match

# Create a local config file
openclaw-fallback-router init
```

---

## Publish to npm

```bash
npm install              # install devDeps (esbuild, typescript)
npm run build            # compile to dist/index.js
npm run release:verify   # typecheck + build + dry-run pack

npm login
npm publish --access public
```

## Push to GitHub

```bash
git init
git add .
git commit -m "feat: initial release of openclaw-provider-fallback-router"
git remote add origin https://github.com/YOUR_USERNAME/openclaw-provider-fallback-router.git
git branch -M main
git push -u origin main
```

Users can then install from GitHub:

```bash
openclaw plugins install github:YOUR_USERNAME/openclaw-provider-fallback-router
```

---

## License

MIT — see [LICENSE](LICENSE)
