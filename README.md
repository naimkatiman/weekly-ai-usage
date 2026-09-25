See which AI account has quota left
==================================

Check before your next coding session. Weekly AI Usage puts the reported weekly usage, remaining quota and reset times for your Claude, Codex, Grok and Devin accounts in one Windows tray dashboard. Keep separate rows for work and personal accounts.

[Download for Windows](https://github.com/naimkatiman/weekly-ai-usage/releases/download/v0.2.0-preview.1/WeeklyAIUsage-0.2.0-preview.1-Setup-x64.exe)

Windows 10 or 11, x64. Preview v0.2.0-preview.1. The installer includes Node.js; no separate Node.js installation is required. You need a supported provider CLI that you have already signed into. [Release notes and checksums](https://github.com/naimkatiman/weekly-ai-usage/releases).

This preview is not code-signed. Windows may show an unknown-publisher or SmartScreen prompt.

![Dashboard with three accounts and account management controls](docs/screenshot.png)

Synthetic demo data. These readings illustrate the UI and are not live account results.

Get your first account working
------------------------------

1. Download and run the installer above. Open Weekly AI Usage from the Start Menu after installation.
2. Choose Add your first account, select its provider, then Find existing login. Confirm the email and choose Save account. For a custom profile, enter its folder first. Devin requires manual email entry.
3. Check the account row. Live with a weekly reading means the provider returned its quota. You can see the remaining allowance and reset time, then select the account to inspect its shorter usage window when available.

A detected email alone does not prove that the provider accepts the login. If the row is Unavailable, select it and open Sign-in help. Follow the instructions for that account, then choose Refresh now. See [troubleshooting](docs/troubleshooting.md) for login, installation and other setup failures.

The installer works for your Windows user without administrator rights. It adds a Start Menu shortcut and installs under `%LOCALAPPDATA%\Programs\Weekly AI Usage` by default. It does not change PATH or enable automatic startup. The app reads your existing provider login; it does not sign you in.

Use Manage accounts to edit an account, or choose New account there to add another. A label such as Work or Personal is optional. Start with one account so you can confirm its reading before adding the rest.

Minimize the window to keep it running in the tray. Closing the window with X exits the app. It checks on launch and every 15 minutes while running. Launching it again brings the existing window forward.

![First-run screen with Add your first account](docs/onboarding.png)

What it reads
-------------

| Provider | Plan | Weekly window | Short window | Existing login |
| --- | --- | --- | --- | --- |
| Claude | Pro / Max | 7 day | 5 hour | Claude Code profile; default `~/.claude` plus `~/.claude.json` |
| Codex | Plus / Pro | 7 day | 5 hour | `auth.json` in the Codex CLI home; default `~/.codex` |
| Grok | SuperGrok | weekly credits | none | `auth.json` in the Grok profile; default `~/.grok` |
| Devin | Pro / Max | weekly | daily | Installed Devin CLI's login at `server.codeium.com` only |

It only reads existing logins. It never refreshes tokens, switches accounts, sends prompts or spends credits. Find existing login reads local identity information; saving an account starts a network usage check. Tokens are sent only to their own provider's usage or identity endpoints. There is no shared dashboard service receiving them.

Claude, Codex and Devin replies are checked against the configured email. Grok's usage reply has no identity, so Grok is matched using the email its CLI stored with the key. The app does not store tokens in `accounts.json` or `usage-cache.json`. Those files do contain account emails; the cache also contains readings and status information.

Understanding the readings
--------------------------

| State | Meaning |
| --- | --- |
| Live | The provider returned a current reading for this account. |
| Stale | The latest check failed or the displayed reading is old. Its original capture time stays visible. A failed check can retain a previous reading for up to 24 hours. |
| Reset pending | The reported reset time has passed. The app waits for a new provider reading instead of assuming 0%. |
| Unavailable | No usable reading is available. Missing numbers are never displayed as zero. |

Select an account for its details and any error message. Use Refresh now after repairing a login or connection.

Multiple accounts and custom profiles
------------------------------------

Each provider and email pair can appear once. Separate workspaces or organizations under the same email are not supported. Each account needs an existing CLI login that matches its email.

For Claude and Codex, set Profile folder to the directory used by that account's CLI. A custom Claude profile contains `.credentials.json` and `.claude.json`; a custom Codex profile contains `auth.json`. Grok uses `auth.json` in its profile folder. The app does not move or create provider credentials. Use Sign-in help for the selected account's recovery instructions.

For Devin, set the optional Devin CLI path if `devin.exe` is not on PATH. Only the default server login is supported; enterprise and regional logins are rejected.

Manual configuration
--------------------

The account editor creates `accounts.json` beside the app by default, normally in `%LOCALAPPDATA%\Programs\Weekly AI Usage` for an installed copy. Set `WEEKLY_USAGE_CONFIG` before launching the app to use a different file; the editor and collector both use it. Existing account settings and additional JSON fields are preserved when the editor saves. If another process changes the file, reopen Manage accounts before saving again.

For manual setup, copy `accounts.example.json` to `accounts.json`, replace the example email with your own, and choose Refresh now. The example contains one account:

```json
{
  "accounts": [
    { "provider": "claude", "email": "me@example.com" }
  ]
}
```

| Field | Required | Meaning |
| --- | --- | --- |
| `provider` | yes | `claude`, `codex`, `grok` or `devin` |
| `email` | yes | The email of the existing provider login. |
| `home` | no | That account's profile folder, for example `~/.codex-work`. Without it, the provider's default folder is used. |
| `label` | no | Display label, for example `Work`. |
| `plan` | no | Display name when the provider does not report one. |
| `cli` | no | Devin only: path to `devin.exe` if it is not on PATH. |

Save JSON as UTF-8. Use forward slashes in Windows paths, such as `C:/tools/devin.exe`, or double each backslash. Never put credentials or tokens in this file.

Updates and removal
-------------------

To update an installed copy, exit the app and run the new installer. It keeps your account settings and usage cache. Back up `accounts.json` before updating. If you set `WEEKLY_USAGE_CONFIG`, back up that file instead and keep the same setting when launching the new version. Release packages do not contain a real `accounts.json` or `usage-cache.json`.

Moving from the old ZIP? Exit the old app first. Install the new version and clear Open Weekly AI Usage on the Finish screen. With both copies closed, copy only your old `accounts.json` into the installation folder, then open the installed app. If you already use `WEEKLY_USAGE_CONFIG`, keep it pointed at your existing configuration instead. There is no need to copy provider credential files or change their logins. The usage cache is optional and can be rebuilt by refreshing. Keep the old folder until the installed version reads your account correctly.

To uninstall, exit the app and remove Weekly AI Usage through Windows Settings > Apps. Uninstall removes the app files and shortcuts but preserves user-created `accounts.json` and `usage-cache.json`. To remove those too, deliberately delete them from the installation folder after uninstalling. Remove an external configuration file only if you no longer need it. Provider CLI logins remain in their own folders and are unchanged.

Portable ZIP and source users
----------------------------

The installer is the simplest setup. Earlier portable ZIPs remain available under [Releases](https://github.com/naimkatiman/weekly-ai-usage/releases) for manual use. They require [Node.js 20 or newer](https://nodejs.org) on PATH. Extract the entire ZIP to a writable folder, keep its files together, and open `WeeklyUsage.exe`.

To update a portable copy manually, exit it, extract the new package to a new folder and copy `accounts.json`, or retain your external `WEEKLY_USAGE_CONFIG` setting. To remove a portable copy, exit it and delete its extracted folder; this also deletes any settings and cache inside that folder.

Caveats
-------

These are endpoints used by the provider CLIs, not public APIs. They can change without notice. Grok and Devin replies are decoded from protobuf with strict checks; malformed or ambiguous replies are reported as Unavailable.

Devin's status call needs the native client's request fingerprint. The collector runs `devin auth status` through a short-lived loopback relay that forwards only two fixed read-only routes to `server.codeium.com`, then closes. It checks the login's server first and rejects enterprise or regional logins before forwarding credentials.

Endpoint references: [CodexBar provider notes](https://github.com/steipete/CodexBar/tree/main/docs) for Claude, Codex and Grok.

Build from source
-----------------

In PowerShell, with Git and Node.js 20 or newer installed:

```powershell
git clone https://github.com/naimkatiman/weekly-ai-usage.git
Set-Location weekly-ai-usage
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
.\WeeklyUsage.exe
```

The build uses the .NET Framework C# compiler included with Windows. No additional .NET SDK or package installation is needed. Keep the executable with the collector files.

Development
-----------

Run all tests, compile, then create the installer using an existing Inno Setup compiler:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\test.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\build.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\installer.ps1 -Version 0.2.0-preview.1
```

The installer and SHA-256 checksum are written to `dist/WeeklyAIUsage-0.2.0-preview.1-Setup-x64.exe` and its `.sha256` file. The build downloads a pinned official Node.js 24 runtime, verifies its checksum and includes its license. The Windows CI runner has Inno Setup installed; for a custom compiler location, pass `-CompilerPath` or set `ISCC_PATH`. `package.ps1 -Version 0.2.0-preview.1` creates a portable ZIP for manual use instead.

`collect.cjs` builds the snapshot; `grok.cjs` and `devin.cjs` decode provider responses. The C# sources implement the window and account editor.

Headless: after configuring an account, `node collect.cjs` prints the snapshot as JSON on Windows or Linux. On macOS, Claude Code uses the Keychain instead of `.credentials.json`, so Claude rows report no matching login.

License
-------

MIT. See [LICENSE](LICENSE). Tray icon: Lucide gauge geometry, Copyright (c) Lucide Contributors, ISC License.
