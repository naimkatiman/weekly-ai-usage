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
