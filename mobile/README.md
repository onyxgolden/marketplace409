# Call Shield Android companion app (Slice A)

Native shell around the FORGE web app. It exists for exactly one reason in
this slice: **a web page cannot read the Android call log**, so automatic
call-record retrieval needs native code.

## What the native layer does (Slice A)

- `CallShieldBridge` Capacitor plugin (`android/app/src/main/java/online/marketplace409/forge/CallShieldBridge.java`):
  `getCallRecords({ days })` → reads `CallLog.Calls` (number, date, duration,
  type, cached name) after requesting `READ_CALL_LOG` at runtime with an
  explanation. Nothing else: no network, no storage, no recording.
- The WebView loads the FORGE web app (`capacitor.config.ts` → `server.url`,
  default `https://409marketplace.online`, override with `CALL_SHIELD_WEB_URL`).
  Sign-in happens in the WebView with the normal FORGE login; the web app's
  API routes (`/api/call-shield/*`) do all staging and case work with the
  user's own session.

Deliberately thin per the architecture review: Kotlin/Java owns permissions
and OS APIs only. The FORGE domain (`src/domains/callShield/*`) remains the
authority for cases, evidence, and disclaimers.

## What it does NOT do (later slices)

- No call recording (Slice B: best-effort capture experiment on real devices
  first — Android cannot guarantee both-sides capture on every phone).
- No background sync, no Play Store submission (sideloaded APK for now).

## Build the APK

```bash
cd mobile
bash scripts/build-apk.sh
# → mobile/android/app/build/outputs/apk/debug/app-debug.apk
```

Copy the APK to the phone and install (Android will ask to allow installs
from the file manager). Open the app, sign in to FORGE once, go to
**Call Shield → Call history import**.

Requirements: JDK 17, Android SDK with platform-34 and build-tools 34.
`ANDROID_HOME` defaults to `~/android-sdk`.

## Web-side contract

`src/lib/callShield/callShieldNative.js`:

- `isNativeShell()` — true inside the app, false on the plain web.
- `fetchNativeCallRecords({ days })` — records shaped
  `{ androidCallId, phoneNumber, callerName, startedAt (ISO), durationSeconds, callType, deviceId }`;
  throws a plain-language error outside the shell.
