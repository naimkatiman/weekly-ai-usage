LinkedIn desktop preview draft
===============================

The owner published the [original post](https://www.linkedin.com/feed/update/urn:li:activity:7509033966079840256/). The copy below is an unpublished follow-up. Use it only after the v0.3.0-preview.1 downloads and checksums are published and checked. Do not claim measured onboarding speed or verified real macOS account switching.

Post draft
-----------

I wanted to answer one question before starting a coding session: which account should I open?

Weekly AI Usage now pairs the quota dashboard with an account launcher.

Give your Codex and Claude Code accounts names like Personal and Work. Check their reported quota, then open the chosen account in your project. Separate profiles keep existing terminals on the account they already use.

You can sign into a new isolated profile through the provider, or link a login you already have. Your credentials stay on your device. Privacy mode hides account emails and saved paths in the dashboard by default.

The preview has a Windows installer and Mac downloads for Apple Silicon and Intel. Node.js is included. You still need the provider CLI installed.

This is an early preview: Windows is unsigned, and the Mac app is not notarized. Real two-account login and renewal on Mac still need validation. Grok and Devin retain limited existing-login support.

Try it before your next session and tell me where setup gets in your way.

[Downloads and source](https://github.com/naimkatiman/weekly-ai-usage)

Comment for the existing post
-----------------------------

Update: the next preview combines quota checks with isolated Codex and Claude Code account launches, plus Windows and Mac installers. Node.js is included. Windows is unsigned; Mac is not notarized, and real multi-account Mac login/renewal still needs validation. [Release notes and downloads](https://github.com/naimkatiman/weekly-ai-usage/releases).

Recording plan, about 25 seconds
--------------------------------

Use synthetic profiles and keep Demo data visible throughout. Keep Privacy on. Existing v0.1/v0.2 screenshots and videos describe the older Windows product and must not illustrate this release's onboarding.

| Time | Recording | Caption |
| --- | --- | --- |
| 0-5 s | Show Personal and Work cards with different synthetic allowances. | Which account should I open? |
| 5-11 s | Add an isolated account with a nickname and project folder. | Choose the account and project |
| 11-17 s | Show Sign in, then cut explicitly to the populated demo dashboard. | Sign in through the provider |
| 17-22 s | Open the selected demo account with a fake agent terminal; leave the other demo terminal visible. | Other sessions keep their account |
| 22-25 s | Show the download choices. | Windows and Mac preview. Node.js included. |

Do not record real credentials, private paths or login codes. A synthetic terminal demonstrates the interface, not provider interoperability. Add captions and use readable text rather than speeding through setup.

Before making an easy-onboarding claim, observe first-time users on both platforms. Record whether they can connect one account, recover from a missing login and explain an unavailable reading without help. Measure provider installation/sign-in separately. Verify two real accounts remain independent after one renews or reconnects; a CI fixture or screenshot cannot establish that result.
