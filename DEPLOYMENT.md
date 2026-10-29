# Deployment

The site is static and hosted on **GitHub Pages** from this public repository. GitHub Actions builds, tests and deploys it.

## How it works

`.github/workflows/ci.yml` runs on every push and pull request:

1. `npm ci`, type check, lint, unit tests (Vitest)
2. browser tests in the runner's Google Chrome (`npm run test:browser`): real decoding, motion check on real AI clips,
   full Script-to-Movie and Music Video exports, provider failure, phone layout. **No AI quota is used.**
3. check of the Google Sign-In variable (a warning when missing, an error when malformed)
4. production build with `BASE_PATH=/<repo name>/`, so asset URLs work under `https://<user>.github.io/<repo>/`
5. a scan that fails the build if an API key pattern or a video file ended up in `dist/`
6. on `main` only: upload and deploy to Pages

Pull requests are checked but never deployed.

## One-time GitHub settings

- **Settings → Pages → Build and deployment → Source: GitHub Actions** (set once).
- Optional variable `VITE_GOOGLE_CLIENT_ID` (see SETUP.md). It is a public value; never add API keys as variables.

## Why a separate public repository

GitHub Pages on a free account works only for public repositories. The Android project (`cineai-studio`) stays private.
This repository contains no secrets: keys are typed by each user into their own browser.

## Rolling back

Re-run an older successful "CI and deploy" run from the Actions tab, or `git revert` the bad commit and push.

## Base path

`vite.config.ts` reads `BASE_PATH`. For a custom domain or a `<user>.github.io` repository, build with `BASE_PATH=/`.
The app uses hash routes (`#/p/<id>`), so Pages needs no 404 fallback.
