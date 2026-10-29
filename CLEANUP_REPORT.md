# Cleanup report (29 October 2026)

This lists what CineAI Studio uses on the laptop and what could safely go.

Disk: `/` is 112 GB, **44 GB free** (60 % used), measured with `df -h`.

## What the project uses

| # | Path | Size | Category | Purpose | Proposed action |
|---|---|---|---|---|---|
| 1 | `~/Desktop/android` (source, docs, tests) | ~15 MB | Source code | The project | **Keep** |
| 2 | `~/Desktop/android/.git` | 55 MB | Git history | All commits, also on GitHub | **Keep** |
| 3 | `~/Desktop/android/app/build` | 590 MB | Build output | Old APKs and compiled files; rebuilt by `./gradlew` or by GitHub Actions | **Delete** (safe, re-creatable) |
| 4 | `~/Desktop/android/core/build` | 14 MB | Build output | Compiled core library | **Delete** (safe) |
| 5 | `~/cineai-tools/gradle.zip`, `cmdline-tools.zip`, `jdk17.tar.gz` | 463 MB | Downloaded installers | Already unpacked next to them; the zips are no longer used | **Delete** (safe) |
| 6 | `~/.cache/pip` | 584 MB | Package cache | Python downloads from setting up the backend | **Delete** (safe, re-downloads if needed) |
| 7 | `~/Desktop/android/backend/.venv` | 795 MB | Dependencies | Python libraries for the laptop video backend | **Keep for now.** Not needed by the new browser app; can go if you stop using the backend |
| 8 | `~/.config/.android/avd/cineai_test.avd` | 2.7 GB | Test emulator | Virtual phone for automated tests. You now have the real phone connected | **Your choice.** Deleting it means device tests run only on your real phone |
| 9 | `~/cineai-tools/android-sdk` | 5.6 GB | Dev tool | Needed to build the Android app locally | **Keep** (needed to build the APK) |
| 10 | `~/cineai-tools/blender-4.2.3-linux-x64` | 1.3 GB | Dev tool | Optional Blender workflow | **Keep** (dev tool; can go if you never use Blender) |
| 11 | `~/cineai-tools/jdk-17…`, `gradle-8.11.1`, `sherpa` | 561 MB | Dev tools | Java, Gradle, voice library | **Keep** |
| 12 | `~/.gradle/caches` + `~/.gradle/wrapper` | 9.2 GB | Package cache | Shared with your **other project** (`barcrm`, Gradle 9.3.1) | **Keep.** Clearing it would also force your other project to re-download everything |
| 13 | `~/.npm` | 1.3 GB | Package cache | Not created by this project | **Keep** (not ours) |
| 14 | `~/Desktop/android/demo-output` | 111 MB | Generated videos | Test evidence: the real AI clips and test renders | **Keep** (small; it is the proof the tests ran) |
| 15 | `~/Desktop/android/backend/data/jobs` | 1.3 MB | Generated data | Backend job records | Keep (tiny) |
| 16 | `~/.config/.android/avd/barcrm.avd` | 1.0 GB | Unrelated project | Your other emulator | **Never touched** |

Not looked at, never touched: personal files, SSH keys, credentials (`backend/data/access_key.txt`, the GitHub login), other projects.

## Cleanup done (approved by the user)

Items 3, 4, 5 and 6 (**about 1.65 GB**, all re-creatable) were deleted after the user approved. The test emulator (item 8) was kept.
Free space before: 44 GB (`df -h /`, rounded); after: 45 GB.

Commands run (each path checked first):

```bash
rm -rf ~/Desktop/android/app/build ~/Desktop/android/core/build
rm -f ~/cineai-tools/gradle.zip ~/cineai-tools/cmdline-tools.zip ~/cineai-tools/jdk17.tar.gz
rm -rf ~/.cache/pip
```

## Honest note

44 GB is free, so space is not critically low right now. The big items (Android SDK, Gradle cache) are tools that are
needed to build the Android app on this laptop. The new browser app is built by GitHub Actions, so it needs no
big local tools at all.

## The web app's own footprint

- `~/Desktop/cineai-web` source and git: about 3 MB (including 1.3 MB of test clips).
- `node_modules` (about 160 MB) is needed only for local development and is deleted after each session.
  GitHub Actions builds and deploys the site, so nothing large has to stay on the laptop.
- No AI models are downloaded to the laptop or the phone. Video is generated on Hugging Face's or Google's GPUs.
