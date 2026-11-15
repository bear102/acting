"""Film stills for side-by-side judging: the frame of the clip at each moment we snapshotted the players.

Frames are cached on disk per (scene, time rounded to 0.1s) under backend/data/frame_cache/
(backend/data/ is gitignored), so repeat takes of the same scene cost nothing.
"""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

from features import ffmpeg_exe

log = logging.getLogger("film_frames")

CACHE_DIR = Path(__file__).resolve().parent / "data" / "frame_cache"
DEFAULT_FRACTIONS = [0.2, 0.45, 0.7, 0.9]


def snapshot_times(meta: dict, scene: dict, n_frames: int) -> list[float]:
    """Seconds since take start for each uploaded player frame (same order as the uploads)."""
    times = meta.get("snapshot_times")
    if isinstance(times, list) and times:
        out = []
        for t in times[:n_frames]:
            try:
                out.append(max(0.0, float(t)))
            except (TypeError, ValueError):
                out.append(0.0)
        if len(out) == n_frames:
            return out
    dur = float(scene.get("duration") or 0)
    return [round(f * dur, 2) for f in DEFAULT_FRACTIONS][:n_frames]


def film_frame(scene: dict, video_path: Path, t: float) -> bytes | None:
    """JPEG (640px wide) of the clip at time t, or None if it can't be extracted."""
    t = round(max(0.0, min(t, float(scene.get("duration") or t) - 0.05)), 1)
    cache = CACHE_DIR / scene["id"] / f"{t:.1f}.jpg"
    if cache.exists() and cache.stat().st_size > 0:
        return cache.read_bytes()
    try:
        cache.parent.mkdir(parents=True, exist_ok=True)
        proc = subprocess.run(
            [ffmpeg_exe(), "-v", "error", "-y", "-ss", f"{t:.2f}", "-i", str(video_path),
             "-frames:v", "1", "-vf", "scale=640:-2", "-q:v", "4", "-f", "image2", "-c:v", "mjpeg", "-"],
            capture_output=True, check=True, timeout=20,
        )
        if not proc.stdout:
            return None
        cache.write_bytes(proc.stdout)
        return proc.stdout
    except Exception as e:  # noqa: BLE001
        log.warning("Film frame %s@%.1fs failed: %s", scene.get("id"), t, e)
        return None


def on_screen(scene: dict, t: float) -> tuple[str | None, str | None]:
    """(character id on screen per reference.shots, line being spoken) at time t."""
    shots = (scene.get("reference") or {}).get("shots") or []
    char = next((s.get("character") for s in shots if s["start"] <= t < s["end"]), None)
    line = next((l for l in scene["lines"] if l["start"] - 0.3 <= t <= l["end"] + 0.5), None)
    spoken = f'{line["character"]}: "{line["text"]}"' if line else None
    return char, spoken


def film_pairs(scene: dict, scenes_dir: Path, times: list[float]) -> list[dict]:
    """[{t, film: bytes|None, character, line}] for each snapshot time. Empty if the scene has no video."""
    if not scene.get("video"):
        return []
    video = scenes_dir / scene["video"]
    if not video.exists():
        return []
    out = []
    for t in times:
        char, line = on_screen(scene, t)
        out.append({"t": t, "film": film_frame(scene, video, t), "character": char, "line": line})
    return out
