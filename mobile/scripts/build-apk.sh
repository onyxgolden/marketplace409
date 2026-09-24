#!/usr/bin/env bash
# Build the Call Shield debug APK (sideloading; no Play Store in Slice A).
#
# Requirements: JDK 17 and the Android SDK (platform-34, build-tools 34).
# On this project's dev machine those live at ~/android-sdk (see the slice
# notes). Elsewhere, export JAVA_HOME and ANDROID_HOME before running.
set -euo pipefail

: "${JAVA_HOME:=$HOME/android-sdk/jdk-17.0.11+9}"
: "${ANDROID_HOME:=$HOME/android-sdk}"
: "${ANDROID_SDK_ROOT:=$ANDROID_HOME}"
export JAVA_HOME ANDROID_HOME ANDROID_SDK_ROOT
export PATH="$JAVA_HOME/bin:$PATH"

cd "$(dirname "$0")/.."

# Sync the web shell first so the APK's config is current.
npx cap sync android

cd android
./gradlew assembleDebug --no-daemon

APK="app/build/outputs/apk/debug/app-debug.apk"
if [ -f "$APK" ]; then
  echo "APK built: $(pwd)/$APK"
  ls -la "$APK"
else
  echo "Build finished but no APK found at $APK" >&2
  exit 1
fi
