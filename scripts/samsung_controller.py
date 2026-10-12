#!/usr/bin/env python3
"""
Samsung TV Controller para Scorpk
==================================
Puente entre Rust (Tauri) y samsungtvws para controlar televisores Samsung Tizen.

Uso:
    python samsung_controller.py '{"ip":"192.168.1.50","command":"power","value":"on",...}'

Entrada (JSON como primer argumento):
    ip          – IP del televisor (requerido)
    port        – puerto WebSocket (por defecto 8002)
    token_file  – ruta al archivo de token de autorización
    command     – power | volume | app | input | media | key | pair | check
    value       – valor específico del comando
    extra       – parámetro adicional (ej. búsqueda dentro de una app)

Salida (JSON por stdout):
    {"ok": true,  "message": "..."}
    {"ok": false, "error": "..."}
"""

from __future__ import annotations

import json
import sys
import time

# ─── IDs de apps de Tizen conocidas ─────────────────────────────────────────

TIZEN_APPS: dict[str, str] = {
    "netflix":       "3201907018807",
    "youtube":       "111299001912",
    "spotify":       "3201606009684",
    "prime_video":   "3201910019365",
    "prime":         "3201910019365",
    "amazon_prime":  "3201910019365",
    "disney":        "3201901017640",
    "disney_plus":   "3201901017640",
    "apple_tv":      "3201807016597",
    "browser":       "3202010022079",
    "plex":          "3201512006963",
    "hbo":           "3201601007230",
    "hbo_max":       "3201601007230",
    "twitch":        "3201909019271",
    "deezer":        "3201608010191",
    "rakuten":       "3201511006428",
    "tv_plus":       "3201710015037",
    "movistar":      "3201804012178",
    "tidal":         "3201805016367",
    "crunchyroll":   "3201412000295",
}

# ─── Mapas de teclas ────────────────────────────────────────────────────────

INPUT_KEYS: dict[str, str] = {
    "hdmi1": "KEY_HDMI1",
    "hdmi2": "KEY_HDMI2",
    "hdmi3": "KEY_HDMI3",
    "hdmi4": "KEY_HDMI4",
    "hdmi":  "KEY_HDMI",
    "tv":    "KEY_TV",
    "dtv":   "KEY_DTV",
}

MEDIA_KEYS: dict[str, str] = {
    "play":       "KEY_PLAY",
    "pause":      "KEY_PAUSE",
    "play_pause": "KEY_PAUSE",
    "stop":       "KEY_STOP",
    "next":       "KEY_FF",
    "previous":   "KEY_REWIND",
}

NAV_KEYS: dict[str, str] = {
    "home":  "KEY_HOME",
    "back":  "KEY_RETURN",
    "menu":  "KEY_MENU",
    "up":    "KEY_UP",
    "down":  "KEY_DOWN",
    "left":  "KEY_LEFT",
    "right": "KEY_RIGHT",
    "enter": "KEY_ENTER",
}


# ─── Ejecución de comandos ──────────────────────────────────────────────────

def ok(message: str) -> dict:
    return {"ok": True, "message": message}


def err(message: str) -> dict:
    return {"ok": False, "error": message}


def play_youtube_dial(tv_host: str, query: str) -> bool:
    """Busca el video en YouTube y lo envía a reproducir directamente en la TV usando el protocolo oficial DIAL."""
    import re
    import urllib.request

    video_id: str | None = None

    # Si la query ya es un video ID o URL de YouTube
    if re.match(r"^[a-zA-Z0-9_-]{11}$", query.strip()):
        video_id = query.strip()
    elif "watch?v=" in query:
        m = re.search(r"watch\?v=([a-zA-Z0-9_-]{11})", query)
        if m:
            video_id = m.group(1)

    # Si es texto de búsqueda, resolver video ID desde YouTube
    if not video_id:
        try:
            search_url = f"https://www.youtube.com/results?search_query={urllib.request.quote(query)}"
            search_req = urllib.request.Request(search_url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
            html = urllib.request.urlopen(search_req, timeout=4).read().decode("utf-8", errors="ignore")
            # Encontrar primer video relevante
            m = re.search(r"\/watch\?v=([a-zA-Z0-9_-]{11})", html)
            if m:
                video_id = m.group(1)
        except Exception:
            pass

    if not video_id:
        return False

    # Enviar payload oficial DIAL al televisor Samsung (puerto 8080)
    try:
        dial_url = f"http://{tv_host}:8080/ws/apps/YouTube"
        payload = f"v={video_id}".encode("utf-8")
        dial_req = urllib.request.Request(
            dial_url,
            data=payload,
            headers={
                "Origin": "https://www.youtube.com",
                "Referer": "https://www.youtube.com/tv",
                "Content-Type": "text/plain; charset=utf-8",
            },
            method="POST",
        )
        res = urllib.request.urlopen(dial_req, timeout=4)
        return res.status in (200, 201, 204)
    except Exception:
        return False


def execute(tv, command: str, value: str | None, extra: str | None) -> dict:  # noqa: C901
    """Despacha un comando al televisor y devuelve el resultado como dict."""

    if command == "power":
        if value == "off":
            tv.send_key("KEY_POWER")
            return ok("Televisor apagado.")
        # "on" se maneja primero con WoL en Rust; este send_key es un fallback.
        tv.send_key("KEY_POWER")
        return ok("Televisor encendido.")

    if command == "volume":
        if value == "up":
            tv.send_key("KEY_VOLUP")
            return ok("Volumen de la tele arriba.")
        if value == "down":
            tv.send_key("KEY_VOLDOWN")
            return ok("Volumen de la tele abajo.")
        if value in ("mute", "unmute"):
            tv.send_key("KEY_MUTE")
            return ok("Televisor silenciado." if value == "mute" else "Sonido del televisor activado.")
        return err(f"Valor de volumen no reconocido: {value}")

    if command == "app":
        if not value:
            return err("No se indicó qué app abrir.")
        app_key = value.lower().strip().replace(" ", "_").replace("+", "_plus")
        app_id = TIZEN_APPS.get(app_key)
        if not app_id:
            names = ", ".join(sorted(TIZEN_APPS.keys()))
            return err(f"No conozco la app '{value}'. Apps disponibles: {names}")
        
        # 1. Intentar primero lanzamiento directo vía REST API (puerto 8001) - instantáneo y garantizado
        import urllib.request
        rest_ok = False
        try:
            req_url = f"http://{tv.host}:8001/api/v2/applications/{app_id}"
            req = urllib.request.Request(req_url, data=b"", method="POST")
            res = urllib.request.urlopen(req, timeout=3)
            if res.status in (200, 201, 204):
                rest_ok = True
        except Exception:
            pass

        # 2. Si REST no responde o como complemento, ejecutar vía WebSocket run_app
        if not rest_ok:
            try:
                tv.run_app(app_id)
            except Exception as exc:
                return err(f"No pude abrir {value}: {exc}")

        # 3. Si además viene una búsqueda o término (extra), automatizar la búsqueda y reproducción dentro de la app
        if extra and extra.strip():
            query = extra.strip()
            
            # CASO ESPECIAL YOUTUBE: Uso del protocolo oficial DIAL (reproducción directa garantizada)
            if app_key in ("youtube", "yutub"):
                played = play_youtube_dial(tv.host, query)
                if played:
                    return ok(f"Reproduciendo «{query}» en YouTube en la TV.")
                # Si falló la resolución del video ID, fallback a automatización de interfaz
                time.sleep(2.0)
                try:
                    tv.send_key("KEY_LEFT")
                    time.sleep(0.4)
                    tv.send_key("KEY_UP")
                    time.sleep(0.3)
                    tv.send_key("KEY_UP")
                    time.sleep(0.3)
                    tv.send_key("KEY_ENTER")
                    time.sleep(1.0)
                    tv.send_text(query)
                    time.sleep(0.5)
                    tv.send_key("KEY_ENTER")
                    return ok(f"Buscando «{query}» en YouTube en la TV.")
                except Exception:
                    pass

            elif app_key in ("netflix", "spotify"):
                time.sleep(2.5)
                try:
                    tv.send_key("KEY_UP")
                    time.sleep(0.3)
                    tv.send_key("KEY_ENTER")
                    time.sleep(1.0)
                    tv.send_text(query)
                    time.sleep(0.5)
                    tv.send_key("KEY_ENTER")
                    return ok(f"Abierto {value} y buscando «{query}» en la TV.")
                except Exception as e:
                    return ok(f"Abierto {value} en la TV ({e}).")

        return ok(f"Abriendo {value} en la TV.")

    if command == "search":
        # Comando directo de búsqueda en la TV
        query = value or extra or ""
        if not query:
            return err("No se indicó qué buscar en la TV.")
        
        # Intentar reproducción instantánea en YouTube vía DIAL
        played = play_youtube_dial(tv.host, query)
        if played:
            return ok(f"Reproduciendo «{query}» en YouTube en la TV.")
        
        # Fallback a apertura tradicional
        import urllib.request
        try:
            req_url = f"http://{tv.host}:8001/api/v2/applications/111299001912"
            req = urllib.request.Request(req_url, data=b"", method="POST")
            urllib.request.urlopen(req, timeout=3)
        except Exception:
            try:
                tv.run_app("111299001912")
            except Exception:
                pass
        
        time.sleep(2.5)
        try:
            tv.send_key("KEY_LEFT")
            time.sleep(0.4)
            tv.send_key("KEY_UP")
            time.sleep(0.3)
            tv.send_key("KEY_UP")
            time.sleep(0.3)
            tv.send_key("KEY_ENTER")
            time.sleep(1.0)
            tv.send_text(query)
            time.sleep(0.5)
            tv.send_key("KEY_ENTER")
            return ok(f"Buscando «{query}» en YouTube en la TV.")
        except Exception as e:
            return err(f"Error realizando la búsqueda: {e}")

    if command == "text":
        if not value:
            return err("No se indicó el texto a escribir en la TV.")
        try:
            tv.send_text(value)
            return ok(f"Texto «{value}» enviado a la TV.")
        except Exception as e:
            return err(f"No se pudo escribir el texto en la TV: {e}")

    if command == "input":
        if not value:
            return err("No se indicó la entrada (hdmi1, hdmi2…).")
        key = INPUT_KEYS.get(value.lower().replace(" ", ""))
        if not key:
            return err(f"Entrada no reconocida: {value}. Usa: {', '.join(INPUT_KEYS.keys())}.")
        tv.send_key(key)
        return ok(f"Entrada cambiada a {value}.")

    if command == "media":
        if not value:
            return err("No se indicó la acción multimedia.")
        key = MEDIA_KEYS.get(value)
        if not key:
            return err(f"Control multimedia no reconocido: {value}.")
        tv.send_key(key)
        return ok(f"TV: {value}.")

    if command == "key":
        if not value:
            return err("No se indicó la tecla.")
        key = NAV_KEYS.get(value)
        if not key:
            return err(f"Tecla no reconocida: {value}.")
        tv.send_key(key)
        return ok(f"Tecla {value} enviada.")

    if command == "pair":
        # Solo conectar dispara el diálogo de autorización en la pantalla del televisor.
        tv.open()
        time.sleep(2)
        tv.close()
        return ok("Vinculación iniciada. Acepta en la pantalla del televisor.")

    if command == "check":
        tv.open()
        tv.close()
        return ok("Conexión exitosa con el televisor.")

    return err(f"Comando no reconocido: {command}")


# ─── Punto de entrada ───────────────────────────────────────────────────────

def main() -> None:
    if len(sys.argv) < 2:
        print(json.dumps(err("Falta el argumento JSON con la acción.")))
        sys.exit(1)

    try:
        req: dict = json.loads(sys.argv[1])
    except (json.JSONDecodeError, ValueError):
        print(json.dumps(err("JSON inválido.")))
        sys.exit(1)

    ip: str | None = req.get("ip")
    if not ip:
        print(json.dumps(err("Falta la IP del televisor.")))
        sys.exit(1)

    # Importar aquí para que los errores de dependencia se reporten limpiamente.
    try:
        from samsungtvws import SamsungTVWS  # type: ignore[import-untyped]
    except ImportError:
        print(json.dumps(err("La librería 'samsungtvws' no está instalada. Ejecuta: pip install samsungtvws")))
        sys.exit(1)

    port: int = int(req.get("port", 8002))
    token_file: str | None = req.get("token_file")
    command: str = req.get("command", "")
    value: str | None = req.get("value")
    extra: str | None = req.get("extra")

    try:
        tv = SamsungTVWS(host=ip, port=port, token_file=token_file, name="Scorpk")
        result = execute(tv, command, value, extra)
    except ConnectionRefusedError:
        result = err("No se pudo conectar con la TV. ¿Está encendida y en la misma red?")
    except TimeoutError:
        result = err("La TV no respondió a tiempo. ¿Está encendida y en la misma red?")
    except OSError as exc:
        result = err(f"Error de red: {exc}")
    except Exception as exc:
        result = err(f"Error inesperado: {exc}")

    print(json.dumps(result, ensure_ascii=False))


if __name__ == "__main__":
    main()
