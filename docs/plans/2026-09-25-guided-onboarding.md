# Guided onboarding and preview release

Goal: a Windows user with an existing supported CLI login can add one account and understand its first quota reading without editing JSON or compiling the app.

Approved by the owner's "go proceed" after the September 25 onboarding audit. Base: `a10317a6a228b5133206cfda73c9edaa6f600c77`.

## Scope and assumptions

- Keep WinForms/.NET Framework and Node.js 20+. No new dependencies.
- Add a welcome state and an account editor. Detect an identity only from the selected provider's existing local profile. Never store tokens in configuration or modify provider credentials.
- Preserve existing account settings, manual JSON support, `WEEKLY_USAGE_CONFIG`, and current quota/identity checks.
- Offer account-specific sign-in instructions that the user can copy and execute themselves.
- Package the executable, collector modules, example configuration, license and user documentation in a portable ZIP. Exclude real account settings, caches and credentials.
- Complete setup, recovery, updates and removal documentation. Prepare a LinkedIn draft and a recording script; do not post to LinkedIn.
- Publish a preview release after the PR checks pass. Keep the three-person usability test as an explicit outstanding launch gate.

## Implementation layers

1. Configuration service: validated reads/writes, safe account editing, existing-profile identity detection and recovery text. Preserve unknown JSON fields and reject saves after external config changes.
2. WinForms UI: welcome state, one-account editor, account management and copyable help. Refresh quota after a successful save; preserve truthful unavailable and stale states.
3. Packaging: reproducible portable ZIP, allowlisted contents, CI build/tests and package artifact.
4. Documentation and launch material: quick start, troubleshooting, update/removal steps, factual preview post and demo storyboard.

Each layer has a separate commit, at most 15 files and 500 changed lines. Split further when necessary.

## Verification

- Run the existing collector regression suite and new configuration tests with synthetic identities.
- Compile C# with warnings as errors.
- Exercise native first-run and account-editor flows with isolated config/profile data, including invalid JSON, duplicate accounts, external edits, missing Node/login, custom paths and cancellation.
- Inspect native screenshots at normal and enlarged UI settings. Test recovery copying without executing a login.
- Extract the ZIP and launch its app with isolated data; confirm exact allowlisted contents and checksums.
- Review changes independently, then pass hosted CI before merging and publishing the preview release.
- Never claim real-user timing or live provider compatibility from synthetic tests.

## Progress

- [x] Public baseline and existing tests reviewed; clean isolated checkout created.
- [x] Configuration service and tests.
- [x] Guided UI and native verification.
- [x] Portable ZIP and CI workflow.
- [x] Documentation and LinkedIn draft.
- [x] Independent review, hosted checks, merge and preview release.
- [ ] Three new users reach a verified account reading within five minutes and recover from a missing login.

## September 25 verification

- 24 collector tests, 80 configuration assertions and 25 native onboarding checks passed. C# compiled with warnings as errors.
- The extracted portable ZIP passed the same 25 native checks against its shipped executable. Its executable hash matched the source build.
- Native screenshots show first-run setup, the account editor, missing-login recovery and a clearly labelled synthetic dashboard.
- The account editor was also inspected with control bounds scaled to 150%; real monitor-DPI switching was not performed.
- Independent review caught and verified fixes for removed accounts returning from cache, default Claude metadata precedence, copied prose being treated as shell commands, and a test modal that could hang after a failed save.
- Live provider sign-ins, a machine without Node.js, and the three-person usability target have not been tested. Installed Node.js was v24.12.0 locally; CI covers Node.js 20.

## Published preview receipt

- [PR #1](https://github.com/naimkatiman/weekly-ai-usage/pull/1) merged with separate layer commits. Release source: `f9aac4c6218864c1cc8b48cf2ce4b5499f2d76cc`.
- [Windows CI on the release source](https://github.com/naimkatiman/weekly-ai-usage/actions/runs/36041324945) passed.
- [v0.1.0-preview.1](https://github.com/naimkatiman/weekly-ai-usage/releases/tag/v0.1.0-preview.1) contains the portable ZIP, SHA256 file and optional 25-second captioned screenshot walkthrough. The video is labelled synthetic demo data throughout.
- The public ZIP was downloaded without authentication and matched SHA256 `0e78d3e2a86b31bbda8f5d59593ed57f28807be38e318a242a13ec264ba1916c`.
- LinkedIn copy remains a draft. The real-user usability gate above remains open.

## September 25 installer follow-up

The owner requested a Windows installer instead of ZIP-first distribution, less setup friction and clearer problem-solving copy. This extends the same onboarding goal.

Assumptions and approved implementation:

- Keep the existing application stack. Bundle the existing Node runtime dependency so the installed app does not need Node on PATH.
- Build with Inno Setup already installed on GitHub's Windows runner. Do not install a new compiler on the owner's machine.
- Install per user under LocalAppData with a Start Menu shortcut and standard Windows uninstall entry. No administrator rights, automatic startup or PATH changes.
- Keep account settings app-relative and honor WEEKLY_USAGE_CONFIG. Installer files must exclude accounts.json and usage-cache.json; upgrades and uninstall preserve user-created settings.
- Pin the official Node 24 LTS runtime and verify its download checksum. Include upstream license notices.
- Prefer the bundled runtime; retain the existing system-runtime fallback for source/portable users.
- Lead the README and first-run UI with: "See which AI account has quota left." Explain that the app displays reported quota and reset times; it does not choose a provider or switch accounts automatically.
- Publish a new installer preview after tests, review, CI and local installation checks. Existing CLI logins remain required. Do not modify the owner's LinkedIn post.

Verification: existing collector/config/native tests; app runtime-selection tests; hosted installer build; install and upgrade into an isolated path; verify configuration preservation, shortcuts and uninstall registration; run the installed app's native checks using only its bundled runtime; uninstall and verify removal of installed files with settings retained. Verify the public installer download checksum and record signing status. Test data and installer registry entries must stay separate from any existing installation.

Progress:

- [x] Bundled-runtime support and problem-solving UI copy.
- [x] Installer definition, pinned runtime packaging and CI.
- [x] Installer-first documentation and updated first-run screenshot.
- [x] Independent review and installation/reinstall/uninstall verification.
- [x] Merge, installer preview release and public download verification.

Local source verification passed: 24 collector tests, 80 configuration assertions and 28 native checks, with warnings-as-errors compilation. Installer scripts pass syntax checks and independent review. Hosted build and installed-binary lifecycle verification remain required before publishing.

## Installer release receipt

- [PR #3](https://github.com/naimkatiman/weekly-ai-usage/pull/3) merged at `6febb63f05ac6ab3d95ca85112a840a89c88bb25`.
- The exact-source [release build](https://github.com/naimkatiman/weekly-ai-usage/actions/runs/36076773416) passed, including 29 native checks using the installed bundled runtime with an empty PATH and 18 installer lifecycle checks. The final installer passed the same checks on the owner's Windows host in an isolated directory.
- Setup reruns preserved configuration/cache bytes. Uninstall removed program files, runtime, shortcut and registration. Only the two synthetic user-data files remained. Neither user nor machine PATH changed.
- A dated QA correction: the initial test cleanup reran the uninstaller during self-removal after all lifecycle checks had passed. Cleanup now tracks ownership and waits for removal; the corrected suite passes locally and in CI.
- [v0.2.0-preview.1](https://github.com/naimkatiman/weekly-ai-usage/releases/tag/v0.2.0-preview.1) provides the 24,952,080-byte Setup executable and its SHA256 file. The unauthenticated public download matched `414389e43c926cd0f9f9027dc96017c863c33178c93cf13f44edecad1cd59219`.
- Installer signing status is NotSigned, disclosed in README and release notes. No signing certificate or other paid service was purchased.
- The README, first-run UI and repository description lead with quota availability. The original LinkedIn post was published by the owner; the new installer follow-up remains a draft. The old portable-release video is labelled historical rather than reused with its outdated separate-Node requirement.
- Real-user timing and new live provider sign-ins remain unverified.

## Account launcher and macOS proposal, September 25

Status: approved by the owner's "approve" reply on September 25. Electron and necessary packaging dependencies are authorized. Implementation starts from `c3f807b23e487672239e9d80cc0fea81cbbf493e`; private profile stores remain untouched. This extends the existing onboarding roadmap.

Product goal: see remaining quota and open an agent with the chosen account, without interrupting other account sessions. Keep Weekly AI Usage as the repository and released product until a rename is explicitly requested.

### First user journey

1. Install the desktop app and let it detect installed supported CLIs.
2. Add an account using a nickname such as Personal or Work. Either link an existing profile folder, or run the provider's own login in a new isolated profile.
3. See reported quota and reset times where supported. Unknown usage stays unavailable.
4. Choose Open terminal with this account. Only that new process receives the selected profile environment. Existing terminals and shared defaults remain untouched.

Use nicknames by default, with a local-only identity confirmation view. Remember the last workspace locally. A default selection means the default for future launches from this app, not a rewrite of the machine's shared CLI credentials.

### Reuse decision

A read-only audit of the existing local utility found two distinct mechanisms: process-local home selection in wrappers, and a separate credential snapshot/default-swap mechanism. The latter performs several credential/identity writes without an interprocess transaction and requires session restarts. Reuse the isolated-launch behavior through clean generic code. Do not copy private stores, account-specific launchers or machine paths into this repository.

The current WinForms UI is Windows-only. Approved architecture: one Electron desktop UI on Windows and macOS, reusing the existing JavaScript quota logic behind a narrow, validated IPC boundary. Package local UI assets only; renderer sandbox and context isolation stay enabled, with Node integration disabled. Tokens and provider filesystem access stay outside the renderer. Electron adds a Chromium runtime and increases the installer footprint in return for one shared UI.

Alternative if new dependencies are declined: keep the current Windows UI and add a shared CLI first. This does not deliver the same desktop experience on macOS; a separate native macOS frontend would still be needed.

### Provider capabilities, not universal switching claims

| Provider | Proposed first support | Verification boundary |
| --- | --- | --- |
| Codex | Isolated login and launch with CODEX_HOME; existing quota display | Preserve configured file/keyring backend and stable profile paths. |
| Claude Code | Isolated login and launch with CLAUDE_CONFIG_DIR; Windows and macOS quota adapter | Current docs scope macOS Keychain entries by config directory. Verify supported CLI versions and conflicting auth settings. |
| Grok | Existing quota support; add GROK_HOME launch after isolation tests | Verify background leader/socket separation and token refresh across profiles. |
| Devin | Existing-login launch and current quota adapter where supported | Do not advertise multi-account switching until credential-store isolation is established. A separate config file alone is insufficient. |
| Other agents | Explicit launch-only adapter when executable/arguments are known | Login isolation and quota remain unavailable until implemented and tested separately. |

Adapters expose independent detect, connect, launch, usage and disconnect capabilities. Do not install arbitrary agent executables or plugins automatically. Normal CLI arguments must pass through unchanged where the adapter supports them.

### Authentication and private-data boundaries

- Keep real identities, profile paths, credentials, token caches and cloud secret names outside the repository, application bundle and release artifacts. Public fixtures and docs use synthetic profiles and example-domain identities only.
- Link existing profile homes in place after local confirmation. Do not copy or move them automatically: macOS credential stores can bind identity to the home path.
- Provider CLIs own login, logout and refresh. The app does not implement a second OAuth flow or snapshot live credentials into another account.
- A subscription-profile launch must detect competing API-key/cloud authentication settings. Handle the chosen auth mode explicitly in the child environment; never log their values or silently label a different identity as selected.
- Remove from this app only removes the local reference. Signing out or deleting a provider home is a separate explicit action.
- Use restrictive OS file permissions, sanitized diagnostics and a privacy mode for screenshots. Redaction belongs at the source of logs/IPC, not only in the UI.
- Before every public push, scan staged files and outgoing commits. Before release, scan unpacked bundles and diagnostics. Scan output reports locations/categories without echoing private values. Commit authorship uses a public no-reply identity.
- Keep cloud-secret export, destructive profile removal and global credential swapping out of the first release. These are distinct authority and reliability concerns.

### Delivery sequence

1. Generic profile/launcher core and synthetic tests, including secure argv handling, inherited-auth conflicts, stable paths and no shared-default writes.
2. Codex and Claude adapters; explicit local import by reference; provider-owned connect/reconnect.
3. Shared desktop quota/launch UI and Windows/macOS terminal adapters, after framework approval. Preserve the existing installer/config migration path.
4. macOS Keychain-aware quota reads, provider version gates and denied/locked-Keychain behavior. Read only the selected provider entry; never enumerate or dump the user's keychain.
5. Windows installer and macOS app/DMG builds, artifact privacy checks, real-device login/concurrency validation, then a preview release. Public macOS distribution with minimal Gatekeeper friction needs signing/notarization credentials supplied by the owner; do not purchase services or bypass OS protections.
6. Add further agents only when their individual capabilities are verified. Keep the capability labels honest when quota or switching is unavailable.

### Acceptance checks

- On Windows and macOS, connect two different profiles, run both simultaneously and confirm each identity locally. Renew or sign out of one and prove the other stays authenticated.
- Compare shared default credential/config paths before and after launch/login/reconnect: no unexpected mutation. Do not claim concurrent refresh safety for multiple sessions sharing one profile without a separate test.
- Verify process arguments with spaces, quotes and shell metacharacters; filenames or labels cannot inject shell commands.
- Demonstrate import of an existing home without copying credentials, privacy-mode screenshots, and a complete export/log/artifact scan using only synthetic test data.
- Exercise missing CLI, unsupported quota, revoked login, wrong identity, inherited auth overrides, and macOS Keychain denial/lock states without false Live/Ready indicators.
- Run platform CI and real desktop trials. A macOS build artifact alone is not proof of account switching or Keychain interoperability.

Research sources: [Codex authentication](https://developers.openai.com/codex/auth/), [Codex keyring implementation](https://github.com/openai/codex/blob/1f17a0a04b5c53ef2ea89b7d874764139321b26a/codex-rs/login/src/auth/storage.rs#L235), [Claude credential management](https://code.claude.com/docs/en/authentication#credential-management), [Grok profile settings](https://docs.x.ai/build/settings/reference#paths-and-auth), [Devin credential locations](https://docs.devin.ai/cli/enterprise/devin-auth#credentials-file-location), [Electron process model](https://www.electronjs.org/docs/latest/tutorial/process-model), [Electron security](https://www.electronjs.org/docs/latest/tutorial/security), [Apple notarization](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution).

Implementation checkpoints:

- [x] Generic local profile store and isolated launch core, with synthetic concurrency tests.
- [x] macOS credential adapters and preserved collector behavior.
- [x] Shared desktop UI with restricted IPC and local-only private state.
- [ ] Windows/macOS packaging, privacy gates and platform CI.
- [ ] Independent review, release artifact checks and public preview delivery.
- [ ] Owner-assisted live login/concurrency and signed macOS distribution validation.

Implementation verification before platform CI: JavaScript syntax checks, collector/profile/controller/packaging/privacy suites pass on Windows. Native macOS Keychain testing is gated to macOS CI with a disposable synthetic keychain. The Windows packaged app passed 27 desktop checks, including its bundled terminal helper.

Review corrections: preserve the exact Claude profile path for Keychain names; distinguish explicit profile directories from the bare default-login namespace; block reconnect against shared default files; include the namespace in cache identity; discard mismatched identities and stale asynchronous results; keep generated launch-file deletion confined to validated requests; never start a coding agent inside its credential folder. Existing agent-auth homes can be linked only through an explicit local import, with no credential copying.

Platform verification, September 25: [native CI run](https://github.com/naimkatiman/weekly-ai-usage/actions/runs/36087190445) passed 104 applicable unit/contract tests, 24 development desktop checks and 27 packaged desktop checks on Windows x64, macOS arm64 and macOS x64. Both Mac jobs passed fully, including a disposable synthetic Keychain. Windows produced and scanned its Setup executable; its installer lifecycle harness exposed a missing process-exit code and requires correction before release. Path tests were corrected to distinguish preserved profile/project aliases from canonical executable paths. Independent launcher and packaging reviews found no remaining product blocker. Real provider sign-in and renewal were not exercised.

Windows installer follow-up: the exact Setup artifact from [run 36087859960](https://github.com/naimkatiman/weekly-ai-usage/actions/runs/36087859960) matched its SHA256 and passed all 38 lifecycle checks plus 27 installed desktop checks on the owner's host using isolated synthetic data. Account/cache bytes survived reinstall and removal; program files, shortcut and registration were removed. PowerShell 5 process handles now retain exit codes, cleanup preserves the original error, and stage diagnostics identify failures without private paths. Hosted CI additionally exposed an ambiguous development Node lookup; its correction remains a release gate. These harness failures did not involve provider credentials.
