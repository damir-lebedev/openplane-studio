#!/usr/bin/env python3
"""
Всё для подготовки компьютера без интернета — в установщик (src-tauri/resources/offline):

    python tools/offline_bundle.py --firmware ../plane --uv uv
    python tools/offline_bundle.py --firmware ../plane --uv uv --core-from ~/.platformio

Собирает под ту систему, на которой запущен (Windows x64, macOS arm64 или x86_64):

  python.tar.gz     Python 3.12 (python-build-standalone через uv) — для PlatformIO
  wheels.tar.gz     PlatformIO Core и его зависимости — pip ставит их без сети
  firmware.tar.gz   исходники прошивки (include, src, lib, tools, *.ini, *.csv) + метка коммита
  pio-stm32.tar.xz  платформа ststm32 и пакеты сборки и прошивки STM32 (без отладочных SVD
                    и драйверов чужих серий STM32 — нужны только H7 и F4)
  libdeps.tar.xz    библиотеки прошивки (U8g2, FreeRTOS) для сред STM32 — приложение кладёт
                    их в папку сборки, и PlatformIO не идёт за ними в сеть
  offline.json      что внутри

--core-from — взять пакеты из готовой папки PlatformIO (те же версии), а не качать.
Сборка проверяется: прошивка для stm32h743-devebox собирается из этих пакетов.
"""

import argparse
import json
import os
import shutil
import subprocess
import sys
import tarfile
import time

PLATFORMIO_VERSION = "6.2.0"
PYTHON_VERSION = "3.12"
STM32_ENVS = ["stm32h743-devebox", "stm32h743", "matek-h743"]
PACKAGES = [
    "framework-arduinoststm32",
    "framework-cmsis",
    "framework-cmsis-dsp",
    "tool-dfuutil",
    "tool-openocd",
    "tool-stm32flash",
    "toolchain-gccarmnoneeabi",
    "tool-scons",
]
# Серии STM32, под которые есть (и будут) платы: H7 — DevEBox, WeAct, Matek; F4 — F405.
SERIES = ("STM32H7xx", "STM32F4xx")
FIRMWARE_DIRS = ("include", "src", "lib", "tools")
FIRMWARE_ROOT_EXT = (".ini", ".csv")

sys.stdout.reconfigure(encoding="utf-8")


def run(cmd, env=None, cwd=None):
    print("$", " ".join(str(c) for c in cmd), flush=True)
    subprocess.run([str(c) for c in cmd], check=True, env=env, cwd=cwd)


def exe(name):
    return name + ".exe" if os.name == "nt" else name


def venv_bin(venv, name):
    return os.path.join(venv, "Scripts" if os.name == "nt" else "bin", exe(name))


def pruned(core_rel):
    """Путь внутри папки PlatformIO (через /), который в установщик не кладётся."""
    p = core_rel.replace("\\", "/")
    parts = p.split("/")
    if "__pycache__" in parts:
        return True
    if p.startswith("platforms/ststm32/misc/svd"):
        return True   # описания регистров для отладчика — сборке не нужны
    fw = "packages/framework-arduinoststm32/"
    for base in ("system/Drivers/CMSIS/Device/ST/", "system/Drivers/", "variants/"):
        prefix = fw + base
        if p.startswith(prefix):
            name = p[len(prefix):].split("/")[0]
            series = name.replace("_HAL_Driver", "")
            if series.startswith("STM32") and series not in SERIES and not name.endswith(".md"):
                return True
    return False


def python_install(uv, work):
    pydir = os.path.join(work, "py")
    env = dict(os.environ, UV_PYTHON_INSTALL_DIR=pydir)
    env.setdefault("UV_CACHE_DIR", os.path.join(work, "uv-cache"))
    run([uv, "python", "install", PYTHON_VERSION, "--no-bin", "--no-registry"], env=env)
    # настоящая папка cpython-3.12.N-…, а не ссылка cpython-3.12-…
    names = [n for n in os.listdir(pydir) if n.startswith("cpython-" + PYTHON_VERSION + ".") and os.path.isdir(os.path.join(pydir, n))]
    if not names:
        sys.exit("uv не поставил Python " + PYTHON_VERSION)
    top = os.path.join(pydir, sorted(names)[-1])
    python = os.path.join(top, "python.exe") if os.name == "nt" else os.path.join(top, "bin", "python3")
    return top, python


def add_tree(tar, root, arc_root, skip=None):
    for dirpath, dirnames, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        arc_dir = arc_root if rel_dir == "." else arc_root + "/" + rel_dir.replace(os.sep, "/")
        if skip:
            dirnames[:] = [d for d in dirnames if not skip(arc_dir + "/" + d)]
        # ссылка на папку (macOS) — ссылкой же, os.walk в неё не заходит
        for d in [d for d in dirnames if os.path.islink(os.path.join(dirpath, d))]:
            tar.add(os.path.join(dirpath, d), arc_dir + "/" + d, recursive=False)
            dirnames.remove(d)
        for f in filenames:
            arc = arc_dir + "/" + f
            if skip and skip(arc):
                continue
            tar.add(os.path.join(dirpath, f), arc, recursive=False)


def git_commit(path):
    try:
        out = subprocess.run(["git", "-C", path, "rev-parse", "HEAD"], capture_output=True, text=True, check=True)
        return out.stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--firmware", required=True, help="исходники прошивки (репозиторий plane / OpenPlaneProject)")
    ap.add_argument("--uv", default="uv")
    ap.add_argument("--core-from", help="готовая папка PlatformIO с пакетами STM32")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(__file__), "..", "src-tauri", "resources", "offline"))
    ap.add_argument("--commit", help="коммит прошивки, если в папке нет git")
    args = ap.parse_args()

    out = os.path.abspath(args.out)
    work = os.path.abspath(os.path.join(out, "..", ".offline-work"))
    shutil.rmtree(work, ignore_errors=True)
    os.makedirs(work)
    for name in os.listdir(out) if os.path.isdir(out) else []:
        if name != "README.md":
            os.remove(os.path.join(out, name))
    os.makedirs(out, exist_ok=True)
    started = time.time()

    # 1. Python
    pytop, python = python_install(args.uv, work)
    with tarfile.open(os.path.join(out, "python.tar.gz"), "w:gz") as tar:
        add_tree(tar, pytop, os.path.basename(pytop))

    # 2. Колёса PlatformIO
    wheels = os.path.join(work, "wheels")
    run([python, "-m", "pip", "download", "platformio==" + PLATFORMIO_VERSION, "-d", wheels, "-q"])
    with tarfile.open(os.path.join(out, "wheels.tar.gz"), "w:gz") as tar:
        for f in sorted(os.listdir(wheels)):
            tar.add(os.path.join(wheels, f), f)

    # 3. Исходники прошивки
    fw_src = os.path.abspath(args.firmware)
    fw = os.path.join(work, "OpenPlaneProject")
    os.makedirs(fw)
    for d in FIRMWARE_DIRS:
        if os.path.isdir(os.path.join(fw_src, d)):
            shutil.copytree(os.path.join(fw_src, d), os.path.join(fw, d), ignore=shutil.ignore_patterns("__pycache__"))
    for f in os.listdir(fw_src):
        if f.endswith(FIRMWARE_ROOT_EXT) and os.path.isfile(os.path.join(fw_src, f)):
            shutil.copy2(os.path.join(fw_src, f), fw)
    commit = args.commit or git_commit(fw_src) or "unknown"
    with open(os.path.join(fw, ".openplane-source.json"), "w", encoding="utf-8") as f:
        json.dump({"repo": "damir-lebedev/OpenPlaneProject", "ref": "bundled", "commit": commit}, f, indent=2)
    with tarfile.open(os.path.join(out, "firmware.tar.gz"), "w:gz") as tar:
        add_tree(tar, fw, "OpenPlaneProject")

    # 4. PlatformIO: своя (как у пользователя после установки) или готовая папка
    venv = os.path.join(work, "penv")
    run([python, "-m", "venv", venv])
    run([venv_bin(venv, "python"), "-m", "pip", "install", "--no-index", "--find-links", wheels, "platformio==" + PLATFORMIO_VERSION, "-q"])
    pio = venv_bin(venv, "pio")
    core = os.path.abspath(os.path.expanduser(args.core_from)) if args.core_from else os.path.join(work, "core")
    env = dict(os.environ, PLATFORMIO_CORE_DIR=core, PYTHONIOENCODING="utf-8", PYTHONUTF8="1")
    build = os.path.join(work, "build")
    shutil.copytree(fw, build)
    install = [pio, "pkg", "install", "-d", build]
    for e in STM32_ENVS:
        install += ["-e", e]
    run(install, env=env)
    run([pio, "run", "-d", build, "-e", STM32_ENVS[0]], env=env)   # сборка: и проверка, и tool-scons

    # 5. Пакеты STM32 из папки PlatformIO — в архив, без лишнего
    missing = [p for p in PACKAGES if not os.path.isdir(os.path.join(core, "packages", p))]
    if missing:
        sys.exit("нет пакетов: " + ", ".join(missing))
    print("pio-stm32.tar.xz…", flush=True)
    with tarfile.open(os.path.join(out, "pio-stm32.tar.xz"), "w:xz", preset=6) as tar:
        add_tree(tar, os.path.join(core, "platforms", "ststm32"), "platforms/ststm32", pruned)
        for p in PACKAGES:
            add_tree(tar, os.path.join(core, "packages", p), "packages/" + p, pruned)

    # 6. Библиотеки прошивки для сред STM32
    with tarfile.open(os.path.join(out, "libdeps.tar.xz"), "w:xz") as tar:
        for e in STM32_ENVS:
            add_tree(tar, os.path.join(build, ".pio", "libdeps", e), e)

    sizes = {f: os.path.getsize(os.path.join(out, f)) for f in sorted(os.listdir(out)) if f != "README.md"}
    manifest = {
        "platform": sys.platform,
        "machine": os.environ.get("PROCESSOR_ARCHITECTURE") or os.uname().machine,
        "python": os.path.basename(pytop),
        "platformio": PLATFORMIO_VERSION,
        "firmware_commit": commit,
        "envs": STM32_ENVS,
        "packages": PACKAGES,
        "files": sizes,
    }
    with open(os.path.join(out, "offline.json"), "w", encoding="utf-8") as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
    shutil.rmtree(work, ignore_errors=True)
    total = sum(sizes.values())
    print("готово за {:.0f} с: {} МБ".format(time.time() - started, total // (1024 * 1024)))
    for name, size in sizes.items():
        print("  {:<20} {:>7.1f} МБ".format(name, size / 1024 / 1024))


if __name__ == "__main__":
    main()
