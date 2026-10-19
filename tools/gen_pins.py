#!/usr/bin/env python3
"""
Таблица возможностей пинов STM32 для выбора пина в приложении — из
варианта STM32duino (PeripheralPins.c и variant_*.h), как их видит прошивка:

    python tools/gen_pins.py

Для каждого пина: на каком таймере и канале ШИМ (только основная запись
PinMap_TIM — прошивка берёт её по имени пина, «ALT» не берёт), UART RX/TX,
I2C SDA/SCL, SPI, АЦП — с экземпляром периферии, чтобы проверить, что пары
(RX и TX, SDA и SCL) на одном экземпляре. Из variant_*.h — что на плате уже
занято (µSD, USB, флеш) и что выведено на разъём (камера, экран).

Пишет src/core/pins/<env>.json.
"""

import json
import os
import re
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
FRAMEWORK = os.path.expanduser("~/.platformio/packages/framework-arduinoststm32")
H743 = os.path.join(FRAMEWORK, "variants", "STM32H7xx", "H742V(G-I)(H-T)_H743V(G-I)(H-T)_H750VBT_H753VI(H-T)")

BOARDS = {
    # env прошивки: (файл PeripheralPins, файл variant_*.h, МК)
    "stm32h743-devebox": ("PeripheralPins_DevEBoxH7xx.c", "variant_DevEBoxH7xx.h", "STM32H743VIT6"),
    "stm32h743": ("PeripheralPins_WeActMiniH7xx.c", "variant_WeActMiniH7xx.h", "STM32H743VIT6"),
    # Готовый полётник собирается с вариантом DevEBox (тот же корпус) —
    # таблица выводов его, а что занято на плате, вариант не знает: ONBOARD.
    "matek-h743": ("PeripheralPins_DevEBoxH7xx.c", None, "STM32H743VIT6"),
}

# Занятое на готовых полётниках — по описанию платы (ArduPilot hwdef
# MatekH743). Пины датчиков на плате (SPI1, I2C2) и внешнего разъёма в
# прошивке — параметры @fixed: их занятость приложение видит и так.
ONBOARD = {
    "matek-h743": {
        **{p: "USB" for p in ("PA11", "PA12")},
        **{p: "SWD" for p in ("PA13", "PA14")},
        **{p: "microSD (SDMMC1)" for p in ("PC8", "PC9", "PC10", "PC11", "PC12", "PD2")},
        **{p: "OSD AT7456E (SPI2)" for p in ("PB12", "PB13", "PB14", "PB15")},
        **{p: "IMU2 (SPI4)" for p in ("PE11", "PE12", "PE13", "PE14")},
        "PC13": "IMU3 CS",
        **{p: "LED" for p in ("PE3", "PE4")},
        **{p: "CAN (FDCAN1)" for p in ("PD0", "PD1")},
    },
}

MAPS = {
    "PinMap_TIM": "pwm",
    "PinMap_UART_TX": "uart_tx",
    "PinMap_UART_RX": "uart_rx",
    "PinMap_I2C_SDA": "i2c_sda",
    "PinMap_I2C_SCL": "i2c_scl",
    "PinMap_SPI_SCLK": "spi_sck",
    "PinMap_SPI_MISO": "spi_miso",
    "PinMap_SPI_MOSI": "spi_mosi",
    "PinMap_ADC": "adc",
}

# Что на плате уже занято (по комментариям variant_*.h) — ошибка, а что
# выведено на разъём (камера, экран) — можно, если разъём не нужен.
RESERVED = re.compile(r"µSD|USB|FLASH|QSPI|Flash|SW Flash|OSC|LSE|HSE|SWD|SWCLK|SWDIO", re.I)
CONNECTOR = re.compile(r"DCMI|DVP|TFT|LCD|CAM", re.I)


def parse_maps(path):
    """{pin: {role: [entries]}} — только основные записи (без _ALTn) и не закомментированные."""
    text = open(path, encoding="utf-8", errors="replace").read()
    pins = {}
    for name, role in MAPS.items():
        m = re.search(r"const PinMap " + name + r"\[\] = \{(.*?)\n\};", text, re.S)
        if not m:
            continue
        for line in m.group(1).splitlines():
            line = line.strip()
            if not line.startswith("{P"):   # закомментированные строки начинаются с //
                continue
            e = re.match(r"\{(P[A-K])_(\d+)(_ALT\d+)?,\s*(\w+),.*?\}\s*,?\s*(?://\s*(.*))?$", line)
            if not e or e.group(3):
                continue
            pin = "{}{}".format(e.group(1), int(e.group(2)))
            label = (e.group(5) or e.group(4)).strip()
            pins.setdefault(pin, {}).setdefault(role, []).append({"inst": e.group(4), "label": label})
    return pins


def parse_variant(path):
    """Пины с комментарием в variant_*.h: занятые и выведенные на разъём."""
    reserved, connector = {}, {}
    for line in open(path, encoding="utf-8", errors="replace"):
        m = re.match(r"\s*#define\s+(P[A-K]\d+)\s+\S+\s*//\s*(.+)$", line)
        if not m:
            continue
        pin, note = m.group(1), m.group(2).strip()
        if RESERVED.search(note):
            reserved[pin] = note
        elif CONNECTOR.search(note):
            connector[pin] = note
    return reserved, connector


def main():
    if not os.path.isdir(H743):
        sys.exit("нет варианта STM32duino: " + H743 + " (соберите прошивку для STM32 хотя бы раз)")
    out_dir = os.path.join(ROOT, "src", "core", "pins")
    os.makedirs(out_dir, exist_ok=True)
    for env, (pp, vh, mcu) in BOARDS.items():
        pins = parse_maps(os.path.join(H743, pp))
        reserved, connector = parse_variant(os.path.join(H743, vh)) if vh else (dict(ONBOARD[env]), {})
        data = {
            "env": env,
            "mcu": mcu,
            "family": "stm32",
            "source": "STM32duino " + os.path.basename(H743) + "/" + pp,
            "pins": dict(sorted(pins.items(), key=lambda kv: (kv[0][1], int(kv[0][2:])))),
            "reserved": reserved,
            "connector": connector,
        }
        path = os.path.join(out_dir, env + ".json")
        with open(path, "w", encoding="utf-8", newline="\n") as f:
            json.dump(data, f, ensure_ascii=False, indent=1)
            f.write("\n")
        print("{}: пинов {}, заняты {}, на разъёмах {}".format(env, len(pins), len(reserved), len(connector)))


if __name__ == "__main__":
    main()
