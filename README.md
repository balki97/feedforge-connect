# FeedForge Connect

FeedBack plugin for FeedForge Hub ranked and competitive play.

Install through FeedBack's Plugin Manager with `https://github.com/balki97/feedforge-connect.git`. If Git is unavailable, download `FeedForge-Connect.zip` from the latest release, extract it to `%APPDATA%\feedback-desktop\plugins\feedforge-connect`, and restart FeedBack.

It links a FeedForge Hub account, validates eligible charts, records ranked Note Detect runs, and lets players upload their results to the leaderboard.

## Install

Paste `https://github.com/balki97/feedforge-connect.git` into FeedBack's Plugin Manager.

Create an account at [feedforge.org](https://feedforge.org), then open FeedForge Connect in FeedBack and authenticate the plugin with your FeedForge Hub account.

Ranked play requires [Note Detection](https://github.com/got-feedback/feedBack-plugin-notedetect). Connect can install or update it from the ranked setup screen; restart FeedBack afterward.

## Connecting your account

1. Update FeedForge Connect in Plugin Manager and restart FeedBack.
2. Open its settings and click **Connect account**.
3. Sign in at FeedForge and approve the connection. Keep the plugin settings open until it says **Connected to FeedForge Hub**.

If the browser does not open, use **Open connection page**, or visit [feedforge.org/connect/feedback](https://feedforge.org/connect/feedback) and enter the displayed code. Codes expire after ten minutes. Reopening the settings panel resumes a pending connection; temporary network failures retry automatically. **Get a new code** starts over.

### 0.4.7

- Correct public approval links even when a server reports an internal Docker address.
- Copyable connection code and manual browser links.
- Resume pending connections after reopening settings, with bounded retries and clear expiry handling.
- Existing ranked-play rules and explicit score-upload confirmation are unchanged.

Checks: `python -m unittest -v` and `node test_settings.cjs`.
