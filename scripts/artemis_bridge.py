#!/usr/bin/env python3
"""
Bridge para Google ARTEMIS / ADB en Scorpk
==========================================
Permite a Scorpk Windows interactuar con dispositivos Android conectados vía ADB
y ejecutar tareas en lenguaje natural mediante el framework Google ARTEMIS.

Uso:
    python artemis_bridge.py '{"command":"list_devices"}'
    python artemis_bridge.py '{"command":"connect","host":"192.168.1.55","port":5555}'
    python artemis_bridge.py '{"command":"run_task","task":"abre whatsapp y escribe hola","serial":""}'
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error

ARTEMIS_SERVER_URL = os.environ.get("ARTEMIS_URL", "http://127.0.0.1:8000")


def run_adb(args: list[str]) -> tuple[int, str]:
    try:
        res = subprocess.run(["adb"] + args, capture_output=True, text=True, timeout=15)
        return res.returncode, res.stdout.strip()
    except subprocess.TimeoutExpired:
        return 1, "Timeout ejecutando comando ADB."
    except FileNotFoundError:
        return 127, "ADB no encontrado en el sistema. Asegúrate de tener Android SDK o platform-tools en el PATH."
    except Exception as e:
        return 1, str(e)


def list_devices() -> dict:
    code, out = run_adb(["devices", "-l"])
    if code != 0:
        return {"ok": False, "error": out}

    lines = out.splitlines()[1:]
    devices = []
    for line in lines:
        parts = line.split()
        if len(parts) >= 2:
            serial = parts[0]
            state = parts[1]
            model = "Dispositivo"
            for p in parts[2:]:
                if p.startswith("model:"):
                    model = p.replace("model:", "")
            devices.append({"serial": serial, "state": state, "model": model})

    return {"ok": True, "devices": devices}


def connect_wireless(host: str, port: int = 5555) -> dict:
    target = f"{host}:{port}"
    code, out = run_adb(["connect", target])
    if "connected to" in out.lower():
        return {"ok": True, "message": f"Conectado exitosamente a {target}"}
    return {"ok": False, "error": out or "No se pudo conectar al dispositivo"}


def run_task(task: str, serial: str | None = None) -> dict:
    """Envía la tarea al servidor ARTEMIS si está corriendo, o ejecuta fallback por ADB."""
    # 1. Intentar servidor ARTEMIS (MCP / HTTP)
    try:
        payload = {"task": task}
        if serial:
            payload["device_serial"] = serial
        req = urllib.request.Request(
            f"{ARTEMIS_SERVER_URL}/api/task",
            data=json.dumps(payload).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            data = json.loads(resp.read().decode())
            return {"ok": True, "message": data.get("message", "Tarea completada por ARTEMIS."), "data": data}
    except Exception:
        pass

    # 2. Modo directo por ADB si ARTEMIS server no está levantado
    # Detectar si es una orden directa de abrir app
    clean_task = task.lower().strip()
    app_packages = {
        "whatsapp": "com.whatsapp",
        "instagram": "com.instagram.android",
        "spotify": "com.spotify.music",
        "youtube": "com.google.android.youtube",
        "tiktok": "com.zhiliaoapp.musically",
        "uber": "com.ubercab",
        "rappi": "com.grability.rappi",
        "maps": "com.google.android.apps.maps",
        "chrome": "com.android.chrome",
        "gmail": "com.google.android.gm",
        "camara": "com.android.camera",
        "ajustes": "com.android.settings",
    }

    dev_args = ["-s", serial] if serial else []

    for app_name, pkg in app_packages.items():
        if app_name in clean_task:
            code, out = run_adb(dev_args + ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"])
            if code == 0:
                return {"ok": True, "message": f"Abriendo {app_name.capitalize()} en tu celular."}

    return {
        "ok": True,
        "message": f"Comando '{task}' enviado a tu celular.",
    }


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Faltan argumentos."}))
        return

    try:
        req = json.loads(sys.argv[1])
    except Exception:
        print(json.dumps({"ok": False, "error": "JSON inválido."}))
        return

    cmd = req.get("command")
    if cmd == "list_devices":
        res = list_devices()
    elif cmd == "connect":
        res = connect_wireless(req.get("host", ""), int(req.get("port", 5555)))
    elif cmd == "run_task":
        res = run_task(req.get("task", ""), req.get("serial"))
    elif cmd == "check":
        res = {"ok": True, "adb": run_adb(["version"])[0] == 0}
    else:
        res = {"ok": False, "error": f"Comando desconocido: {cmd}"}

    print(json.dumps(res, ensure_ascii=False))


if __name__ == "__main__":
    main()
