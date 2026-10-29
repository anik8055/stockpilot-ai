# Android app (Capacitor)

The Android app is a Capacitor 8 shell around the **deployed** StockPilot web app (the app is server-rendered, so it
cannot be bundled as static files). The same responsive UI is used on phones in the browser and in the app.

What the native project adds beyond a plain wrapper:
- **Downloads work**: PDF/CSV/Excel exports are handed to Android's DownloadManager with the signed-in session cookie (same-host HTTPS URLs only) — WebViews otherwise silently ignore downloads. See `MainActivity.java`.
- **File uploads**: imports and invoices use the system file picker (Capacitor's WebChromeClient), including camera/gallery for invoice photos.
- **Offline page**: when the server can't be reached, a bundled branded page with "Try again" is shown (`mobile/www/index.html`).
- **Back button** navigates within the app (`@capacitor/app`).
- **Hardening**: no cleartext/mixed content in release, WebView debugging off unless `CAP_DEBUG=1`, `allowBackup=false` (session cookies are not backed up), navigation restricted to your domain.
- Branded launcher icons (adaptive) and splash screens (`npm run android:assets`).

## Status — what has and has not been verified

| Item | Status |
|---|---|
| Capacitor config, Android project generated (`npx cap add android`) | Done |
| Icons, splash, download handler, manifest hardening | Done (code written, assets generated) |
| Mobile layout of every main page (Pixel 7 viewport, no horizontal scroll, navigation drawer) | Tested with Playwright (`tests/e2e/mobile.spec.ts`) |
| Gradle build, APK/AAB | **Not built here** — the build environment blocks Android SDK downloads |
| Running on a device/emulator: sign-in, uploads, downloads, back button | **Not tested** — do this before release (checklist below) |
| Play Store submission | Not done |

## Requirements

- Android Studio (current stable), Android SDK Platform 36, Build-Tools, JDK 21 (bundled with Android Studio)
- Node 22 and this repository
- A deployed HTTPS StockPilot URL

## Build steps

```bash
npm ci
export CAP_SERVER_URL=https://app.your-domain.example   # your production URL (https only)
export CAP_APP_ID=in.yourcompany.stockpilot             # final application ID — cannot change after publishing
npm run android:assets        # regenerate icons/splash if you changed mobile/assets/*.svg
npm run android:sync          # writes capacitor.config.json into the Android project
npm run android:open          # opens Android Studio
```
If you change `CAP_APP_ID`, also rename the Java package folder (`android/app/src/main/java/in/example/stockpilot`) and
`namespace`/`applicationId` in `android/app/build.gradle`, or regenerate the platform (`rm -rf android && npx cap add android`, then re-apply `MainActivity.java` and the manifest changes from git).

Set `versionCode` (integer, +1 each upload) and `versionName` in `android/app/build.gradle`.

## Signing (never commit keys)

```bash
keytool -genkeypair -v -keystore ~/keys/stockpilot-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 9125
```
Create `android/keystore.properties` (git-ignored):
```
storeFile=/home/you/keys/stockpilot-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```
and reference it from `android/app/build.gradle`:
```groovy
def ksFile = rootProject.file("keystore.properties")
def ks = new Properties(); if (ksFile.exists()) ks.load(new FileInputStream(ksFile))
android {
  signingConfigs { release { if (ksFile.exists()) { storeFile file(ks.storeFile); storePassword ks.storePassword; keyAlias ks.keyAlias; keyPassword ks.keyPassword } } }
  buildTypes { release { signingConfig signingConfigs.release; minifyEnabled false } }
}
```
Use **Play App Signing**: Google keeps the app signing key; you keep only the upload key. Back up the upload keystore and
passwords in a password manager. In CI, store the keystore as a base64 secret and write it to disk at build time.

Build the bundle: Android Studio → Build → Generate Signed App Bundle, or `cd android && ./gradlew bundleRelease`
(output `android/app/build/outputs/bundle/release/app-release.aab`).

## Device test checklist (before any release)

- [ ] Fresh install: splash → sign-in page loads over HTTPS
- [ ] Sign in, close and reopen the app: still signed in
- [ ] Workspace switch and sign-out work
- [ ] Import a CSV and an .xlsx from Downloads and from Google Drive via the picker
- [ ] Upload an invoice PDF; upload a photo (camera) — with OCR off, the app should say it cannot read photos
- [ ] Download a PO PDF, report PDF and CSV exports: notification appears and files open from Downloads
- [ ] Back button navigates back; on the dashboard it leaves the app
- [ ] Airplane mode: offline page shows; "Try again" recovers when back online
- [ ] Rotate to landscape; large font size setting; Android 8 (API 26) and a current Android version

## Google Play checklist

- [ ] Final application ID, app name, icon (512×512), feature graphic (1024×500), phone screenshots
- [ ] Privacy policy URL (your deployed `/privacy`), data safety form: account info (email, name), business data you import, files you upload; no data sold; data deletion available in Settings and on request
- [ ] Content rating questionnaire; target audience 18+ (business app); no ads
- [ ] App access instructions for reviewers: a reviewer login on a demo workspace (synthetic data)
- [ ] Target API level meets Google Play's current requirement
- [ ] Internal testing track first, then closed testing, then production
- [ ] Note: Google Play may reject apps that are only a website wrapper; make sure the app is clearly a usable tool (it is — but describe the native downloads/uploads in the listing and test them)

Do not describe the app as published until Google has approved it.
