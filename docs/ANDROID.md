# OpenPlane Studio на Android

Та же Studio (Tauri 2 + React), собранная в APK. На телефоне всё, что меняется
настройками по кабелю (`set …` в консоль платы: PID, режимы, геозабор, failsafe,
OSD), работает так же, как на ПК. Чего нет и не будет: сборки прошивки из
исходников (нет PlatformIO и Python), подготовки компьютера, драйвера DFU,
симулятора SITL. Шить телефон будет готовым `.bin` (релиз или экспорт с ПК).

## Что уже есть (P46)

- Rust-часть собирается под `aarch64-linux-android`: `serialport` и `nusb`
  подключаются только на ПК; на телефоне команды COM-порта отвечают
  `NOT_ON_ANDROID: …`, список устройств пуст.
- Окно: `isMobile()` (`src/api.ts`) прячет «Симулятор», окно подготовки,
  обновление установщиком и разделы «Настроек» про исходники и сборку.
- Ангар на телефоне — в папке данных приложения (`…/Hangar`).

## Дальше

- P47 — USB-OTG: Kotlin-плагин (консоль платы по CDC с DTR, прошивка DfuSe).
- P48 — экраны под телефон, выбор `.bin`, экспорт прошивки с ПК.
- P49 — APK в GitHub-релизе.

## Что нужно для сборки APK (на этой машине уже стоит с 2026-11-20)

Android Studio не обязателен — хватает командной строки:

- JDK 17: `winget install Microsoft.OpenJDK.17 --scope user`;
- Android command-line tools (`commandlinetools-win-*_latest.zip` с developer.android.com)
  → `%LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest`, затем
  `sdkmanager --licenses` и
  `sdkmanager "platforms;android-36" "build-tools;36.0.0" "platform-tools" "ndk;28.2.13676358"`
  (недостающий `compileSdk` из шаблона Gradle докачивает сам);
- переменные среды пользователя:
  ```
  JAVA_HOME    = %LOCALAPPDATA%\Programs\Microsoft\jdk-17.0.10.7-hotspot
  ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk
  NDK_HOME     = %LOCALAPPDATA%\Android\Sdk\ndk\28.2.13676358
  ```
- цели Rust: `rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android`;
- **«Режим разработчика» Windows** (Параметры → Обновление и безопасность → Для разработчиков):
  Tauri кладёт `.so` в `jniLibs` символической ссылкой, без режима сборка падает на
  «Creation symbolic link is not allowed». Включается один раз, нужны права администратора.

## Сборка

```
npx tauri android build --apk --target aarch64 --debug
```

`src-tauri/gen/android` уже создан (`npx tauri android init`) и хранится в git.
APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk`.
Debug-подпись ставится на телефон сразу (разрешить «установку из неизвестных источников») —
так её и отдаём тестерам. Релизная (без `--debug`) без своего ключа подписи не ставится.
Для отладки на телефоне по кабелю: `npx tauri android dev` (включить «Отладку по USB»).

Без «Режима разработчика» — обходной путь (Rust собран предыдущей командой, она упала
только на ссылке):

```
cp src-tauri/target/aarch64-linux-android/debug/libopenplane_studio_lib.so src-tauri/gen/android/app/src/main/jniLibs/arm64-v8a/
cd src-tauri/gen/android
./gradlew assembleUniversalDebug -x rustBuildUniversalDebug -x rustBuildArm64Debug -x rustBuildArmDebug -x rustBuildX86Debug -x rustBuildX86_64Debug
```

Debug-APK весит ~160 МБ: `.so` с отладочной информацией. Для тестеров позже — Rust
в release-профиле (≈15–25 МБ), P49.

Проверка, что Rust-часть не сломана, без SDK и NDK:

```
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android
```
