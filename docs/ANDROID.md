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

## USB-OTG (P47)

Плата подключается к телефону кабелем USB-C ↔ USB-C (или OTG-переходником).

- **Kotlin** (`src-tauri/gen/android/app/src/main/java/com/openplane/studio/usb/`):
  `UsbPlugin` — только «сырой» USB: список устройств, разрешение Android, CDC-порт
  (`usb-serial-for-android` 3.9.0, MIT, JitPack: наш STM32 0483:5740, родной USB ESP32,
  мосты CH34x/CP210x/FTDI; DTR — только STM32) и control-передачи к загрузчику DFU.
  Команды плагина приходят на главный поток Android — USB ждёт на своих потоках.
  `UsbNative` — байты порта уходят в Rust прямым JNI-вызовом, без JSON и опроса.
- **Rust** (`src-tauri/src/usb_android.rs`): порт на телефоне называется
  `usb:<deviceName>` (`usb:/dev/bus/usb/001/002`); `AndroidPort` реализует Read/Write,
  поэтому `link.rs`, чёрный ящик и паспорт платы работают без изменений.
- **Прошивка** готовым `.bin`: команда `firmware_flash_bin` (тело — байты образа,
  заголовки `port`, `chip`; в окне — `api.flashBin`, прогресс `onFlashProgress`):
  'D' в консоль (заармленная плата отвечает «Только без ARM.» — отказ) → ждём 0483:DF11
  до 10 с → протокол DfuSe из `src-tauri/src/dfuse.rs` (тесты на ПК с фейковым
  загрузчиком): стираются **только секторы под образ**, образ за начало сектора настроек
  (H743 `0x081E0000`, F405 `0x080E0000`) не пишется, сверка чтением, выход в прошивку.
- `AndroidManifest.xml`: `usb.host` (не обязателен), `USB_DEVICE_ATTACHED` +
  `res/xml/device_filter.xml` — подключили плату, Android предлагает Studio и сразу даёт доступ.

## Прошивка готовым .bin (P48 a)

Телефон не собирает прошивку (Config.h компилируется только на ПК), поэтому прошивает файл:
- **на ПК** — страница коптера → «Экспорт для телефона»: та же сборка, что у «Прошить», но вместо
  заливки `firmware.bin` копией `<коптер>-<env>.bin` в «Загрузки» (`firmware_export_bin`,
  проводник открывается с выделенным файлом);
- **на телефоне** — вместо «Прошить» кнопка «Прошить файлом» (обычный `<input type=file>`:
  Android WebView сам открывает выбор файлов). `core/binFile.ts` до загрузчика: сборка по концу
  имени (`firmware-<env>.bin` из релиза, `<имя>-<env>.bin` с ПК) против `@id` платы (или сборки
  коптера, если плата уже в DFU), ESP32 — отказ (только WiFi, P50), размер до сектора настроек;
  затем `api.flashBin` → шаги «Плата в режим прошивки / Заливка / Сверка и запуск» по событиям
  `flash-progress`, плата снова на связи с той же сборкой, калибровки на месте. Ответы Rust
  (`ARMED`, `NO_DFU`, `WRONG_CHIP`, `VERIFY`…) — фразой и действием (`explainBinError`).

## Экраны телефона (P48 b)

- `src/phone.css` (подключён последним, `@media (max-width: 640px)`): разделы — панелью внизу
  (на телефоне без «скоро»-разделов и симулятора, чтобы влезли «Настройки»), шапка — выбор
  аппарата + плата, вкладки коптера — горизонтальной лентой (выбранная прокручивается в кадр),
  окна — снизу листом, тосты над панелью, шторка платы во весь экран, касания ≥ 40 px,
  без полос прокрутки и `backdrop-filter`. Проверено на Redmi 14C (360 px CSS): 21 вкладка
  коптера без горизонтальной прокрутки.
- Системные полосы: `MainActivity.kt` — edge-to-edge с прозрачными полосами и светлыми значками,
  отступы строки состояния, навигации, выреза и клавиатуры кладутся вокруг WebView нативно
  (вёрстке не нужен `env(safe-area-inset-*)`).
- **Описание прошивки на телефоне** — снимок `src/assets/firmware-manifest.json` (378 КБ, отдельный
  кусок, ПК его не грузит): Python на телефоне нет, а без описания нет списка плат и сборок.
  Обновлять перед сборкой APK: `npm run manifest:phone` (нужен `../plane`).
- На телефоне скрыто то, что требует ПК: карточка «Переход с Betaflight» (bf_board.py) → строка
  «Первую прошивку делайте с компьютера», путь к папке ангара.
- **Ловушка:** в новом WebView `scrollIntoView()` возвращает Promise; `useEffect(() => el.scrollIntoView())`
  отдаёт его React как функцию очистки → уход с вкладки ронял всё приложение. Эффекты — только со
  скобками; сторож `src/effects.test.ts`.
- Отладка на телефоне: `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`
  (`adb shell pidof com.openplane.studio`), дальше CDP как на ПК; экран — `adb exec-out screencap -p`.
- Сборка из Git Bash не видит переменные среды пользователя — `JAVA_HOME`, `ANDROID_HOME`,
  `NDK_HOME` задать в команде.

## Слабый телефон (P51)

Замер на Redmi 14C (Helio G81, 4 ГБ), было (debug) → стало (release):

| | было | стало | цель |
|---|---|---|---|
| APK | 380 МБ (с офлайн-пакетами 224) | 7.5 МБ | — |
| установка `adb install` | 24 с | 5 с | — |
| `am start -W` | 2.1 с | 0.42 с; интерфейс целиком через 1.2 с | ≤ 3 с |
| память PSS | 225 МБ | 122–130 МБ | ≤ 250 МБ |
| прокрутка ангара | — | 238 кадров, 0 рывков, p99 12 мс | 60 к/с |

Что сделано: Rust в release (5.8 МБ `.so` вместо ~150), arm64 + armv7 (с v0.6.1; до того только arm64 — на 32-битных телефонах «Не удалось обработать пакет»), без офлайн-пакетов ПК;
главный JS 2.27 → 0.91 МБ — three.js (чёрный ящик, симулятор) и английский словарь грузятся
отдельными файлами, когда нужны (`App.tsx` lazy, `i18n.switchLanguage`); живые кадры платы
на телефоне — не чаще 4 раз в секунду (`core/throttle.ts`, `store.LIVE_PHONE_MS`), на ПК все.
`backdrop-filter` на телефоне выключен ещё в P48 b. Мерить: `dumpsys gfxinfo <pkg> reset`,
свайпы `input swipe`, `dumpsys gfxinfo` / `dumpsys meminfo`.

## Выпуск: APK и готовые прошивки (P49)

Тег `vX.Y.Z` → `.github/workflows/installers.yml` кладёт в выпуск рядом с установщиками ПК:

- `OpenPlane-Studio-Android.apk` — job `android` (ubuntu): JDK 17, SDK + NDK 28.2, Rust
  `aarch64-linux-android` + `armv7-linux-androideabi`, свежее описание плат (`opconfig.py describe` из исходников прошивки),
  `tauri android build --apk --target aarch64 --target armv7` (один универсальный APK), `zipalign` + `apksigner` **своим ключом** из секретов.
  Нет секретов — APK собирается, но в выпуск не идёт (предупреждение в журнале Actions);
  упал — выпуск для ПК всё равно выходит (`continue-on-error`).
- `firmware-<сборка>.bin` — job `firmware`: `pio run` для `stm32h743-devebox`, `stm32h743-devebox-quad`,
  `matek-h743`, `matek-h743-quad`, `aocodarc-f405v3-quad` (тот же список — `RELEASE_ENVS` в
  `src-tauri/src/update.rs` и `src/core/binFile.ts`; `getfun-f405v3-quad` — нет, `#error` до дампа платы).

**«Скачать и прошить»** (телефон, рядом с «Прошить файлом»): сборка — по `@id` платы на связи,
иначе выбранная у коптера; кнопка видна только для сборок из релиза. Файл
`releases/latest/download/firmware-<сборка>.bin` качает **Kotlin** (`UsbPlugin.download`: только
`https://github.com/…`, в кэш приложения, не больше 2 МБ) — у github.com нет CORS, `fetch` из окна
не пройдёт; Rust (`firmware_release_bin`) читает файл и отдаёт байты окну, дальше — как с файлом
(`runBinFlash`: проверка имени и размера → DfuSe). Нет файла в релизе — совет «Экспорт для телефона».

**«Прошить по WiFi»** (самолёт на ESP32, P50): файл `.bin` («Экспорт для телефона» на ПК) →
**Kotlin** `UsbPlugin.wifiJoin` (`WifiNetworkSpecifier` по `WIFI_AP_SSID`/`WIFI_AP_PASSWORD` из проекта
самолёта, Android 10+, системное окно «Подключиться?», сеть без интернета) и `bindProcessToNetwork` —
сокеты Rust (`wifi_ota.rs`: `GET /ota`, `POST /update` multipart, ожидание перезагрузки) идут в сеть
платы; в конце `wifiRelease` возвращает телефон в его WiFi. Пока процесс привязан, интернета у
Studio нет (скачивание из релиза не работает). Плата принимает образ только без ARM и с открытым
окном (жест стиков / `u` / `ota`) — прошивка `include/telemetry/WifiOta.h`, `OtaGate.h`.

### Ключ подписи (один раз, делает владелец)

**Создан 2026-11-20**: `openplane-release.jks` (RSA 4096, alias `openplane`, до 2054, SHA-256 сертификата
`4D:07:E1:87:B7:28:CA:A1:D3:66:CD:DA:33:E8:66:47:10:27:BD:3D:CA:AF:FF:8C:39:D9:69:FA:B2:BB:7E:9A`), лежит у
владельца вне репозитория вместе с паролем; секреты заданы. Новый ключ НЕ создавать.

Ключ — навсегда: обновление APK ставится поверх только с той же подписью. Потеряли ключ — все
переустанавливают приложение с потерей данных. Хранить `.jks` и пароль вне репозитория, в двух местах.

Если секреты придётся задать заново — из **Git Bash**, байт в байт (PowerShell 5.1 дописывает `\r\n`
к тому, что передаёт в `gh` по конвейеру, и `base64 -d` в CI падает с «invalid input»):

```bash
R=damir-lebedev/openplane-studio
base64 -w0 openplane-release.jks | gh secret set ANDROID_KEYSTORE -R $R
gh secret set ANDROID_KEY_PASSWORD -R $R        # спросит пароль
printf %s openplane | gh secret set ANDROID_KEY_ALIAS -R $R
```

(Или GitHub → Settings → Secrets and variables → Actions → New repository secret, те же три имени.)
**Тестерам, у которых стоит сборка с debug-ключом** (P51), первый APK из релиза поверх не встанет
(«Приложение не установлено» — другая подпись): удалить старое приложение и поставить новое; ангар
телефона при этом стирается.

## Дальше

- P50 — ESP32 по WiFi.

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

Debug-APK весит ~160 МБ: `.so` с отладочной информацией.

**Тестерам — release (7.5 МБ, P51).** Своего ключа пока нет (P49) — подписываем тем же
debug-ключом, что и debug-сборку, поэтому `adb install -r` ставится поверх и данные остаются:

```
npx tauri android build --apk --target aarch64
BT=$ANDROID_HOME/build-tools/36.0.0
$BT/zipalign -p -f 4 src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk aligned.apk
$BT/apksigner sign --ks ~/.android/debug.keystore --ks-pass pass:android --key-pass pass:android --ks-key-alias androiddebugkey --out OpenPlane-Studio.apk aligned.apk
```

Ловушки: офлайн-пакеты сборки прошивки (pio, Python, ~215 МБ) телефону не нужны —
`src-tauri/tauri.android.conf.json` убирает `bundle.resources`, но Tauri **не чистит** старую
копию в `gen/android/app/src/main/assets/resources/` (в .gitignore) — если APK снова сотни МБ,
удалить эту папку. Переменные `JAVA_HOME`/`ANDROID_HOME`/`NDK_HOME` из Git Bash агента не
видны — задавать в команде.

Проверка, что Rust-часть не сломана, без SDK и NDK:

```
cargo check --manifest-path src-tauri/Cargo.toml --target aarch64-linux-android
```
