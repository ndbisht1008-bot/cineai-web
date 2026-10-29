# Test results (29 October 2026)

Laptop: Kali Linux, Intel i5 (4 cores), no NVIDIA GPU. Browser tests: Chromium 150 (headless).

## Summary

| Test | Result |
|---|---|
| Type check (TypeScript strict) and lint | Pass |
| Unit tests (Vitest) | **30 passed** |
| Browser tests in real Chromium (`npm run test:browser`) | **6 passed** |
| Live call to LTX-Video from the browser (`--live`) | **Reached the Space and got its real answer** (quota used up today, see below) |
| GitHub Actions build + deploy | See the Actions tab; filled in below after the first run |

## Unit tests

- **Beat analysis**, ported from the Android version and checked the same way: synthetic songs at 85, 96, 128 and 140 BPM with
  known beats → tempo within 2 %, beat F-measure > 0.9, downbeat F > 0.8; every section boundary within one bar, Intro/Outro/
  Breakdown found, the loudest section is Drop or Chorus, impact found at the drop; 44.1 kHz input with silence before; too-short song rejected.
- **Script planner:** Hindi sentence splitting (danda, decimals), every word kept in order, no clip over 7 s, long narration
  gets continuation shots (image-to-video), translated prompts used when available, named character's appearance added,
  English-keyword fallback contains no Devanagari.
- **Music planner:** concept read from the user's words, shots cover the song with no gaps, > 90 % of cuts on the beat grid,
  never more unique clips than the budget, every reused shot fits inside its clip, faster cutting in the drop than in the intro.
- **Motion check** on synthetic clips: Ken Burns zoom + pan → camera_only, held still → static, moving object over a pan →
  real_motion, cross-fade → not real motion, < 3 frames → invalid.
- **Providers:** Hugging Face quota texts (negative quota, stated reset time), network and sleeping-Space errors; Gemini request
  shape (endpoint, `x-goog-api-key`, body) and inline-video decoding against a mocked server; billing error; missing key.
- **Google Sign-In:** ID-token payload decoding, including a Devanagari name.

## Browser tests (real decoder, real encoder)

| Test | Result |
|---|---|
| Motion check on the 3 real LTX-Video clips | all `real_motion` (100 % of frame pairs), about 3 s each |
| Motion check on Ken Burns zoom, Ken Burns pan, cross-fade, still (made from the same clips' frames) | `camera_only`, `camera_only`, `camera_only`, `static`: all rejected |
| Beat analysis of a 120 BPM WAV in a Web Worker | 120 BPM, sections Intro, Verse, Chorus, Breakdown, Drop, Outro |
| Script to Movie: Hindi 3-sentence script → 3 shots → real clips imported → export | 8.9 s, 720×1280, 30 fps, H.264, Devanagari subtitles drawn correctly (checked by eye) |
| Music Video Studio: 30 s song → 10 beat-cut shots from 3 unique clips → export | 30.0 s, 720×1280, with the song (Opus in Chromium; AAC where the browser has an AAC encoder) |
| Gemini without billing (mocked 403) | Clear "needs the paid tier" message, shot stays unfinished, export stays locked |
| 360 px wide phone screen | No horizontal scrolling |

The two exports used the real LTX clips from the Android tests, **imported**, so no quota was spent. Their pictures therefore do
not match these scripts.

## Live check against Hugging Face

From inside Chromium, the app connected to `Lightricks/ltx-video-distilled`, joined the queue and received Hugging Face's answer
*"You have exceeded your ZeroGPU quota (120s requested vs. -60s left)"*. It showed: "The free daily GPU quota for anonymous users on
this internet connection … is used up. It resets within 24 hours …". So the browser can reach the Space directly (no CORS block)
with no backend. **A new clip generated through the web app has not been seen yet**, because the quota was used up all day.
To finish this: `npm run test:browser -- --live` after the reset, or press Generate in the app.

## Not verified yet

- A fresh clip generated through the web app (quota, see above). The same Space and parameters made the 3 real clips in the
  Android tests.
- The Gemini provider against Google (needs a paid key).
- Google Sign-In against Google (needs the owner's OAuth client ID).
- Export speed on the Galaxy A21s and on Firefox/Safari. Safari has no WebCodecs audio encoder for some codecs and may not export.
- Chrome's on-device Hindi → English translator (not in this Chromium build; Chrome 138+ on desktop has it).
