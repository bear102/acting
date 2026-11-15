"""Hall of Heroes (leaderboard). MongoDB Atlas when MONGODB_URI is set, else a local JSON file."""
from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timezone
from pathlib import Path

log = logging.getLogger("store")
_LOCAL = Path(__file__).resolve().parent / "data" / "runs.json"
_lock = threading.Lock()
_collection = None


def _mongo():
    global _collection
    if _collection is not None:
        return _collection
    uri = os.getenv("MONGODB_URI")
    if not uri:
        return None
    try:
        from pymongo import DESCENDING, MongoClient

        client = MongoClient(uri, serverSelectionTimeoutMS=4000)
        client.admin.command("ping")
        col = client[os.getenv("MONGODB_DB", "trials_of_odysseus")]["runs"]
        col.create_index([("kleos", DESCENDING)])
        col.create_index([("scene_id", 1), ("kleos", DESCENDING)])
        _collection = col
        return col
    except Exception as e:  # noqa: BLE001
        log.warning("MongoDB unavailable, using local file: %s", e)
        return None


def backend_name() -> str:
    return "mongodb" if _mongo() is not None else "local-file"


def save_run(run: dict) -> None:
    run = {**run, "created_at": datetime.now(timezone.utc).isoformat()}
    col = _mongo()
    if col is not None:
        col.insert_one(dict(run))
        return
    with _lock:
        _LOCAL.parent.mkdir(exist_ok=True)
        runs = json.loads(_LOCAL.read_text()) if _LOCAL.exists() else []
        runs.append(run)
        _LOCAL.write_text(json.dumps(runs, indent=1))


def leaderboard(scene_id: str | None = None, limit: int = 20) -> list[dict]:
    col = _mongo()
    if col is not None:
        q = {"scene_id": scene_id} if scene_id else {}
        return list(col.find(q, {"_id": 0}).sort("kleos", -1).limit(limit))
    if not _LOCAL.exists():
        return []
    runs = json.loads(_LOCAL.read_text())
    if scene_id:
        runs = [r for r in runs if r.get("scene_id") == scene_id]
    return sorted(runs, key=lambda r: r.get("kleos", 0), reverse=True)[:limit]


def best_by_scene() -> dict[str, dict]:
    """Voyage progress: each scene's best run {kleos, rank, team_name, plays}. Scenes never played are absent."""
    keep = ("kleos", "rank", "team_name")
    col = _mongo()
    if col is not None:
        out = {}
        for r in col.aggregate([{"$sort": {"kleos": -1}},
                                {"$group": {"_id": "$scene_id", "best": {"$first": "$$ROOT"}, "plays": {"$sum": 1}}}]):
            out[r["_id"]] = {k: r["best"].get(k) for k in keep} | {"plays": r["plays"]}
        return out
    if not _LOCAL.exists():
        return {}
    out: dict[str, dict] = {}
    for r in json.loads(_LOCAL.read_text()):
        sid = r.get("scene_id")
        if not sid:
            continue
        cur = out.get(sid)
        plays = (cur["plays"] if cur else 0) + 1
        if cur is None or r.get("kleos", 0) > cur["kleos"]:
            cur = {k: r.get(k) for k in keep} | {"kleos": r.get("kleos", 0)}
        out[sid] = cur | {"plays": plays}
    return out
