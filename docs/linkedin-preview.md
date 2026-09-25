LinkedIn installer follow-up
===========================

The owner has published the [original LinkedIn post](https://www.linkedin.com/feed/update/urn:li:activity:7509033966079840256/). The installer follow-up and comment below are prepared drafts. Neither has been posted by this work. Use them after the v0.2.0-preview.1 installer is published and its public download has been checked. The three-person onboarding test below remains unverified; no setup timing or new live provider compatibility is claimed here.

Follow-up draft
---------------

Which AI account still has quota before I start another coding session?

Weekly AI Usage puts that answer in one Windows tray dashboard. See reported weekly usage, remaining quota and reset times across your Claude, Codex, Grok and Devin accounts, with separate rows for work and personal accounts.

The Windows preview now has an installer. No ZIP extraction or separate Node.js installation required.

Install the app, choose Add your first account, and select an existing provider login. Save it to check its quota. Devin requires manual email entry.

You need Windows 10 or 11 on x64 and a supported provider CLI you have already signed into. The dashboard reads that existing login and labels missing or stale readings clearly.

Try it before your next coding session. Tell me which step needs less effort.

Download for Windows: https://github.com/naimkatiman/weekly-ai-usage/releases/download/v0.2.0-preview.1/WeeklyAIUsage-0.2.0-preview.1-Setup-x64.exe

Comment for the existing post
-----------------------------

Update: there is now a Windows installer. Node.js is included, so you do not need to install it separately. Install, add your existing AI account, and check its remaining weekly quota and reset time. Windows 10/11 x64 and an existing supported provider CLI login are required.

Download: https://github.com/naimkatiman/weekly-ai-usage/releases/download/v0.2.0-preview.1/WeeklyAIUsage-0.2.0-preview.1-Setup-x64.exe

Preview assets
--------------

The `linkedin-preview.mp4` in v0.1.0-preview.1 is a historical 25-second captioned walkthrough made from native UI screenshots. It shows welcome, account setup, missing-login feedback and a synthetic quota dashboard. Its separate Node.js requirement describes the earlier portable release and is outdated for the installer. Do not reuse that video to explain the new installation flow.

It is an illustrated preview, not a recording of a real provider sign-in. Use the storyboard below for a new installer walkthrough; do not claim it exists until recorded and reviewed.

Demo recording, 25 seconds
-------------------------

Use a clean demo configuration with addresses such as `personal@example.com` and `work@example.com`. Label synthetic readings "Demo data" on screen throughout. Never expose real account emails, provider credential files or tokens. Synthetic readings demonstrate the interface; they do not verify live provider compatibility.

| Time | Picture | On-screen text |
| --- | --- | --- |
| 0-3 s | Open the dashboard from the tray. Show two demo account rows with different remaining quotas. | Which account has quota left? |
| 3-7 s | Show the installer, then the Start Menu shortcut. Use an explicit cut between them. | Install on Windows. Node.js included. |
| 7-12 s | Show first-run setup with Find existing login and Save account. | Add an account you already use |
| 12-18 s | Return to the two-row dashboard. Select one row to show its shorter usage window and reset time. | Weekly quota and reset time |
| 18-22 s | Show a Stale demo row with its capture time, then an Unavailable row. | Missing data stays visible |
| 22-25 s | Minimize to the tray. End with the repository name and release link. | Windows preview. Existing CLI login required. |

Keep account names and statuses large enough to read on a phone. Use short cuts instead of speeding through an actual setup. Do not add a stopwatch or imply that a 25-second video proves setup duration. Add captions so the demo works without audio.

Gate for the broader launch
--------------------------

Status: unverified. Recruit three first-time Windows 10/11 x64 users who have one supported CLI login. At least one should have no separate Node.js installation. Give them only the release link and README. Record provider CLI installation and sign-in time separately if a participant starts without them.

For each participant, record whether they independently:

- Download and run the installer, open the app, add the intended account, and reach a verified Live reading within five minutes.
- Recover from a missing login using the app's help and documentation.
- Explain the difference between Live, Stale, Reset pending and Unavailable.
- Minimize the app to keep it running and exit it intentionally.

Record elapsed time, the step where help was needed, the provider and any error. Do not count a detected email or synthetic reading as a verified Live result. Ask what they expected at the point of confusion, then fix repeated obstacles before making an easy-onboarding claim.
