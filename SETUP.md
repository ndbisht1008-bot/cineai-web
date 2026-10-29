# Setup

## Using the site (nothing to install)

1. Open https://ndbisht1008-bot.github.io/cineai-web/ in Chrome, Edge or Firefox (Android or computer).
2. Open **Settings**, keep **LTX-Video (free)**, and tick **"I understand what is sent"**.
3. Optional: paste a free Hugging Face token for more daily quota. Create it at huggingface.co → Settings → Access Tokens → type "Read".
4. Go to **Projects** and start a **Script to Movie** or a **Music Video Studio** project.

On Android you can add it to the home screen from Chrome's menu (⋮ → Add to Home screen).

## Google Sign-In (optional, free, for the site owner)

Sign-in only shows the user's name. It is not needed for anything else. To turn it on:

1. Go to https://console.cloud.google.com/ and create a project (free, no billing needed).
2. **Google Auth Platform → Branding:** app name "CineAI Studio" and your support email. **Audience:** External.
   While the app is in "Testing", add your own Google account under Test users.
3. **Clients → Create client → Web application.**
   - Authorised JavaScript origins: `https://ndbisht1008-bot.github.io` and, for development, `http://localhost:5173`
   - No redirect URI is needed (the button uses a pop-up).
4. Copy the **Client ID** (`123…-abc….apps.googleusercontent.com`). It is public by design, not a secret.
5. On GitHub: repository **Settings → Secrets and variables → Actions → Variables → New repository variable**:
   name `VITE_GOOGLE_CLIENT_ID`, value the client ID. Re-run the "CI and deploy" workflow.

For local development, put the same line in a file named `.env.local`, which git ignores.

Privacy: the app reads only the name, email and picture from Google's sign-in answer, keeps them in this tab's session storage,
and sends them nowhere. With no backend, the token is not verified by a server, so sign-in is for display only.

## Gemini video (optional, paid)

See [GOOGLE_AI_INTEGRATION.md](GOOGLE_AI_INTEGRATION.md). In short: create an API key in Google AI Studio on a project with
Cloud Billing, restrict it to the Generative Language API and this site's address, set a budget alert, then choose "Gemini" in
Settings. Every clip costs money.

## Development on the laptop

Needs Node.js 20.19+ (the laptop has Node 20.20) and, for browser tests, Chromium (`/usr/bin/chromium`).

```bash
cd ~/Desktop/cineai-web
npm ci --legacy-peer-deps   # about 160 MB in node_modules; delete it afterwards to save space
npm run dev
```

`--legacy-peer-deps` works around an npm 10 bug ("Cannot read properties of null (reading 'edgesOut')") with this dependency set.
