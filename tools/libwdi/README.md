# Драйвер режима прошивки STM32 (libwdi)

`src-tauri/resources/wdi-simple.exe` ставит драйвер WinUSB для «STM32 BOOTLOADER»
(USB `0483:DF11`) — то же, что делают Zadig и ImpulseRC Driver Fixer. Без него
Windows видит плату в режиме прошивки, но dfu-util не может её открыть.

Собран из [libwdi](https://github.com/pbatard/libwdi) (Pete Batard, GNU LGPL 3,
текст — `src-tauri/resources/LICENSE-libwdi.txt`), коммит `30df0c0`, с патчем
`libwdi-win8-winusb.patch`:

- WinUSB берётся встроенный в Windows 8 и новее (`Include = winusb.inf`,
  `Needs = WINUSB.NT`) — без co-installer'ов WDK 8.0, поэтому WDK для сборки не
  нужен;
- только x64; libusb0, libusbK и 32-битные платформы выключены.

Как устроена установка: libwdi пишет INF, создаёт каталог (`.cat`), подписывает
его новым самоподписанным сертификатом и кладёт этот сертификат в «Доверенные
корневые» и «Доверенные издатели» — так Windows принимает драйвер без
отключения проверки подписей. Закрытый ключ сертификата после подписи не
сохраняется. Нужны права администратора — Windows спросит одно окно UAC.

## Как пересобрать

Нужны Visual Studio Build Tools 2022 (C++).

```bash
git clone https://github.com/pbatard/libwdi && cd libwdi && git checkout 30df0c0
python ../patch_libwdi.py .          # или: git apply ../libwdi-win8-winusb.patch
```

Затем в `libwdi/.msvc/libwdi_static.vcxproj` убрать ссылки на
`installer_x86` и `installer_arm64` (их нет в сборке) и, если в окружении
задано `NoDefaultCurrentDirectoryInExePath`, вызвать `.\embedder` вместо
`embedder` в шаге перед сборкой (оба изменения есть в патче). Сборка:

```bat
MSBuild libwdi.sln "/t:examples\wdi-simple" /p:Configuration=Release /p:Platform=x64
```

Результат — `x64\Release\examples\wdi-simple.exe`.
