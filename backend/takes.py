"""Save every performance so scoring can be re-run on REAL takes after each tuning change.

Layout: backend/data/takes/<UTC timestamp>_<scene_id>_<team-slug>/
    meta.json     full request meta (incl. 10 Hz pose/face features, browser transcript)
    audio.webm    the mic recording
    frame_<i>.jpg snapshots sent to Gemini
    result.json   the score the game showed (without the Zeus mp3)
    label         optional, written by the team: "missed everything", "good", ...

Disable with SAVE_TAKES=0. Never raises: a failed save must not break a round.
"""
from __future__ import annotations

import json
import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("takes")
TAKES_DIR = Path(__file__).resolve().parent / "data" / "takes"


def enabled() -> bool:
    return os.getenv("SAVE_TAKES", "1").strip().lower() not in ("0", "false", "no", "off")


def _slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")[:32] or "crew"


def save_take(meta: dict, audio: bytes, frames: list[bytes], result: dict) -> Path | None:
    if not enabled():
        return None
    try:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S_%fZ")
        folder = TAKES_DIR / f"{stamp}_{_slug(meta.get('scene_id', 'scene'))}_{_slug(meta.get('team_name', ''))}"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
        if audio:
            (folder / "audio.webm").write_bytes(audio)
        for i, f in enumerate(frames):
            (folder / f"frame_{i}.jpg").write_bytes(f)
        slim = {k: v for k, v in result.items() if k != "zeus_audio"}
        (folder / "result.json").write_text(json.dumps(slim, indent=1), encoding="utf-8")
        return folder
    except Exception as e:  # noqa: BLE001
        log.warning("Could not save take: %s", e)
        return None


def set_label(folder: Path, text: str) -> None:
    (Path(folder) / "label").write_text(text.strip() + "\n", encoding="utf-8")


def get_label(folder: Path) -> str:
    p = Path(folder) / "label"
    return p.read_text(encoding="utf-8").strip() if p.exists() else ""


def list_takes(scene_id: str | None = None) -> list[Path]:
    if not TAKES_DIR.exists():
        return []
    out = sorted(p for p in TAKES_DIR.iterdir() if (p / "meta.json").exists())
    if scene_id:
        out = [p for p in out if json.loads((p / "meta.json").read_text(encoding="utf-8")).get("scene_id") == scene_id]
    return out
