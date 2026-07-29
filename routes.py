"""Local bridge between FeedBack and FeedForge Hub."""

import base64
import ctypes
import hashlib
import json
import logging
import os
import struct
import threading
import urllib.error
import urllib.request
import zipfile
from pathlib import Path, PurePosixPath
from urllib.parse import unquote, urlparse

import yaml
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

PLUGIN_ID = "feedforge_connect"
DEFAULT_HUB_URL = "https://feedforge.org"
MAX_QUEUE = 50
PLUGIN_VERSION = "0.4.1"


class HubError(Exception):
    def __init__(self, status: int, payload: dict):
        super().__init__(payload.get("errorDescription") or payload.get("error") or "FeedForge request failed")
        self.status = status
        self.payload = payload


def _safe_hub_url() -> str:
    value = os.environ.get("FEEDFORGE_HUB_URL", DEFAULT_HUB_URL).rstrip("/")
    parsed = urlparse(value)
    if parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in {"127.0.0.1", "localhost"}):
        return value
    return DEFAULT_HUB_URL


def _resolve_feedpak(dlc_root: Path, filename: str) -> Path:
    root = dlc_root.resolve()
    candidate = (root / unquote(str(filename or ""))).resolve()
    try:
        candidate.relative_to(root)
    except ValueError as exc:
        raise ValueError("Song path is outside the FeedBack library.") from exc
    if candidate.suffix.lower() != ".feedpak" or not candidate.is_file():
        raise ValueError("Ranked scores require an installed .feedpak file.")
    return candidate


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _chart_fingerprint(path: Path, arrangement_index: int) -> str:
    with zipfile.ZipFile(path) as archive:
        manifest = yaml.safe_load(archive.read("manifest.yaml")) or {}
        arrangements = manifest.get("arrangements") or []
        if not 0 <= arrangement_index < len(arrangements):
            raise ValueError("The selected arrangement is not in this FeedPak.")
        member = str(arrangements[arrangement_index].get("file") or "")
        safe = PurePosixPath(member.replace("\\", "/"))
        if not member or safe.is_absolute() or ".." in safe.parts:
            raise ValueError("The selected arrangement path is invalid.")
        chart = json.loads(archive.read(safe.as_posix()))
    if not isinstance(chart, dict):
        raise ValueError("The selected arrangement chart is invalid.")
    chart.pop("tones", None)
    digest = hashlib.sha256(b"feedforge-chart-v1\0")
    _update_chart_hash(digest, chart)
    return digest.hexdigest()


def _update_chart_hash(digest, value) -> None:
    if value is None:
        digest.update(b"N")
    elif value is False:
        digest.update(b"F")
    elif value is True:
        digest.update(b"T")
    elif isinstance(value, (int, float)):
        digest.update(b"D" + struct.pack(">d", float(value)))
    elif isinstance(value, str):
        encoded = value.encode("utf-8")
        digest.update(b"S" + struct.pack(">I", len(encoded)) + encoded)
    elif isinstance(value, list):
        digest.update(b"A" + struct.pack(">I", len(value)))
        for item in value:
            _update_chart_hash(digest, item)
    elif isinstance(value, dict):
        keys = sorted(value)
        digest.update(b"O" + struct.pack(">I", len(keys)))
        for key in keys:
            _update_chart_hash(digest, key)
            _update_chart_hash(digest, value[key])
    else:
        raise ValueError(f"Unsupported arrangement value: {type(value).__name__}")


def _protect_token(token: str) -> dict:
    if os.name != "nt":
        return {"token": token}
    encrypted = _crypt_protect(token.encode("utf-8"), False)
    return {"tokenProtected": base64.b64encode(encrypted).decode("ascii")}


def _unprotect_token(config: dict) -> str:
    if config.get("tokenProtected") and os.name == "nt":
        try:
            raw = base64.b64decode(config["tokenProtected"])
            return _crypt_protect(raw, True).decode("utf-8")
        except Exception:
            return ""
    return str(config.get("token") or "")


def _crypt_protect(data: bytes, decrypt: bool) -> bytes:
    class Blob(ctypes.Structure):
        _fields_ = [("cbData", ctypes.c_ulong), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = ctypes.create_string_buffer(data)
    incoming = Blob(len(data), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_ubyte)))
    outgoing = Blob()
    crypt32 = ctypes.windll.crypt32
    kernel32 = ctypes.windll.kernel32
    function = crypt32.CryptUnprotectData if decrypt else crypt32.CryptProtectData
    function.restype = ctypes.c_bool
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    kernel32.LocalFree.restype = ctypes.c_void_p
    if not function(ctypes.byref(incoming), None, None, None, None, 0, ctypes.byref(outgoing)):
        raise ctypes.WinError()
    try:
        return ctypes.string_at(outgoing.pbData, outgoing.cbData)
    finally:
        kernel32.LocalFree(outgoing.pbData)


def setup(app, context):
    log = context.get("log") or logging.getLogger("feedBack.plugin.feedforge_connect")
    config_dir = Path(context["config_dir"])
    config_file = config_dir / "feedforge_connect.json"
    queue_file = config_dir / "feedforge_connect_queue.json"
    lock = threading.Lock()
    router = APIRouter(prefix="/api/plugins/feedforge_connect")

    def read_json(path: Path, default):
        try:
            value = json.loads(path.read_text(encoding="utf-8"))
            return value if isinstance(value, type(default)) else default
        except (OSError, ValueError):
            return default

    def write_json(path: Path, value) -> None:
        config_dir.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(json.dumps(value, indent=2), encoding="utf-8")
        temporary.replace(path)
        if os.name != "nt":
            path.chmod(0o600)

    def config() -> dict:
        return read_json(config_file, {})

    def update_config(changes: dict, remove=()) -> dict:
        with lock:
            current = config()
            for key in remove:
                current.pop(key, None)
            current.update(changes)
            write_json(config_file, current)
            return current

    def hub(path: str, method="GET", body=None, token="") -> dict:
        data = json.dumps(body).encode("utf-8") if body is not None else None
        headers = {"Accept": "application/json", "User-Agent": f"FeedForge-Connect/{PLUGIN_VERSION}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        if token:
            headers["Authorization"] = f"Bearer {token}"
        request = urllib.request.Request(f"{_safe_hub_url()}{path}", data=data, headers=headers, method=method)
        try:
            with urllib.request.urlopen(request, timeout=15) as response:
                return json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            try:
                payload = json.loads(exc.read().decode("utf-8"))
            except (ValueError, UnicodeDecodeError):
                payload = {"error": f"FeedForge returned HTTP {exc.code}."}
            raise HubError(exc.code, payload) from exc

    def queued() -> list:
        return read_json(queue_file, [])

    def enqueue(payload: dict) -> None:
        with lock:
            items = queued()
            items.append(payload)
            write_json(queue_file, items[-MAX_QUEUE:])

    def submit_to_hub(payload: dict) -> dict:
        token = _unprotect_token(config())
        if not token:
            raise HubError(401, {"error": "Connect a FeedForge account first."})
        return hub("/api/v1/scores", "POST", payload, token)

    @router.get("/status")
    def status():
        current = config()
        return {"ok": True, "connected": bool(_unprotect_token(current)), "hubUrl": _safe_hub_url(), "queued": len(queued())}

    @router.post("/begin")
    def begin():
        try:
            result = hub("/api/v1/auth/device", "POST", {})
        except HubError as exc:
            return JSONResponse(exc.payload, status_code=exc.status)
        except urllib.error.URLError:
            return JSONResponse({"ok": False, "error": "FeedForge Hub is unavailable."}, status_code=503)
        update_config({"pendingDeviceCode": result["deviceCode"]})
        return result

    @router.post("/poll")
    def poll():
        current = config()
        device_code = current.get("pendingDeviceCode")
        if not device_code:
            return JSONResponse({"ok": False, "error": "No connection is pending."}, status_code=409)
        try:
            result = hub("/api/v1/auth/device/token", "POST", {"deviceCode": device_code})
        except HubError as exc:
            return JSONResponse(exc.payload, status_code=exc.status)
        except urllib.error.URLError:
            return JSONResponse({"ok": False, "error": "FeedForge Hub is unavailable."}, status_code=503)
        update_config(_protect_token(result["accessToken"]), remove=("pendingDeviceCode", "token", "tokenProtected"))
        return {"ok": True, "connected": True}

    @router.post("/disconnect")
    def disconnect():
        token = _unprotect_token(config())
        if token:
            try:
                hub("/api/v1/auth/token", "DELETE", token=token)
            except (HubError, urllib.error.URLError):
                pass
        update_config({}, remove=("pendingDeviceCode", "token", "tokenProtected"))
        return {"ok": True}

    @router.post("/submit")
    async def submit(request: Request):
        body = await request.json()
        try:
            feedpak = _resolve_feedpak(Path(context["get_dlc_dir"]()), body.get("filename", ""))
            payload = dict(body.get("score") or {})
            payload["checksumSha256"] = _sha256(feedpak)
            payload["chartFingerprint"] = _chart_fingerprint(feedpak, int(payload.get("arrangementIndex", 0)))
        except (OSError, ValueError) as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=422)
        try:
            result = submit_to_hub(payload)
            return result
        except HubError as exc:
            if exc.status in {401, 429} or exc.status >= 500:
                enqueue(payload)
                return JSONResponse({"ok": False, "queued": True, "error": str(exc)}, status_code=202)
            return JSONResponse(exc.payload, status_code=exc.status)
        except urllib.error.URLError as exc:
            enqueue(payload)
            log.warning("FeedForge score queued: %s", exc)
            return JSONResponse({"ok": False, "queued": True, "error": "FeedForge is unavailable; the score was queued."}, status_code=202)

    @router.post("/run/start")
    async def start_run(request: Request):
        body = await request.json()
        try:
            feedpak = _resolve_feedpak(Path(context["get_dlc_dir"]()), body.get("filename", ""))
            arrangement_index = int(body.get("arrangementIndex", 0))
            payload = {
                "checksumSha256": _sha256(feedpak),
                "chartFingerprint": _chart_fingerprint(feedpak, arrangement_index),
                "arrangementIndex": arrangement_index,
            }
            token = _unprotect_token(config())
            if not token:
                raise HubError(401, {"error": "Connect a FeedForge account first."})
            return hub("/api/v1/runs", "POST", payload, token)
        except (OSError, TypeError, ValueError) as exc:
            return JSONResponse({"ok": False, "error": str(exc)}, status_code=422)
        except HubError as exc:
            return JSONResponse(exc.payload, status_code=exc.status)
        except urllib.error.URLError:
            return JSONResponse({"ok": False, "error": "FeedForge Hub is unavailable; ranked play requires a connection at song start."}, status_code=503)

    @router.post("/retry")
    def retry():
        with lock:
            items = queued()
            remaining = []
            sent = 0
            for payload in items:
                try:
                    submit_to_hub(payload)
                    sent += 1
                except HubError as exc:
                    if exc.status not in {400, 404, 409, 422}:
                        remaining.append(payload)
                except urllib.error.URLError:
                    remaining.append(payload)
            write_json(queue_file, remaining)
        return {"ok": True, "sent": sent, "remaining": len(remaining)}

    app.include_router(router)
    log.info("FeedForge Connect routes registered")
