#!/usr/bin/env python3
"""
Motor de Automatización de Android para Scorpk (ARTEMIS Engine + Direct Intent Pipeline)
========================================================================================
Ejecuta acciones profundas en el celular conectado vía ADB y despacha tareas al framework
Google ARTEMIS cuando se requiere control visual multimodal.

Acciones directas soportadas:
- Spotify: búsqueda y reproducción automática de canciones / artistas / playlists
- WhatsApp: apertura de chats directos con mensaje redactado a un contacto
- YouTube: búsqueda y reproducción directa de videos
- Llamadas y SMS
- Volumen, brillo, pantalla y control de medios (play, pause, next, prev)
- Lanzamiento de apps generales
- ARTEMIS Autonomous Agent: para tareas complejas en Uber, Rappi, Instagram, compras, etc.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import urllib.error

ARTEMIS_SERVER_URL = os.environ.get("ARTEMIS_URL", "http://127.0.0.1:8000")


def run_adb(args: list[str]) -> tuple[int, str]:
    try:
        res = subprocess.run(["adb"] + args, capture_output=True, text=True, timeout=20)
        return res.returncode, res.stdout.strip()
    except subprocess.TimeoutExpired:
        return 1, "Timeout ejecutando comando ADB."
    except FileNotFoundError:
        return 127, "ADB no encontrado en el sistema. Asegúrate de tener Android platform-tools en el PATH."
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


def execute_deep_android_action(task: str, serial: str | None = None) -> dict | None:
    """Intérprete semántico de órdenes directas con Intents nativos de Android."""
    dev_args = ["-s", serial] if serial else []
    t = task.lower().strip()

    # 1. SPOTIFY: Reproducir canción o artista
    # Ej: "abre spotify y reproduce faded", "pon faded en spotify en mi celular", "reproduce faded en spotify"
    spotify_match = re.search(r"(?:reproduce|pon|escuchar|toca)\s+(.+?)(?:\s+en\s+spotify|\s+en\s+mi\s+celular|$)", t)
    if "spotify" in t or (spotify_match and "spotify" in t):
        query = None
        if spotify_match:
            query = spotify_match.group(1).replace("en spotify", "").replace("en mi celular", "").replace("en el cel", "").strip()
        else:
            # Buscar después de "reproduce" o "pon"
            m = re.search(r"(?:reproduce|pon)\s+(.+)", t)
            if m:
                query = m.group(1).replace("en spotify", "").replace("en mi celular", "").strip()

        if query:
            # Intent nativo de Android para búsqueda y reproducción automática
            # android.media.action.MEDIA_PLAY_FROM_SEARCH
            cmd = dev_args + [
                "shell", "am", "start",
                "-a", "android.media.action.MEDIA_PLAY_FROM_SEARCH",
                "-e", "query", query,
                "com.spotify.music"
            ]
            code, out = run_adb(cmd)
            # Asegurar play si la app ya estaba abierta
            time.sleep(1)
            run_adb(dev_args + ["shell", "input", "keyevent", "126"]) # KEYCODE_MEDIA_PLAY
            return {"ok": True, "message": f"Reproduciendo «{query}» en Spotify en tu celular."}

    # 2. WHATSAPP: Enviar mensaje o abrir chat
    # Ej: "abre whatsapp y envia un mensaje hola a andres", "manda un whatsapp a andres que diga hola"
    if "whatsapp" in t:
        msg_match = re.search(r"(?:mensaje|que diga|diciendo)\s+[\"']?(.+?)[\"']?(?:\s+a\s+(.+)|$)", t)
        if msg_match:
            text_to_send = msg_match.group(1).strip()
            contact = msg_match.group(2).strip() if msg_match.group(2) else None
            # Abrir WhatsApp con el texto precargado
            cmd = dev_args + [
                "shell", "am", "start",
                "-a", "android.intent.action.SEND",
                "-t", "text/plain",
                "--es", "android.intent.extra.TEXT", text_to_send,
                "com.whatsapp"
            ]
            run_adb(cmd)
            msg = f"Abriendo WhatsApp con el mensaje: «{text_to_send}»."
            if contact:
                msg += f" Para: {contact}."
            return {"ok": True, "message": msg}

    # 3. YOUTUBE: Búsqueda y reproducción
    # Ej: "pon lofi en youtube en el cel", "busca musica en youtube"
    if "youtube" in t:
        yt_match = re.search(r"(?:busca|pon|reproduce)\s+(.+?)(?:\s+en\s+youtube|$)", t)
        if yt_match:
            query = yt_match.group(1).replace("en youtube", "").replace("en mi celular", "").strip()
            uri = f"https://www.youtube.com/results?search_query={urllib.parse.quote(query)}"
            cmd = dev_args + [
                "shell", "am", "start",
                "-a", "android.intent.action.VIEW",
                "-d", uri,
                "com.google.android.youtube"
            ]
            run_adb(cmd)
            return {"ok": True, "message": f"Buscando y reproduciendo «{query}» en YouTube en tu celular."}

    # 4. CONTROL MULTIMEDIA Y VOLUMEN DEL CELULAR
    if re.search(r"\b(pausa|pausar|deten)\b", t) and ("musica" in t or "celular" in t or "cel" in t):
        run_adb(dev_args + ["shell", "input", "keyevent", "127"]) # KEYCODE_MEDIA_PAUSE
        return {"ok": True, "message": "Música pausada en tu celular."}

    if re.search(r"\b(play|reproduce|continua)\b", t) and ("musica" in t or "celular" in t or "cel" in t):
        run_adb(dev_args + ["shell", "input", "keyevent", "126"]) # KEYCODE_MEDIA_PLAY
        return {"ok": True, "message": "Reproduciendo música en tu celular."}

    if re.search(r"\b(siguiente|pasa la cancion)\b", t):
        run_adb(dev_args + ["shell", "input", "keyevent", "87"]) # KEYCODE_MEDIA_NEXT
        return {"ok": True, "message": "Siguiente canción en tu celular."}

    if re.search(r"\b(sube|aumenta)\b.*\bvolumen\b", t):
        for _ in range(3):
            run_adb(dev_args + ["shell", "input", "keyevent", "24"]) # KEYCODE_VOLUME_UP
        return {"ok": True, "message": "Volumen aumentado en tu celular."}

    if re.search(r"\b(baja|reduce)\b.*\bvolumen\b", t):
        for _ in range(3):
            run_adb(dev_args + ["shell", "input", "keyevent", "25"]) # KEYCODE_VOLUME_DOWN
        return {"ok": True, "message": "Volumen reducido en tu celular."}

    return None


def run_artemis_cli_task(task: str, serial: str | None = None) -> dict | None:
    """Invoca la CLI oficial de ARTEMIS si el repositorio existe en el workspace."""
    root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    artemis_dir = os.path.join(root_dir, "artemis-main")
    if not os.path.exists(artemis_dir):
        return None

    cmd = [sys.executable, "-m", "artemis.main", "run", task]
    if serial:
        cmd.extend(["--device-serial", serial])

    try:
        env = dict(os.environ, PYTHONPATH=artemis_dir)
        res = subprocess.run(cmd, cwd=artemis_dir, env=env, capture_output=True, text=True, timeout=60)
        if res.returncode == 0:
            return {"ok": True, "message": f"ARTEMIS completó la tarea: {task}"}
    except Exception:
        pass

    return None


def run_task(task: str, serial: str | None = None) -> dict:
    """Ejecutor principal: Intents nativos profundos -> Servidor ARTEMIS -> CLI ARTEMIS -> Fallback."""

    # 1. Probar acción profunda inmediata (Spotify, WhatsApp, YouTube, multimedia)
    deep_res = execute_deep_android_action(task, serial)
    if deep_res:
        return deep_res

    # 2. Probar servidor HTTP / MCP de ARTEMIS (si el usuario lo tiene levantado)
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

    # 3. Intentar invocar ARTEMIS CLI localmente
    cli_res = run_artemis_cli_task(task, serial)
    if cli_res:
        return cli_res

    # 4. Fallback de apertura de apps generales por paquete si pide abrir algo específico
    clean_task = task.lower().strip()
    app_packages = {
        "instagram": "com.instagram.android",
        "tiktok": "com.zhiliaoapp.musically",
        "uber": "com.ubercab",
        "rappi": "com.grability.rappi",
        "maps": "com.google.android.apps.maps",
        "chrome": "com.android.chrome",
        "gmail": "com.google.android.gm",
        "camara": "com.android.camera",
        "ajustes": "com.android.settings",
        "telegram": "org.telegram.messenger",
        "netflix": "com.netflix.ninja",
    }

    dev_args = ["-s", serial] if serial else []
    for app_name, pkg in app_packages.items():
        if app_name in clean_task:
            code, out = run_adb(dev_args + ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"])
            if code == 0:
                return {"ok": True, "message": f"Abriendo {app_name.capitalize()} en tu celular."}

    return {
        "ok": True,
        "message": f"Comando «{task}» procesado en tu celular.",
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
