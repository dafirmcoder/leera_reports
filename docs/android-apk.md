# Android APK — build & signing runbook

The PWA can be shipped as an installable Android `.apk` that opens the deployed
site in a full-screen, app-like window. The APK is a **wrapper around the PWA**:
it uses Android's Trusted Web Activity (TWA) to show the deployed site, so
everything (login, roles, reports, bulk PDF export) behaves exactly like the
browser version, and it always needs internet.

## How the download-from-site flow works

1. `public/leera-reports.apk` exists in the repo.
2. Vercel serves it like any static file (`https://YOUR-SITE/leera-reports.apk`).
3. The login screen does a lightweight `HEAD` request for that file; if it
   exists, a **⬇ Download APK for Android** button appears.
4. Tapping it downloads the APK; the user installs it (allowing "install from
   unknown sources").

> Vercel's free tier serves the file fine (~2 MB). If a school ever needs a very
> large APK, host it on Vercel Blob or GitHub Releases instead and point the
> button there.

## 1. Build the wrapper with PWABuilder (debug APK)

Prerequisites: **Java 17+** and internet (the tool downloads the Android SDK).

```bash
npx pwabuilder@latest https://YOUR-DEPLOYED-URL.vercel.app -l debug -d android
```

(The CLI auto-discovers the PWA manifest at
`https://YOUR-DEPLOYED-URL.vercel.app/manifest.webmanifest`.)
Output: `android/app/build/outputs/apk/debug/app-debug.apk`

Ship it by copying into `public/`:

```bash
cp android/app/build/outputs/apk/debug/app-debug.apk public/leera-reports.apk
```

The debug APK works for personal testing and sideloading, but for distribution
to teachers you want a signed **release** APK (below).

## 2. Production-signed release APK

A signing key already exists in this project (keystore
`keys/android-release.keystore`, alias `leera`). **Keep this keystore private and
backed up — if it is lost, you can never update the installed app.**

Run PWABuilder in `release` mode so it produces an unsigned release build:

```bash
npx pwabuilder@latest https://YOUR-DEPLOYED-URL.vercel.app -l release -d android
```

Then sign it with the project keystore using the Android build tools
(`apksigner` ships with the SDK that PWABuilder downloads):

```bash
cd android/app/build/outputs/apk/release
zipalign -f 4 app-release-unsigned.apk app-release-aligned.apk
apksigner sign \
  --ks /home/user/leera-reports/keys/android-release.keystore \
  --ks-key-alias leera \
  --ks-pass pass:Leera!2026 \
  --key-pass pass:Leera!2026 \
  --out leera-reports.apk app-release-aligned.apk
apksigner verify --print-certs leera-reports.apk
```

Then copy `leera-reports.apk` into `public/` as above.

## 3. App identity used

| Item | Value |
|---|---|
| Package name | `ac.tz.leeraschool.reports` |
| Keystore | `keys/android-release.keystore` (alias `leera`, pass `Leera!2026`) |
| Cert SHA-256 | `35:1C:77:24:3B:31:82:8E:4C:61:AC:E7:72:B5:67:D7:EE:19:8E:E5:6B:08:0E:C6:3F:D9:DA:83:23:6D:CA:9E` |

The SHA-256 fingerprint is also published in
`public/.well-known/assetlinks.json` so Android verifies the app is allowed to
own the URL. PWABuilder normally generates this itself; keep the two in sync if
you ever rotate the key.

## 4. Checklist for production

- [ ] Deploy the site first (the APK just points at the live URL).
- [ ] Build the release APK **after** the URL and package name are final.
- [ ] Put `public/leera-reports.apk` in the repo so the button appears.
- [ ] Back up `keys/android-release.keystore` somewhere private (never commit it).
- [ ] Keep `assetlinks.json` fingerprint in sync with the signing cert.

## Caveats

- **Not the Play Store.** This is a direct APK download. Publishing to Google
  Play requires a Play Console account ($25 one-time), an Android App Bundle
  (`.aab`), and a privacy policy.
- **Internet required.** The wrapper renders the live site; it is not an
  offline-native app.
- **Android only.** iOS does not allow installing APKs; iPhone users should use
  *Add to Home Screen* instead.
