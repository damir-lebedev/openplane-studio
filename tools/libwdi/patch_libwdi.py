# Патч libwdi: WinUSB для Windows 8+ без WDK (без co-installer'ов WDK 8.0).
# На Windows 8 и новее WinUSB встроен: INF подключает winusb.inf через
# Include/Needs, копировать ничего не нужно. Только x64.
import sys

root = sys.argv[1]


def patch(rel, old, new, count=1):
    path = f"{root}/{rel}"
    s = open(path, encoding="utf-8", newline="").read()
    crlf = "\r\n" in s
    s = s.replace("\r\n", "\n")
    assert s.count(old) == count, (rel, old[:50], s.count(old))
    s = s.replace(old, new)
    if crlf:
        s = s.replace("\n", "\r\n")
    open(path, "w", encoding="utf-8", newline="").write(s)


# 1. Конфигурация: без WDK, libusb0, libusbK; только 64 бит.
patch("msvc/config.h", '#ifndef WDK_DIR\n#define WDK_DIR "C:/Program Files (x86)/Windows Kits/8.0"\n#endif',
      '/* OpenPlane Studio: без WDK — WinUSB встроен в Windows 8+ */')
patch("msvc/config.h", '#ifndef LIBUSB0_DIR\n#define LIBUSB0_DIR "D:/libusb-win32"\n#endif', "")
patch("msvc/config.h", '#ifndef LIBUSBK_DIR\n#define LIBUSBK_DIR "D:/libusbK/bin"\n#endif', "")
patch("msvc/config.h", "/* 32 bit support */\n#define OPT_M32", "/* 32 bit support */\n// #define OPT_M32")
patch("msvc/config.h", "/* ARM64 support */\n#define OPT_ARM", "/* ARM64 support */\n// #define OPT_ARM")

# 2. WinUSB поддержан и без файлов WDK.
patch("libwdi/libwdi.c", "\tcase WDI_WINUSB:\n#if defined(WDK_DIR)\n\t\treturn TRUE;\n#else\n\t\treturn FALSE;\n#endif",
      "\tcase WDI_WINUSB:\n\t\treturn TRUE;\t// OpenPlane Studio: встроенный WinUSB Windows 8+")

# 3. INF в стиле Windows 8+: без co-installer'ов и секции Wdf.
inf = """; #INF_FILENAME#
; Copyright (c) 2010-2023 Pete Batard <pete@akeo.ie> (GNU LGPL)
; OpenPlane Studio: WinUSB Windows 8+ (встроенный драйвер, без co-installer'ов)
[Strings]
DeviceName = "#DEVICE_DESCRIPTION#"
VendorName = "#DEVICE_MANUFACTURER#"
SourceName = "#DEVICE_DESCRIPTION# Install Disk"
DeviceID   = "#DEVICE_HARDWARE_ID#"
DeviceGUID = "#DEVICE_INTERFACE_GUID#"

[Version]
Signature   = "$Windows NT$"
Class       = "USBDevice"
ClassGuid   = {88bae032-5a81-49f0-bc3d-a4ff138216d6}
Provider    = "libwdi"
CatalogFile = #CAT_FILENAME#
DriverVer   = #DRIVER_DATE#, #DRIVER_VERSION#

[ClassInstall32]
Addreg = WinUSBDeviceClassReg

[WinUSBDeviceClassReg]
HKR,,,0,"Universal Serial Bus devices"
HKR,,Icon,,-20

[Manufacturer]
%VendorName% = libusbDevice_WinUSB,NTamd64

[libusbDevice_WinUSB.NTamd64]
%DeviceName% = USB_Install, USB\\%DeviceID%

[USB_Install]
Include = winusb.inf
Needs   = WINUSB.NT

[USB_Install.Services]
Include = winusb.inf
Needs   = WINUSB.NT.Services

[USB_Install.HW]
AddReg = #USE_DEVICE_INTERFACE_GUID#

[NoDeviceInterfaceGUID]
; Avoids adding a DeviceInterfaceGUID for generic driver

[AddDeviceInterfaceGUID]
HKR,,DeviceInterfaceGUIDs,0x10000,%DeviceGUID%
"""
open(f"{root}/libwdi/winusb.inf.in", "w", encoding="utf-8", newline="\r\n").write(inf)

# 4. Каталог: файлов, кроме самого INF, нет.
open(f"{root}/libwdi/winusb.cat.in", "w", encoding="utf-8", newline="\r\n").write(
    "# List of the binaries referenced by the WinUSB inf\n"
    "# OpenPlane Studio: Windows 8+ — only the inf itself\n")
print("libwdi patched")
