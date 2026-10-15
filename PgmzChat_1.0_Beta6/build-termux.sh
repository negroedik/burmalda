#!/data/data/com.termux/files/usr/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
command -v gradle >/dev/null 2>&1 || { echo 'Gradle не найден. Установи: pkg install gradle'; exit 1; }
command -v javac >/dev/null 2>&1 || { echo 'Java не найдена. Установи: pkg install openjdk-21'; exit 1; }
export JAVA_HOME="${JAVA_HOME:-$(dirname "$(dirname "$(readlink -f "$(command -v javac)")")")}"
SDK="$HOME/android-sdk"
SDKMANAGER="$SDK/cmdline-tools/latest/bin/sdkmanager"
if [ ! -x "$SDKMANAGER" ]; then
  echo "Не найден sdkmanager: $SDKMANAGER"
  echo 'Проверь Android command-line tools в ~/android-sdk/cmdline-tools/latest.'
  exit 1
fi
# Keep builds on the already-supported API 34 target. Do not switch to platform 35.
echo 'Проверяю лицензии Android SDK…'
yes | "$SDKMANAGER" --licenses >/dev/null 2>&1 || true
# Do not redownload the working Android 34 platform unless a required component is absent.
NEED_SDK_PACKAGES=()
[ -d "$SDK/platforms/android-34" ] || NEED_SDK_PACKAGES+=( 'platforms;android-34' )
if [ ! -x "$SDK/build-tools/34.0.0/aapt" ] || [ ! -x "$SDK/build-tools/34.0.0/apksigner" ] || [ ! -x "$SDK/build-tools/34.0.0/zipalign" ]; then
  NEED_SDK_PACKAGES+=( 'build-tools;34.0.0' )
fi
if [ "${#NEED_SDK_PACKAGES[@]}" -gt 0 ]; then
  echo "Устанавливаю только отсутствующие компоненты SDK: ${NEED_SDK_PACKAGES[*]}"
  "$SDKMANAGER" "${NEED_SDK_PACKAGES[@]}"
else
  echo 'Android SDK Platform 34 и Build Tools 34.0.0 уже на месте; повторная загрузка не нужна.'
fi
# Refresh the bundled WebView client from source to prevent stale/unsynchronized assets.
rm -rf "$ROOT/android/app/src/main/assets/client"
mkdir -p "$ROOT/android/app/src/main/assets/client"
cp -a "$ROOT/client/." "$ROOT/android/app/src/main/assets/client/"
cd "$ROOT/android"
chmod +x gradlew
echo 'Синхронизирую веб-клиент и проверяю исходники…'
bash "$ROOT/verify-source.sh"
echo 'Сборка debug APK…'
gradle --no-daemon clean assembleDebug
APK="$ROOT/android/app/build/outputs/apk/debug/app-debug.apk"
[ -s "$APK" ] || { echo "APK не создан или пустой: $APK"; exit 1; }
# Validate that the package is structurally sound and signed before copying it.
if command -v unzip >/dev/null 2>&1; then unzip -t "$APK" >/dev/null; else echo 'Нужен unzip для проверки APK'; exit 1; fi
APKSIGNER="$SDK/build-tools/34.0.0/apksigner"
if [ -x "$APKSIGNER" ]; then
  "$APKSIGNER" verify --verbose "$APK"
else
  echo "Не найден apksigner: $APKSIGNER — не могу подтвердить подпись APK."; exit 1
fi
AAPT="$SDK/build-tools/34.0.0/aapt"
if [ -x "$AAPT" ]; then
  BADGING="$("$AAPT" dump badging "$APK")"
  printf '%s\n' "$BADGING" | grep -Fq "package: name='com.pgmzchat.app' versionCode='43' versionName='1.0_Beta6'" || { echo 'APK имеет неверный applicationId или номер версии.'; exit 1; }
else
  echo "Не найден aapt: $AAPT — не могу проверить package name/version."; exit 1
fi
ZIPALIGN="$SDK/build-tools/34.0.0/zipalign"
if [ -x "$ZIPALIGN" ]; then "$ZIPALIGN" -c -v 4 "$APK"; else echo "Не найден zipalign: $ZIPALIGN"; exit 1; fi
mkdir -p "$ROOT/dist"
OUT="$ROOT/dist/PgmzChat-1.0_Beta6-debug.apk"
cp -f "$APK" "$OUT"
[ -s "$OUT" ] || { echo 'Копия APK пуста'; exit 1; }
unzip -t "$OUT" >/dev/null
printf '
APK собран, ZIP-структура и подпись проверены:
%s
' "$OUT"
if [ -d "$HOME/storage/downloads" ]; then
  cp -f "$OUT" "$HOME/storage/downloads/PgmzChat-1.0_Beta6-debug.apk"
  echo 'APK скопирован в ~/storage/downloads/PgmzChat-1.0_Beta6-debug.apk'
fi
