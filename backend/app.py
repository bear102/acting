"""Trials of Odysseus - API server.

Run:  ..\\.venv\\Scripts\\uvicorn app:app --reload --port 8000   (from backend/)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
load_dotenv(ROOT / ".env")

import film_frames  # noqa: E402
import oracle  # noqa: E402
import reel  # noqa: E402
import scoring  # noqa: E402
import store  # noqa: E402
import takes  # noqa: E402  (saves every take for offline re-scoring)
import video_analysis  # noqa: E402  (server-side MediaPipe on the recorded take)
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
    # Spin up the pose-analysis worker processes (MediaPipe import ~2-3 s each) in the background.
    import threading as _th
    _th.Thread(target=video_analysis.warm_pool, daemon=True).start()


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


@app.get("/api/scenes/{scene_id}/frame")
def get_film_frame(scene_id: str, t: float = 0.0):
    """A still of the film at time t, shown next to the players' own snapshot on the verdict reel."""
    s = load_scenes().get(scene_id)
    if not s or not s.get("video"):
        raise HTTPException(404, "No film for this scene")
    jpg = film_frames.film_frame(s, SCENES_DIR / s["video"], t)
    if not jpg:
        raise HTTPException(404, "No frame at that time")
    return Response(jpg, media_type="image/jpeg", headers={"Cache-Control": "max-age=86400"})


@app.get("/api/leaderboard")
def get_leaderboard(scene_id: str | None = None):
    return store.leaderboard(scene_id)


@app.post("/api/perform")
async def perform(meta: str = Form(...), audio: UploadFile | None = File(None),
                  frames: list[UploadFile] = File(default=[]), video: UploadFile | None = File(None)):
    m = json.loads(meta)
    scene = load_scenes().get(m["scene_id"])
    if not scene:
        raise HTTPException(404, "No such scene")

    audio_bytes = await audio.read() if audio else b""
    frame_bytes = [await f.read() for f in frames]
    video_bytes = await video.read() if video else b""
    # Full-model pose + face analysis of the recorded webcam, concurrently with STT and judging prep.
    video_task = asyncio.ensure_future(run_in_threadpool(_analyze_video, video_bytes, m)) if video_bytes else None

    # Film stills at the moments the players were snapshotted, for Gemini's side-by-side critique.
    # Extracted (or read from cache) in the background while we transcribe and judge.
    times = film_frames.snapshot_times(m, scene, len(frame_bytes))
    film_task = asyncio.ensure_future(run_in_threadpool(film_frames.film_pairs, scene, SCENES_DIR, times))

    pcm = await run_in_threadpool(_decode, audio_bytes)
    assignments = {c: int(p) for c, p in m["assignments"].items()}

    # Everything that doesn't need the transcript runs WHILE speech-to-text is in flight:
    # voice contours, and (once the pose/face features are chosen: server video analysis or the
    # browser's live samples) the body/face judges. These used to wait behind the STT call.
    contours_task = asyncio.ensure_future(run_in_threadpool(_contours, pcm))

    async def body_and_face():
        chosen, tracking_info = await _choose_features(video_task, m)
        ares_, aphrodite_ = await run_in_threadpool(
            lambda: (scoring.judge_ares(scene, assignments, chosen),
                     scoring.judge_aphrodite(scene, assignments, chosen)))
        return chosen, tracking_info, ares_, aphrodite_

    body_task = asyncio.ensure_future(body_and_face())

    # --- ears: ElevenLabs Scribe -> local Whisper -> the browser's own speech recognition
    words = await oracle.transcribe(audio_bytes, audio.filename if audio else "take.webm",
                                    keyterms=scene_keyterms(scene))
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

    # --- the four judges (CPU-bound, off the event loop); Ares/Aphrodite already ran during STT
    contours = await contours_task
    players, tracking, ares, aphrodite = await body_task

    def judge():
        athena = scoring.judge_athena(scene, words)
        return {
            "athena": athena,
            "apollo": scoring.judge_apollo(scene, contours, athena, has_times),
            "ares": ares,
            "aphrodite": aphrodite,
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
    try:
        pairs = await film_task
    except Exception as e:  # noqa: BLE001
        log.warning("Film frame extraction failed: %s", e)
        pairs = []
    # --- the reel: per-line beats, laurels, crew epithets and awards (presentation only, no new points)
    the_reel = reel.build(scene, judges, assignments, stars, overall)
    words_said = await oracle.verdict(scene, m.get("team_name", "Nameless Crew"), cast, heard_text,
                                      judges, overall, frame_bytes, pairs, reel.highlights(the_reel))
    critic = words_said.pop("critic", None)
    if critic:
        overall = apply_critic(overall, critic)
        the_reel["voyage"] = reel.voyage(overall)

    result = {
        "scene_id": scene["id"], "scene_title": scene["title"],
        "team_name": m.get("team_name") or "Nameless Crew", "team_size": len(names),
        **overall, "judges": judges, "stars": stars, "verdict": words_said,
        "transcript": heard_text, "stt_source": stt_source, "critic": critic,
        "reel": the_reel, "hall": None, "tracking": tracking,
    }
    run = {k: result[k] for k in ("scene_id", "scene_title", "team_name", "team_size", "score", "kleos", "rank")} | {
        "epithet": words_said.get("epithet"), "judges": {k: v["score"] for k, v in judges.items()}}
    try:
        await run_in_threadpool(store.save_run, run)
        rows = await run_in_threadpool(store.leaderboard, scene["id"], 500)
        result["hall"] = reel.hall_place(rows, result["kleos"], result["team_name"])
    except Exception as e:  # noqa: BLE001
        log.warning("Could not save run: %s", e)
    # --- save the take for calibration (tools/replay_takes.py); background thread, never fails a round
    try:
        import threading
        threading.Thread(target=takes.save_take, args=(m, audio_bytes, frame_bytes, result, video_bytes), daemon=True).start()
    except Exception as e:  # noqa: BLE001
        log.warning("Could not start take save: %s", e)
    return result


_COMMON = {
    "this", "that", "with", "from", "have", "your", "what", "will", "then", "they", "them", "there",
    "their", "when", "were", "been", "into", "only", "over", "very", "which", "would", "could",
    "should", "about", "after", "before", "because", "these", "those", "some", "every", "never",
    "here", "come", "came", "until", "while", "shall", "upon", "made", "much", "more", "most",
}


def scene_keyterms(scene: dict, limit: int = 100) -> list[str]:
    """Bias Scribe toward this scene's script: character names, then distinctive words (4+ letters).

    Sanitized to letters/digits/spaces/apostrophes/hyphens, de-duplicated (case-insensitive), capped.
    """
    out, seen = [], set()

    def add(term: str) -> None:
        t = re.sub(r"[^A-Za-z0-9' -]", "", term).strip(" '-")
        k = t.lower()
        if t and k not in seen and len(out) < limit:
            seen.add(k)
            out.append(t)

    for c in scene.get("characters", []):
        add(c.get("name", ""))
        add(c.get("id", "").replace("-", " "))
    for line in scene.get("lines", []):
        for w in line.get("text", "").split():
            w = re.sub(r"[^A-Za-z0-9'-]", "", w).strip("'-")
            if len(w) >= 4 and w.lower() not in _COMMON:
                add(w)
    return out


def apply_critic(overall: dict, critic: dict) -> dict:
    """Gemini's side-by-side acting critique as a small 5th component:
    score = 0.9 * judges' total + 0.1 * (mean acting 0-10 scaled to 0-100) + muse_bonus, clamped 0-100."""
    marks = [v["score"] for v in critic["acting"].values()]
    acting100 = 10 * sum(marks) / len(marks)
    raw = 0.9 * overall["score"] + 0.1 * acting100 + critic["muse_bonus"]
    raw = max(0.0, min(100.0, raw))
    rank = next(name for floor, name in scoring.RANKS if raw >= floor)
    critic["base_score"] = overall["score"]
    return {**overall, "score": round(raw), "kleos": round(raw * 10), "rank": rank}


def _take_duration(m: dict) -> float:
    if m.get("duration"):
        return float(m["duration"])
    players = (m.get("features") or {}).get("players") or [{}]
    return len(players[0].get("pose") or []) / 10 or 1.0


def _analyze_video(video_bytes: bytes, m: dict) -> dict:
    n = max(1, len(m.get("players") or []) or len((m.get("features") or {}).get("players", [])) or 1)
    return video_analysis.analyze_take_video(
        video_bytes, n, _take_duration(m), float(m.get("video_offset_s") or 0.0), bool(m.get("video_mirrored")))


async def _choose_features(video_task, m: dict) -> tuple[list, dict]:
    """Server analysis of the recorded video when it is usable, else the browser's live samples."""
    client = (m.get("features") or {}).get("players") or []
    if video_task is None:
        return client, {"source": "client", "reason": "no video uploaded"}
    try:
        res = await video_task
    except Exception as e:  # noqa: BLE001
        log.warning("Video analysis failed, using browser features: %s", e)
        return client, {"source": "client", "reason": f"analysis failed: {e}"}
    ok, why = video_analysis.usable(res["stats"])
    if ok or not client:
        return res["features"]["players"], {"source": "server", **res["stats"]}
    log.info("Server tracking not usable (%s); using browser features", why)
    return client, {"source": "client", "reason": why, **res["stats"]}


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
