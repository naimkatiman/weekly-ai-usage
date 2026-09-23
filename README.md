# Weekly AI Usage

A small Windows tray dashboard that shows the weekly quota of every AI subscription you are signed into: several Claude accounts, several Codex accounts, Grok and Devin, side by side in one table.

Built for people who run more than one account per provider (work and personal, or one per client) and keep hitting a weekly limit on the wrong one.

![Dashboard with two Claude, two Codex, one Grok and one Devin account](docs/screenshot.png)

## What it reads

| Provider | Plan | Weekly window | Short window | Credentials it reads |
| --- | --- | --- | --- | --- |
| Claude | Pro / Max | 7 day | 5 hour | `<home>/.credentials.json` and `<home>/.claude.json` (Claude Code config dir) |
| Codex | Plus / Pro | 7 day | 5 hour | `<home>/auth.json` (Codex CLI home) |
| Grok | SuperGrok | weekly credits | none | `<home>/auth.json` (default `~/.grok`) |
| Devin | Pro / Max | weekly | daily | the installed `devin` CLI's own login (default `server.codeium.com` login only) |

It only reads logins that already exist. It never refreshes tokens, switches accounts, sends prompts or spends credits. Each token goes only to its own provider's usage endpoint. Claude, Codex and Devin replies are checked against the configured email, so one account's numbers are never shown under another. Grok's usage reply carries no identity, so Grok is matched on the email the Grok CLI stored next to its key.

## Setup

Requirements: Windows 10 or 11, [Node.js 20+](https://nodejs.org), and the provider CLIs you already use.

1. Clone this repo.
2. Build the window (uses the C# compiler that ships with Windows, no SDK needed):
   `powershell -NoProfile -ExecutionPolicy Bypass -File build.ps1`
3. Copy `accounts.example.json` to `accounts.json` and list your logins.
4. Run `WeeklyUsage.exe`. It checks on launch and every 15 minutes, and minimizes to the tray.

## Multiple accounts per provider

Claude Code and Codex both keep a login per config folder. Give each account its own folder, sign in once per folder, and point `home` at it:

```powershell
# one-time sign-in per account
$env:CLAUDE_CONFIG_DIR = "$HOME\.claude-work"; claude    # then /login as work@example.com
$env:CODEX_HOME = "$HOME\.codex-work"; New-Item -ItemType Directory -Force $env:CODEX_HOME | Out-Null
codex login                                               # as work@example.com (Codex needs the folder to exist)
```

```json
{
  "accounts": [
    { "provider": "claude", "email": "me@example.com" },
    { "provider": "claude", "email": "work@example.com", "label": "Work", "home": "~/.claude-work" },
    { "provider": "codex", "email": "work@example.com", "home": "~/.codex-work" },
    { "provider": "grok", "email": "me@example.com" },
    { "provider": "devin", "email": "work@example.com", "cli": "C:/path/to/devin.exe" }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | `claude`, `codex`, `grok` or `devin` |
| `email` | yes | the account's email. Claude, Codex and Devin readings for any other identity are rejected. |
| `home` | no | that account's config folder. Without it, the default profile (`~/.claude`, `~/.codex`, `~/.grok`) is used when its email matches. |
| `label` | no | shown before the email |
| `plan` | no | display name when the provider does not report one |
| `cli` | no | Devin only: path to `devin.exe` if it is not on PATH |

Each provider and email pair can appear once, so two workspaces or orgs under the same email are not supported. Write Windows paths with forward slashes (`C:/tools/devin.exe`); single backslashes are invalid JSON. Set `WEEKLY_USAGE_CONFIG` to keep the file somewhere else.

## Behaviour

- **Expired login:** the row says so. Open that account's CLI, run `/usage` or sign in, then click Refresh now. The Sign-in help button shows the exact step for the selected row.
- **Failed read:** the last good reading for the same account stays on screen marked Stale, with its original time, for up to 24 hours.
- **Passed reset:** shows Reset pending. It never assumes a fresh 0%.
- **Missing numbers** show as Unavailable, never as zero.
- Launching it twice brings the existing window back, recentred if its last monitor is gone.
- `usage-cache.json` holds emails and percentages only, never tokens. It is gitignored.

Headless: `node collect.cjs` prints the same JSON the window shows, so scripts can use it on Windows or Linux. On macOS, Claude Code keeps its login in the Keychain instead of `.credentials.json`, so Claude rows report no matching login there.

## Caveats

These are the endpoints the official CLIs use to show your usage. They are not public APIs and can change without notice. Grok and Devin replies are decoded from protobuf with strict checks; anything malformed or ambiguous is reported as Unavailable rather than guessed.

Devin's status call needs the native client's request fingerprint, so the collector runs `devin auth status` against a short-lived loopback relay that forwards only two fixed read-only routes to `server.codeium.com` and closes after the probe. It first checks which server the login belongs to, and refuses enterprise or regional Devin logins rather than send their credentials to the default server.

Endpoint references: [CodexBar provider notes](https://github.com/steipete/CodexBar/tree/main/docs) for Claude, Codex and Grok.

## Development

```
node --test collect.test.cjs
```

`collect.cjs` builds the snapshot, `grok.cjs` and `devin.cjs` decode those providers' binary replies, `WeeklyUsage.cs` is the WinForms window.

## License

MIT. See [LICENSE](LICENSE).

Tray icon: Lucide gauge geometry, Copyright (c) Lucide Contributors, ISC License.
