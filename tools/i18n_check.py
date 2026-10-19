#!/usr/bin/env python3
"""
Строки интерфейса для перевода против словарей.

    python tools/i18n_check.py                 # сводка: чего нет в словарях, что лишнее
    python tools/i18n_check.py --missing       # непереведённые (JSON: строка → откуда)
    python tools/i18n_check.py --firmware DIR  # исходники прошивки (по умолчанию ../plane)
    python tools/i18n_check.py --prune         # убрать из словарей строки, которых больше нет

Ключ — сама русская строка (как в gettext), подстановки — {имя}.

Словарей у языка два:
  src/locales/en.json           — строки приложения: t("…") и N_("…") в src/
  src/locales/en.firmware.json  — строки прошивки: описание (tools/opconfig.py
                                  describe) — описания из Config.h, платы, датчики
Без исходников прошивки второй словарь не проверяется.
"""

import json
import os
import re
import subprocess
import sys

ROOT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SRC = os.path.join(ROOT, "src")
CALL = re.compile(r'\b(?:t|N_)\(\s*"((?:[^"\\]|\\.)*)"')
CYR = re.compile(r"[А-Яа-яЁё]")


def app_keys():
    found = {}
    for base, _, files in os.walk(SRC):
        if "__fixtures__" in base or "__tests__" in base:
            continue
        for name in files:
            if not name.endswith((".ts", ".tsx")) or ".test." in name:
                continue
            path = os.path.join(base, name)
            text = open(path, encoding="utf-8").read()
            for m in CALL.finditer(text):
                key = json.loads('"' + m.group(1) + '"')
                if CYR.search(key):
                    found.setdefault(key, os.path.relpath(path, ROOT))
    return found


def firmware_keys(firmware):
    tool = os.path.join(firmware, "tools", "opconfig.py")
    if not os.path.exists(tool):
        return None
    out = subprocess.run([sys.executable, tool, "describe"], cwd=firmware, capture_output=True, check=True)
    manifest = json.loads(out.stdout.decode("utf-8"))
    found = {}

    def walk(x, path):
        if isinstance(x, dict):
            for k, v in x.items():
                walk(v, path + "." + k)
        elif isinstance(x, list):
            for v in x:
                walk(v, path)
        elif isinstance(x, str) and CYR.search(x):
            found.setdefault(x, "manifest" + path)

    walk(manifest, "")
    return found


def compare(found, path):
    dictionary = json.load(open(path, encoding="utf-8")) if os.path.exists(path) else {}
    missing = sorted(k for k in found if k not in dictionary)
    stale = sorted(k for k in dictionary if k not in found)
    return dictionary, missing, stale


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    args = sys.argv[1:]
    firmware = os.path.normpath(os.path.join(ROOT, "..", "plane"))
    if "--firmware" in args:
        firmware = args[args.index("--firmware") + 1]
    sets = [("en.json", app_keys())]
    fw = firmware_keys(firmware)
    if fw is not None:
        sets.append(("en.firmware.json", fw))
    if "--missing" in args:
        out = {}
        for name, found in sets:
            _, missing, _ = compare(found, os.path.join(SRC, "locales", name))
            out.update({k: found[k] for k in missing})
        json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
        return
    if "--prune" in args:
        for name, found in sets:
            path = os.path.join(SRC, "locales", name)
            dictionary, _, stale = compare(found, path)
            for k in stale:
                del dictionary[k]
            with open(path, "w", encoding="utf-8", newline="\n") as f:
                json.dump(dict(sorted(dictionary.items())), f, ensure_ascii=False, indent=1)
                f.write("\n")
            print("{}: убрано {}".format(name, len(stale)))
        return
    bad = False
    for name, found in sets:
        dictionary, missing, stale = compare(found, os.path.join(SRC, "locales", name))
        print("{}: строк {}, в словаре {}, нет перевода {}, лишних {}".format(name, len(found), len(dictionary), len(missing), len(stale)))
        for k in missing[:40]:
            print("  нет:", k[:120])
        for k in stale[:20]:
            print("  лишняя:", k[:120])
        bad = bad or bool(missing)
    if fw is None:
        print("исходники прошивки не найдены ({}): en.firmware.json не проверен".format(firmware))
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
