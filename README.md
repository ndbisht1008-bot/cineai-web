# CineAI Studio (web)

Make short films and music videos from **real AI-generated video clips**, in any modern browser
(Chrome, Edge or Firefox on Android, Windows, Linux or macOS). No app install, no server of our own, ₹0 by default.

**Live site:** https://ndbisht1008-bot.github.io/cineai-web/

## What it does

| Workflow | Steps |
|---|---|
| **Script to Movie** | Hindi or English script → storyboard (one shot per sentence or two, every word kept) → English video prompt per shot (translated on the device where the browser can) → one real AI clip per shot → narration (record or upload), subtitles, transitions → MP4 |
| **Music Video Studio** | Upload MP3/WAV → BPM, beats, bars and sections found on your device → shot list cut on the beat from your concept → real AI clips (shots share clips to save quota) → your song, unchanged, under a beat-synced edit → MP4 |

Every clip is checked before it is accepted. It has to decode, and it has to pass a **real-motion test**: a still picture with zoom
or pan, a cross-fade or a frozen frame is rejected. There is **no fallback to still images**. A film can be exported only when every
shot has an accepted clip.

## Where the video comes from

| Source | Real AI video | Cost | Needs |
|---|---|---|---|
| **LTX-Video** (Lightricks) on a public Hugging Face GPU Space (default) | Yes: text-to-video and image-to-video, up to 7 s per clip | ₹0. About 4 clips a day per internet connection, about 10 with a free Hugging Face token | Nothing |
| **Google Gemini Omni Flash** (optional) | Yes | **Paid**: about US$0.10 per second of video, billed to your Google Cloud project | Your own Gemini API key with billing |
| Your own clip, or one you downloaded from Google Flow | Whatever you import | n/a | Labelled "imported", never "generated" |

Google Flow / Google AI Pro credits **cannot** be used by other apps. Google offers no API for that. See
[GOOGLE_AI_INTEGRATION.md](GOOGLE_AI_INTEGRATION.md).

## What runs where

- **In your browser:** script analysis, storyboard, Hindi → English translation (Chrome's built-in translator, when available),
  beat and section analysis (Web Worker), motion check, preview, MP4 export (WebCodecs), project storage (IndexedDB).
  Your script, song and narration never leave the device.
- **External services:** only the video generation. The English shot prompt, and for continuation shots the previous clip's last
  frame, go to Hugging Face (or Google, if you chose Gemini).
- **Google Sign-In** (optional) only shows your name. It unlocks no AI features.

## Limits (honest)

- Free quota: about 4 clips a day without an account, so a 1-minute film (8–12 clips) takes about 2–3 days. Finished clips are kept.
- Clips are 512×896 (or 896×512), up to 7 s. The export is 720×1280 or 1280×720 at 30 fps.
- Characters stay only roughly consistent between shots. Continuation shots (image-to-video from the previous last frame) help.
- Narration cannot use the browser's text-to-speech, because browsers cannot record it into a file. Record your voice or upload a voice-over.
- Export takes about as long as the film on a laptop, and longer on a phone. Keep the tab open.
- Projects live in this browser only. Clearing site data deletes them.

## Development

```bash
npm ci --legacy-peer-deps
npm run dev           # http://localhost:5173
npm run typecheck && npm run lint && npm test
npm run test:browser  # real Chromium; set CHROME_PATH if needed
npm run build
```

Pushing to `main` runs all checks and deploys to GitHub Pages ([DEPLOYMENT.md](DEPLOYMENT.md)). Setup: [SETUP.md](SETUP.md).
Test results: [TEST_RESULTS.md](TEST_RESULTS.md).

The logic (script planner, beat analyzer, music video planner, motion check) is ported from the tested Android version of
CineAI Studio (private repository `cineai-studio`).

License: MIT. Generated clips follow the provider's terms (LTX-Video Open Weights License; Google's API terms).
