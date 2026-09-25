Weekly AI Usage troubleshooting
===============================

Start with one Codex or Claude Code account. Save a nickname, choose Sign in, complete the provider login, then Refresh usage. Reveal details locally if you need to confirm the email. A detected identity alone does not prove the provider accepts the login.

Installer or app is blocked
---------------------------

v0.3.0-preview.1 supports Windows 10/11 x64 and macOS 13 or newer. Choose the Apple Silicon or Intel DMG for your Mac. Both include Node.js; a separate Node installation is unnecessary for the desktop app.

Windows Setup is unsigned. The Mac app has an ad-hoc signature and is not notarized. Publisher warnings or policy blocks are expected limitations of this preview. Verify the download against the release's SHA256 checksum. If your organization requires signed/notarized applications, wait for a suitable release or ask your administrator. Do not disable operating-system protections to install it.

On Windows, Setup uses `%LOCALAPPDATA%\Programs\Weekly AI Usage`, needs no administrator rights and does not modify PATH. On Mac, drag the app from its DMG into Applications before opening it. If installed files are missing, close the app and reinstall the same release. Keep the application data described below.

Agent missing or version unsupported
------------------------------------

Install or update the official provider CLI. Isolated Codex accounts require 0.156.0 or newer; Claude Code requires 2.1.63 or newer. The app checks the installed version before isolated login/launch. Its bundled Node runtime does not install the provider CLI for you.

If automatic detection misses an installed CLI, open the account editor, expand Advanced and choose its executable. Use the official executable or npm installation. Custom wrappers can redirect authentication and may be rejected. Installation guides: [Codex](https://developers.openai.com/codex/cli/) and [Claude Code](https://code.claude.com/docs/en/overview).

Sign in is unavailable or the wrong account appears
--------------------------------------------------

Use existing default login links the account your normal CLI uses. The app cannot reconnect that shared login. Open the provider normally to repair it, or create a New isolated account to sign into a different account without changing the default. Linking the default folder explicitly does not make it safe to reconnect a shared login.

For an isolated account, choose Sign in or Reconnect on its card and complete the provider login. Return and choose Refresh usage. A different detected email invalidates its old reading; reconnect the intended account instead of assuming the displayed quota belongs to the new login.

If launch is blocked by authentication settings, review the named settings in the provider. API keys, cloud-provider configuration and other authentication overrides can take precedence over the selected subscription. The app does not delete those settings or rewrite your global profile. Avoid adding a second app entry for the same provider folder.

macOS Keychain or unsupported credential storage
------------------------------------------------

The app reads only the selected provider's Keychain entry. Unlock your Keychain or allow the requested access, then refresh. A denied or locked entry does not produce a zero quota. Reconnect through the provider if its own login is expired.

Keep linked and managed profile folders at stable paths. Claude's Keychain entry depends on its configured folder; moving or renaming that folder can disconnect it from the stored login. Link an existing folder where it already lives. Do not copy credential files between accounts.

Codex file credentials and direct macOS Keychain entries are supported. Ephemeral credentials exist only inside the running agent. Codex encrypted auth storage is not supported for dashboard quota reads. These cases show Unavailable; use the agent's usage view. Live provider login and renewal across two real macOS accounts remain unverified in this preview.

Import an older Windows configuration
-------------------------------------

Choose Import existing accounts and select the old `accounts.json`, usually in `%LOCALAPPDATA%\Programs\Weekly AI Usage`. If you used `WEEKLY_USAGE_CONFIG`, select that file. Confirm Import references. There is no automatic search or private-data import.

Import retains profile paths and leaves credentials in place. Missing folders, duplicate provider folders and unsupported entries are skipped. Review the reported counts, then add or repair any skipped account manually. The old JSON file remains unchanged. Old portable ZIPs and v0.1/v0.2 videos have different setup instructions.

Grok and Devin limitations
--------------------------

Enter the existing account's email under Advanced to read Grok or Devin quota. Grok custom profile folders support usage checks only; launching uses its existing default login. Separate Grok switching and in-app sign-in are unavailable. Devin also uses its existing local login, with no isolated account switching. Set its executable under Advanced if detection fails.

Devin usage checks support `server.codeium.com` only. Enterprise and regional server logins are rejected before credentials are forwarded. Use the provider's own usage view for those accounts.

Readings stopped or look old
----------------------------

Stale retains the last reading and its capture time; readings older than 24 hours become Unavailable. Reset pending means the reported reset passed and a fresh response is needed. Unavailable means no usable data, not a known empty or full allowance. Refresh after fixing connectivity or login problems. A provider may also rate-limit checks.

Minimize keeps the app in the tray/menu bar. Closing its window exits it and stops refreshes. Reopen Weekly AI Usage to resume. The app refreshes on startup and every 15 minutes when running.

Data, updates and removal
-------------------------

Application data is under `%LOCALAPPDATA%\Weekly AI Usage` on Windows or `~/Library/Application Support/Weekly AI Usage` on Mac. `profile-store.json` contains references/preferences; `quota-cache.json` contains readings. Provider homes created by the app live under `profiles` there. Those homes may contain provider-managed credentials.

Close the app before updating. Windows Setup preserves its application data and old unlogged configuration files; replacing the Mac app also retains its separate data directory. Remove from app deletes only the local reference. Uninstalling the desktop app does not sign out providers or delete their homes. Do not delete the data directory merely to clear a cached reading.

To report a problem, include the app version, operating system, provider CLI version and sanitized error. Keep Privacy on for dashboard screenshots. Provider terminals and browsers may still show identity information. Never attach provider homes, `profile-store.json`, old `accounts.json`, token files or unreviewed diagnostics to a public issue.
