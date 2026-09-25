Troubleshooting
===============

The preview installer is not code-signed. Windows may show an unknown-publisher or SmartScreen prompt. The release page provides a SHA256 checksum for the published file. If your organization's policy requires signed installers, this preview does not meet that requirement.

Start with one account. A successful setup ends with the correct email, a Live state and a weekly reading. Find existing login only identifies a local profile; it does not validate the provider session.

Installed app will not start or Node.js was not found
----------------------------------------------------

The Windows installer includes its own Node.js runtime. Close the app and run the installer again in the same location to restore missing app files. Your saved accounts and cache are preserved. Open Weekly AI Usage from the Start Menu. You do not need to install Node.js separately for the installed app.

The installer supports Windows 10 or 11 on x64. Its default location is `%LOCALAPPDATA%\Programs\Weekly AI Usage`, under your Windows user. It does not need administrator rights or change PATH.

For an older portable ZIP or a source build, install [Node.js 20 or newer](https://nodejs.org). Close Weekly AI Usage and open it again so it can pick up the updated PATH. In a new PowerShell window, run `node --version` to check the installation. If you installed Node.js manually, add its folder to PATH and restart the app.

Installed app opens the old portable copy or has no accounts
----------------------------------------------------------

A second launch brings an already running copy forward. Exit the old portable copy with X before opening Weekly AI Usage from the Start Menu.

The installer does not search for old account files. With both copies closed, copy only the old `accounts.json` into the installation folder, normally `%LOCALAPPDATA%\Programs\Weekly AI Usage`. If you already set `WEEKLY_USAGE_CONFIG`, retain that setting to use the existing file instead. Do not copy provider credential files. Open the installed app and confirm the correct account reaches Live before removing the old folder.

No matching login or the wrong email
-----------------------------------

1. Open Manage accounts and check the provider, email and Profile folder.
2. If you use a custom profile, enter the directory that holds that account's existing login, then select Find existing login. The app does not search every folder on your machine.
3. For a saved account, select its row and open Sign-in help. Copy its instructions and run the relevant CLI command yourself. Sign in using the email shown for that account.
4. Return to the dashboard and select Refresh now.

Claude uses `~/.claude` by default, with identity information in `~/.claude.json`. In a custom Claude profile, the folder contains `.credentials.json` and `.claude.json`. Codex and Grok use `auth.json` in their profile folders. A profile path points at the folder, not the JSON file.

An email detected from a local file may belong to an expired login. The dashboard's usage check determines whether it can read the account. If the provider reports a different identity, the reading is rejected. Check the selected login instead of relabelling another account's reading.

Devin does not support local email detection in the account editor. Enter its email manually and use the optional Devin CLI path if the executable is not on PATH.

Expired login or access denied
-----------------------------

Select the affected row and open Sign-in help. Use the displayed account and profile when signing in through the provider CLI, then choose Refresh now. The dashboard never renews tokens for you. If the CLI itself cannot show usage, resolve that provider login or subscription issue first.

Configuration is invalid or cannot be saved
------------------------------------------

The app preserves an unreadable or invalid configuration file instead of replacing it. Use Open configuration to inspect the file and make a backup before editing it. Check the file path shown in the app; `WEEKLY_USAGE_CONFIG` can point outside the app folder.

- Save the file as UTF-8, not UTF-16.
- Use an `accounts` array with a supported `provider` and an `email` for every entry.
- Each provider and email pair must be unique.
- Use forward slashes or escaped backslashes in JSON paths. Comments and trailing commas are invalid JSON.
- Keep the app and its default configuration in a writable folder. The installer's default folder under LocalAppData is writable; Program Files and the inside of a ZIP are unsuitable for manual copies.

Compare your file with `accounts.example.json`, repair it, then reopen Manage accounts. Do not overwrite your account list with the example. If another process changed the file after you opened the editor, close the editor and reopen it to load those changes before saving.

Stale, Reset pending or Unavailable
----------------------------------

Stale means the displayed reading is from an earlier successful check. Check its capture time and the account's error message. Restore connectivity or repair the login, then choose Refresh now. A failed check can retain a prior reading for up to 24 hours.

Reset pending means the provider's reported reset time has passed. Wait for a fresh reading. The app does not assume the quota has returned to zero.

Unavailable means there is no usable reading. It does not mean the account has used all its quota. Provider errors, an unsupported response or a missing weekly allowance can cause it. If the provider rate limits a check, wait for the next scheduled refresh.

Devin enterprise or regional server
----------------------------------

Only a Devin CLI login for `server.codeium.com` is supported. Enterprise and regional logins are rejected before their credentials can be forwarded to that server. Use the provider's own usage view for those accounts. Do not change a login's server merely to bypass the check.

Window closed or updates stopped
--------------------------------

Minimize keeps the app in the tray. X exits it and stops checks. Open Weekly AI Usage from the Start Menu to resume, or open `WeeklyUsage.exe` for a portable copy. A second launch focuses the existing window if the app is already running.

Account files remain after uninstall
-----------------------------------

Uninstall deliberately preserves user-created `accounts.json` and `usage-cache.json` so an uninstall or reinstall does not erase your account list. If you want to remove this data, uninstall first, then delete those files from the installation folder. If you use `WEEKLY_USAGE_CONFIG`, remove that external file only if you no longer need it. Provider CLI logins are stored separately and remain unchanged.

Reporting a problem
-------------------

Include your Windows version, provider, app release version, whether you used the installer or a portable/source copy, and the exact error text. For a portable/source copy, also include `node --version`. Remove email addresses and local paths from screenshots if you do not want to share them. Never attach provider credential files or tokens. `accounts.json` and `usage-cache.json` also contain account emails; review them before sharing anything.
