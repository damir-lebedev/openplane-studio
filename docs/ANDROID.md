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

## Что поставить для сборки APK (один раз)

1. **Android Studio** (developer.android.com/studio). В ней *SDK Manager*:
   - *SDK Platforms*: Android 14 (API 34) или новее;
   - *SDK Tools*: Android SDK Build-Tools, Android SDK Platform-Tools,
     Android SDK Command-line Tools, **NDK (Side by side)**.
2. **JDK 17** — годится тот, что внутри Android Studio (`jbr`).
3. Переменные среды (Windows, «Изменение переменных среды для своей учётной записи»):
   ```
   JAVA_HOME    = C:\Program Files\Android\Android Studio\jbr
   ANDROID_HOME = %LOCALAPPDATA%\Android\Sdk
   NDK_HOME     = %LOCALAPPDATA%\Android\Sdk\ndk\<версия>
   ```
4. Цели Rust:
   ```
   rustup target add aarch64-linux-android armv7-linux-androideabi i686-linux-android x86_64-linux-android
   ```

## Сборка

```
npx tauri android init          # один раз: создаст src-tauri/gen/android (хранится в git)
npx tauri android build --apk --target aarch64 --debug
```

APK: `src-tauri/gen/android/app/build/outputs/apk/universal/debug/`. Debug-подпись
ставится на телефон сразу (разрешить «установку из неизвестных источников») —
так её и отдаём тестерам. Релизная (без `--debug`) без своего ключа подписи не ставится.
Для отладки на телефоне по кабелю: `npx tauri android dev` (включить «Отладку по USB»).

Проверка, что Rust-часть не сломана, без SDK и NDK:

```
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android
```
