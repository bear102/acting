"""Trials of Odysseus - API server.

Run:  ..\\.venv\\Scripts\\uvicorn app:app --reload --port 8000   (from backend/)
"""
from __future__ import annotations

import json
import logging
import os
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

import oracle  # noqa: E402
import scoring  # noqa: E402
import store  # noqa: E402
import takes  # noqa: E402  (saves every take for offline re-scoring)
from features import audio_contours, decode_audio  # noqa: E402

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("app")

SCENES_DIR = ROOT / "scenes"
MEDIA_DIR = SCENES_DIR / "media"
MEDIA_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Trials of Odysseus")
app.mount("/media", StaticFiles(directory=MEDIA_DIR), name="media")


@app.on_event("startup")
async def warm_up():
    """librosa JIT-compiles on first use (~5s); pay that before the first player does."""
    import numpy as np
    await run_in_threadpool(audio_contours, np.zeros(16000, dtype="float32"))
    st = oracle.status()
    if not st["elevenlabs"] and st["whisper"]:
        import threading

        import local_stt

        # Load (and on first run download) the Whisper model now, without blocking startup.
        threading.Thread(target=lambda: local_stt.transcribe_pcm(np.zeros(32000, dtype="float32")),
                         daemon=True).start()


def load_scenes() -> dict[str, dict]:
    scenes = {}
    for p in sorted(SCENES_DIR.glob("*.json")):
        s = json.loads(p.read_text(encoding="utf-8"))
        if s.get("video") and not (SCENES_DIR / s["video"]).exists():
            s["video"] = None  # clip not on this machine (media is gitignored)
        scenes[s["id"]] = s
    return scenes


def summary(s: dict) -> dict:
    ref = s.get("reference") or {}
    return {k: s.get(k) for k in ("id", "title", "book", "blurb", "difficulty", "video", "duration",
                                  "characters", "order")} | {
        "lines": len(s["lines"]), "has_reference": bool(ref.get("pose") or ref.get("face") or ref.get("audio"))}


@app.get("/api/health")
def health():
    return {"ok": True, **oracle.status(), "leaderboard": store.backend_name()}


@app.get("/api/scenes")
def list_scenes():
    scenes = sorted(load_scenes().values(), key=lambda s: s.get("order", 99))
    return [summary(s) for s in scenes]


@app.get("/api/scenes/{scene_id}")
def get_scene(scene_id: str):
    s = load_scenes().get(scene_id)
    if not s:
        raise HTTPException(404, "No such scene")
    ref = s.get("reference") or {}
    # The stage only needs shots + the reference skeletons (ghost figures); face/audio stay server-side.
    slim = {"fps": ref.get("fps"), "shots": ref.get("shots") or [], "pose": ref.get("pose")} if ref.get("pose") else None
    return {**s, "reference": slim, "has_reference": bool(ref.get("pose") or ref.get("face") or ref.get("audio"))}


@app.get("/api/leaderboard")
def get_leaderboard(scene_id: str | None = None):
    return store.leaderboard(scene_id)


@app.post("/api/perform")
async def perform(meta: str = Form(...), audio: UploadFile | None = File(None),
                  frames: list[UploadFile] = File(default=[])):
    m = json.loads(meta)
    scene = load_scenes().get(m["scene_id"])
    if not scene:
        raise HTTPException(404, "No such scene")

    audio_bytes = await audio.read() if audio else b""
    frame_bytes = [await f.read() for f in frames]

    pcm = await run_in_threadpool(_decode, audio_bytes)

    # --- ears: ElevenLabs Scribe -> local Whisper -> the browser's own speech recognition
    words = await oracle.transcribe(audio_bytes, audio.filename if audio else "take.webm")
    stt_source = "elevenlabs"
    if words is None:
        words = await oracle.transcribe_local(pcm)
        stt_source = "whisper"
    if not words and m.get("browser_transcript"):  # Whisper missing, failed, or heard nothing
        stt_source = "browser"
        words = []
        for seg in m.get("browser_transcript", []):
            seg_words = seg["text"].split()
            start = max(0.0, seg["t"] - 0.38 * len(seg_words))
            for i, w in enumerate(seg_words):
                words.append({"text": w, "start": start + 0.38 * i})
    words = words or []
    has_times = any(w.get("start") is not None for w in words)
    heard_text = " ".join(w["text"] for w in words)

    # --- the four judges (CPU-bound, off the event loop)
    contours = await run_in_threadpool(_contours, pcm)
    assignments = {c: int(p) for c, p in m["assignments"].items()}
    players = m["features"]["players"]

    def judge():
        athena = scoring.judge_athena(scene, words)
        return {
            "athena": athena,
            "apollo": scoring.judge_apollo(scene, contours, athena, has_times),
            "ares": scoring.judge_ares(scene, assignments, players),
            "aphrodite": scoring.judge_aphrodite(scene, assignments, players),
        }

    judges = await run_in_threadpool(judge)
    overall = scoring.total(judges)

    # --- per-player stars
    names = [p.get("name") or f"Player {i + 1}" for i, p in enumerate(m.get("players", []))]
    stars = []
    for pi, name in enumerate(names):
        chars = [c for c, p in assignments.items() if p == pi]
        lines = [l["accuracy"] for l in judges["athena"]["lines"] if l["character"] in chars]
        body = [judges["ares"]["per_character"].get(c, 0) for c in chars]
        face = [judges["aphrodite"]["per_character"].get(c, 0) for c in chars]
        parts = [sum(x) / len(x) for x in (lines, body, face) if x]
        stars.append({"name": name, "characters": chars,
                      "score": round(sum(parts) / len(parts)) if parts else 0})

    cast = ", ".join(f"{s['name']} as {'/'.join(_char_name(scene, c) for c in s['characters'])}" for s in stars)
    words_said = await oracle.verdict(scene, m.get("team_name", "Nameless Crew"), cast, heard_text,
                                      judges, overall, frame_bytes)
    zeus_audio = await oracle.speak(words_said["zeus"])

    result = {
        "scene_id": scene["id"], "scene_title": scene["title"],
        "team_name": m.get("team_name") or "Nameless Crew", "team_size": len(names),
        **overall, "judges": judges, "stars": stars, "verdict": words_said,
        "transcript": heard_text, "stt_source": stt_source,
    }
    try:
        await run_in_threadpool(store.save_run, {
            k: result[k] for k in ("scene_id", "scene_title", "team_name", "team_size", "score", "kleos", "rank")
        } | {"epithet": words_said.get("epithet"),
             "judges": {k: v["score"] for k, v in judges.items()}})
    except Exception as e:  # noqa: BLE001
        log.warning("Could not save run: %s", e)
    result["zeus_audio"] = zeus_audio
    # --- save the take for calibration (tools/replay_takes.py); background thread, never fails a round
    try:
        import threading
        threading.Thread(target=takes.save_take, args=(m, audio_bytes, frame_bytes, result), daemon=True).start()
    except Exception as e:  # noqa: BLE001
        log.warning("Could not start take save: %s", e)
    return result


def _char_name(scene, cid):
    return next((c["name"] for c in scene["characters"] if c["id"] == cid), cid)


def _decode(audio_bytes: bytes):
    """Browser webm/opus -> 16 kHz mono PCM (None if empty or undecodable)."""
    if not audio_bytes:
        return None
    with tempfile.NamedTemporaryFile(suffix=".webm", delete=False) as f:
        f.write(audio_bytes)
        path = f.name
    try:
        return decode_audio(path)
    except Exception as e:  # noqa: BLE001
        log.warning("Audio decode failed: %s", e)
        return None
    finally:
        os.unlink(path)


def _contours(pcm) -> dict:
    if pcm is None or len(pcm) == 0:
        return {"pitch": [], "energy": []}
    try:
        return audio_contours(pcm)
    except Exception as e:  # noqa: BLE001
        log.warning("Audio contour extraction failed: %s", e)
        return {"pitch": [], "energy": []}


# Serve the built frontend (npm run build) so the demo runs from one port.
_DIST = ROOT / "frontend" / "dist"
if _DIST.exists():
    app.mount("/", StaticFiles(directory=_DIST, html=True), name="ui")
