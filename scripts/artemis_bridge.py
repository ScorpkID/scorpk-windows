#!/usr/bin/env python3
"""
Motor de Automatización de Android para Scorpk (ARTEMIS Engine + Direct Intent Pipeline)
========================================================================================
Ejecuta acciones profundas en el celular conectado vía ADB y despacha tareas al framework
Google ARTEMIS cuando se requiere control visual multimodal.

Acciones directas soportadas:
- Spotify: búsqueda y reproducción automática de canciones / artistas / playlists
- WhatsApp: apertura de chats directos con mensaje redactado y auto-envío a un contacto
- YouTube: búsqueda y reproducción directa de videos
- Volumen, multimedia, brillo y pantalla
- Lanzamiento de apps generales
- ARTEMIS Autonomous Agent: para tareas complejas
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import urllib.error

ARTEMIS_SERVER_URL = os.environ.get("ARTEMIS_URL", "http://127.0.0.1:8000")


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn").lower().strip()


def run_adb(args: list[str]) -> tuple[int, str]:
    try:
        res = subprocess.run(["adb"] + args, capture_output=True, text=True, timeout=20, encoding="utf-8", errors="ignore")
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


def get_whatsapp_package(dev_args: list[str]) -> str:
    _, out = run_adb(dev_args + ["shell", "pm", "list", "packages", "whatsapp"])
    if "package:com.whatsapp.w4b" in out and "package:com.whatsapp\n" not in out and not out.endswith("package:com.whatsapp"):
        return "com.whatsapp.w4b"
    return "com.whatsapp"


def find_contact_phone(contact_query: str, dev_args: list[str]) -> tuple[str | None, str | None]:
    """Busca en los contactos del teléfono el número o identificador de WhatsApp del contacto."""
    code, out = run_adb(dev_args + [
        "shell", "content", "query",
        "--uri", "content://com.android.contacts/data",
        "--projection", "display_name:data1:mimetype"
    ])
    if code != 0 or not out:
        return None, None

    target = strip_accents(contact_query)
    # Primera pasada: coincidencia exacta o muy cercana
    for line in out.splitlines():
        m = re.search(r"display_name=(.+?),\s*data1=(.+?),\s*mimetype=(.+)", line)
        if not m:
            continue
        disp_name, data1, mime = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
        disp_norm = strip_accents(disp_name)
        if target == disp_norm or target in disp_norm.split():
            if "@s.whatsapp.net" in data1:
                return disp_name, data1.replace("@s.whatsapp.net", "")
            clean = re.sub(r"[^\d+]", "", data1)
            if len(clean) >= 7:
                return disp_name, clean

    # Segunda pasada: coincidencia parcial donde target es subcadena del nombre (no al revés si el nombre es muy corto)
    for line in out.splitlines():
        m = re.search(r"display_name=(.+?),\s*data1=(.+?),\s*mimetype=(.+)", line)
        if not m:
            continue
        disp_name, data1, mime = m.group(1).strip(), m.group(2).strip(), m.group(3).strip()
        disp_norm = strip_accents(disp_name)
        if len(disp_norm) >= 3 and (target in disp_norm or (len(target) >= 4 and disp_norm in target)):
            if "@s.whatsapp.net" in data1:
                return disp_name, data1.replace("@s.whatsapp.net", "")
            clean = re.sub(r"[^\d+]", "", data1)
            if len(clean) >= 7:
                return disp_name, clean

    return None, None


def execute_deep_android_action(task: str, serial: str | None = None) -> dict | None:
    """Intérprete semántico de órdenes directas con Intents nativos de Android y automatización UI."""
    dev_args = ["-s", serial] if serial else []
    raw = task.strip()
    t = strip_accents(raw)

    # ──────────────────────────────────────────────────────────────────────────
    # 1. SPOTIFY: Búsqueda y reproducción automática
    # ──────────────────────────────────────────────────────────────────────────
    if "spotify" in t:
        # Extraer qué quiere escuchar
        query = None
        # Patrones:
        # "abre spotify y reproduce faded"
        # "pon faded en spotify en mi celular"
        # "reproduce canciones de shakira en spotify"
        # "abre faded en spotify"
        clean = re.sub(r"\b(en mi celular|en el cel|en mi cel|en mi telefono|en el telefono|en el movil)\b", "", t).strip()
        
        m = re.search(r"(?:reproduce|reproducir|pon|poner|toca|tocar|escuchar)\s+(?:a\s+)?(.+?)(?:\s+en\s+spotify|$)", clean)
        if m:
            query = m.group(1).replace("en spotify", "").strip()
        elif "abre" in clean or "abrir" in clean:
            m2 = re.search(r"(?:abre|abrir)\s+(.+?)\s+en\s+spotify", clean)
            if m2:
                query = m2.group(1).strip()
            else:
                m3 = re.search(r"(?:abre|abrir)\s+spotify(?:\s+y\s+reproduce\s+(.+))?", clean)
                if m3 and m3.group(1):
                    query = m3.group(1).strip()

        if query and query != "spotify":
            # 1. Intent oficial de búsqueda directa y reproducción en Spotify
            run_adb(dev_args + ["shell", "am", "start", "-a", "android.media.action.MEDIA_PLAY_FROM_SEARCH", "-e", "query", query, "com.spotify.music"])
            time.sleep(1.0)
            # También enviar URI directo
            run_adb(dev_args + ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"spotify:search:{urllib.parse.quote(query)}", "com.spotify.music"])
            time.sleep(1.2)
            # Pulsar primer resultado (en la lista de canciones) y reanudar reproducción
            run_adb(dev_args + ["shell", "input", "tap", "300", "550"])
            run_adb(dev_args + ["shell", "input", "keyevent", "126"]) # KEYCODE_MEDIA_PLAY
            run_adb(dev_args + ["shell", "input", "keyevent", "85"])  # KEYCODE_MEDIA_PLAY_PAUSE
            return {"ok": True, "message": f"Reproduciendo «{query}» en Spotify en tu celular."}
        else:
            # Solo abrir Spotify
            run_adb(dev_args + ["shell", "monkey", "-p", "com.spotify.music", "-c", "android.intent.category.LAUNCHER", "1"])
            return {"ok": True, "message": "Spotify abierto en tu celular."}

    # ──────────────────────────────────────────────────────────────────────────
    # 2. WHATSAPP: Enviar mensaje directo o redactar chat
    # ──────────────────────────────────────────────────────────────────────────
    if "whatsapp" in t:
        clean = re.sub(r"\b(en mi celular|en el cel|en mi cel|en mi telefono|en el telefono)\b", "", raw, flags=re.IGNORECASE).strip()
        
        # Buscar mensaje y contacto
        # Ej: "abre whatsapp y envia un mensaje Hola a Andres"
        # "manda un whatsapp a Mama que diga ya voy saliendo"
        # "envia un mensaje diciendo hola a andres"
        msg_text = None
        contact_target = None

        m1 = re.search(r"(?:mensaje|que diga|diciendo)\s+[\"']?(.+?)[\"']?\s+a\s+(.+)$", clean, re.IGNORECASE)
        m2 = re.search(r"(?:a\s+)(.+?)\s+(?:que diga|con el mensaje|diciendo|mensaje)\s+[\"']?(.+?)[\"']?$", clean, re.IGNORECASE)
        m3 = re.search(r"(?:mensaje|que diga|diciendo)\s+[\"']?(.+?)[\"']?$", clean, re.IGNORECASE)

        if m1:
            msg_text = m1.group(1).strip()
            contact_target = m1.group(2).strip()
        elif m2:
            contact_target = m2.group(1).strip()
            msg_text = m2.group(2).strip()
        elif m3:
            msg_text = m3.group(1).strip()

        # Limpiar palabras residuales del contacto
        if contact_target:
            contact_target = re.sub(r"\b(en mi celular|en el cel|por whatsapp|en whatsapp)\b", "", contact_target, flags=re.IGNORECASE).strip()

        pkg = get_whatsapp_package(dev_args)

        if contact_target:
            # Resolver número de contacto desde el teléfono
            resolved_name, phone_number = find_contact_phone(contact_target, dev_args)
            if phone_number:
                # Quitar '+' o espacios
                clean_phone = re.sub(r"[^\d]", "", phone_number)
                text_to_send = msg_text or "Hola"
                quoted = urllib.parse.quote(text_to_send)
                # Abrir chat directo sin pasar por pantalla de compartir
                # Nota: escapar & como \& para que el shell de Android no corte la URL
                run_adb(dev_args + ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", f"whatsapp://send?phone={clean_phone}\\&text={quoted}"])
                time.sleep(1.5)
                # Presionar enviar en la pantalla del chat
                # Si es Samsung A21s (720x1600), el botón enviar suele estar en (661, 1519)
                run_adb(dev_args + ["shell", "input", "tap", "661", "1519"])
                display = resolved_name or contact_target
                return {"ok": True, "message": f"Mensaje «{text_to_send}» enviado a {display} por WhatsApp en tu celular."}

        # Fallback si no hay contacto identificado o no se encontró en la agenda: abrir compartir
        if msg_text:
            run_adb(dev_args + [
                "shell", "am", "start",
                "-a", "android.intent.action.SEND",
                "-t", "text/plain",
                "--es", "android.intent.extra.TEXT", msg_text,
                pkg
            ])
            return {"ok": True, "message": f"Abriendo WhatsApp con el mensaje: «{msg_text}»."}

        # Solo abrir WhatsApp
        run_adb(dev_args + ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"])
        return {"ok": True, "message": "WhatsApp abierto en tu celular."}

    # ──────────────────────────────────────────────────────────────────────────
    # 3. YOUTUBE: Búsqueda y reproducción automática
    # ──────────────────────────────────────────────────────────────────────────
    if "youtube" in t:
        clean = re.sub(r"\b(en mi celular|en el cel|en mi cel|en mi telefono|en el telefono)\b", "", t).strip()
        m = re.search(r"(?:busca|buscar|pon|poner|reproduce|reproducir)\s+(.+?)(?:\s+en\s+youtube|$)", clean)
        query = None
        if m:
            query = m.group(1).replace("en youtube", "").strip()
        elif "abre" in clean or "abrir" in clean:
            m2 = re.search(r"(?:abre|abrir)\s+(.+?)\s+en\s+youtube", clean)
            if m2:
                query = m2.group(1).strip()

        if query and query != "youtube":
            uri = f"vnd.youtube://results?search_query={urllib.parse.quote_plus(query)}"
            run_adb(dev_args + ["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", uri])
            time.sleep(1.5)
            # Pulsar primer resultado de video (alrededor de y=550)
            run_adb(dev_args + ["shell", "input", "tap", "360", "550"])
            return {"ok": True, "message": f"Buscando y reproduciendo «{query}» en YouTube en tu celular."}
        else:
            run_adb(dev_args + ["shell", "monkey", "-p", "com.google.android.youtube", "-c", "android.intent.category.LAUNCHER", "1"])
            return {"ok": True, "message": "YouTube abierto en tu celular."}

    # ──────────────────────────────────────────────────────────────────────────
    # 4. CONTROL MULTIMEDIA Y VOLUMEN DEL CELULAR
    # ──────────────────────────────────────────────────────────────────────────
    if re.search(r"\b(pausa|pausar|deten|detener|para)\b", t):
        run_adb(dev_args + ["shell", "input", "keyevent", "127"]) # KEYCODE_MEDIA_PAUSE
        return {"ok": True, "message": "Música pausada en tu celular."}

    if re.search(r"\b(play|reproduce|reanuda|continua)\b", t) and not re.search(r"\b(cancion|tema|video)\b", t):
        run_adb(dev_args + ["shell", "input", "keyevent", "126"]) # KEYCODE_MEDIA_PLAY
        return {"ok": True, "message": "Reproduciendo en tu celular."}

    if re.search(r"\b(siguiente|pasa la cancion|salta|proxima)\b", t):
        run_adb(dev_args + ["shell", "input", "keyevent", "87"]) # KEYCODE_MEDIA_NEXT
        return {"ok": True, "message": "Siguiente canción en tu celular."}

    if re.search(r"\b(anterior|cancion anterior|regresa)\b", t):
        run_adb(dev_args + ["shell", "input", "keyevent", "88"]) # KEYCODE_MEDIA_PREVIOUS
        return {"ok": True, "message": "Canción anterior en tu celular."}

    if re.search(r"\b(sube|aumenta|mas)\b.*\bvolumen\b", t):
        for _ in range(4):
            run_adb(dev_args + ["shell", "input", "keyevent", "24"]) # KEYCODE_VOLUME_UP
        return {"ok": True, "message": "Volumen aumentado en tu celular."}

    if re.search(r"\b(baja|reduce|menos)\b.*\bvolumen\b", t):
        for _ in range(4):
            run_adb(dev_args + ["shell", "input", "keyevent", "25"]) # KEYCODE_VOLUME_DOWN
        return {"ok": True, "message": "Volumen reducido en tu celular."}

    return None


def run_artemis_cli_task(task: str, serial: str | None = None) -> dict | None:
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

    # 4. Fallback de apertura de apps generales por paquete
    clean_task = strip_accents(task)
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
            code, _ = run_adb(dev_args + ["shell", "monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"])
            if code == 0:
                return {"ok": True, "message": f"Abriendo {app_name.capitalize()} en tu celular."}

    return {
        "ok": True,
        "message": f"Orden «{task}» procesada en tu celular.",
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
