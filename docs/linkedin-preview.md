LinkedIn preview launch
======================

This is a prepared draft, not a published post. Use it only after the portable preview release is available and its download link has been checked. The three-person onboarding test below remains unverified. No live provider compatibility or setup timing is claimed by this document.

Post draft
----------

Which AI account still has quota before I start another coding session?

I built Weekly AI Usage to answer that in one Windows tray dashboard.

It reads quota for Claude, Codex, Grok and Devin, with separate rows for work and personal accounts. You can see the reported weekly usage, remaining quota and reset time. Select an account to inspect its shorter usage window when the provider offers one.

The preview now has a portable download and a guided account setup. Choose a provider, find an existing local login, and save the account. Devin requires manual email entry.

You still need Windows, Node.js 20 or newer, and a provider CLI you have already signed into. The dashboard reads those logins, checks usage every 15 minutes, and labels missing or stale readings clearly. It does not send prompts or spend credits.

I am looking for Windows users with multiple AI accounts to try the setup and tell me where they get stuck.

Download the preview: https://github.com/naimkatiman/weekly-ai-usage/releases

Prepared preview asset
----------------------

`linkedin-preview.mp4` is a 25-second captioned walkthrough made from native UI screenshots. It shows welcome, account setup, missing-login feedback and a synthetic quota dashboard. It is an illustrated preview, not a recording of a real provider sign-in. The release includes this optional video for the post. The storyboard below is available for a later interactive recording.

Demo recording, 25 seconds
-------------------------

Use a clean demo configuration with addresses such as `personal@example.com` and `work@example.com`. Record only synthetic readings and label the recording "Demo data" on screen throughout. Never expose real account emails, provider credential files or tokens. Synthetic readings demonstrate the interface; they do not verify live provider compatibility.

| Time | Picture | On-screen text |
| --- | --- | --- |
| 0-3 s | Open the dashboard from the tray. Show two demo account rows with different remaining quotas. | Which account has quota left? |
| 3-7 s | Open Manage accounts and the account editor. Show the provider choice and demo email. | Add the account you already use |
| 7-12 s | Show a separate, clearly labelled demo of the first-run setup with Find existing login and Save account. | Existing CLI login required |
| 12-18 s | Return to the two-row dashboard. Select one row to show its shorter usage window and reset time. | Weekly quota and reset time |
| 18-22 s | Show a Stale demo row with its capture time, then an Unavailable row. | Missing data stays visible |
| 22-25 s | Minimize to the tray. End with the repository name and release link. | Windows preview. Node.js 20+ required. |

Keep account names and statuses large enough to read on a phone. Use short cuts instead of speeding through an actual setup. Do not add a stopwatch or imply that a 25-second video proves setup duration. Add captions so the demo works without audio.

Gate for the broader launch
--------------------------

Status: unverified. Recruit three first-time Windows users who already have Node.js 20+ and one supported CLI login. Give them only the release link and README. Record prerequisite installation time separately if a participant starts without them.

For each participant, record whether they independently:

- Download and extract the ZIP, launch the app, add the intended account, and reach a verified Live reading within five minutes.
- Recover from a missing login using the app's help and documentation.
- Explain the difference between Live, Stale, Reset pending and Unavailable.
- Minimize the app to keep it running and exit it intentionally.

Record elapsed time, the step where help was needed, the provider and any error. Do not count a detected email or synthetic reading as a verified Live result. Ask what they expected at the point of confusion, then fix repeated obstacles before making an easy-onboarding claim.
