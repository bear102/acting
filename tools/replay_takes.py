"""Re-score saved takes with the CURRENT scoring code, to check tuning against real performances.

Every round played is saved to backend/data/takes/ (see backend/takes.py). Label the ones you
know should score low or high, change scoring, then replay and compare.

  .venv\\Scripts\\python tools\\replay_takes.py                  # all takes
  .venv\\Scripts\\python tools\\replay_takes.py --last 5
  .venv\\Scripts\\python tools\\replay_takes.py --scene beggar-in-the-hall
  .venv\\Scripts\\python tools\\replay_takes.py <take folder> [...]
  .venv\\Scripts\\python tools\\replay_takes.py --json out.json
  .venv\\Scripts\\python tools\\replay_takes.py --list
  .venv\\Scripts\\python tools\\replay_takes.py --label <take folder or name> "missed everything"

Replays go through the real /api/perform endpoint (FastAPI TestClient), so speech-to-text,
audio contours, judges and totals run exactly as in the game. Replays are not saved as new takes.
Note: if Gemini is configured and adjusts the score, replays can differ slightly between runs.
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

os.environ["SAVE_TAKES"] = "0"  # before importing app: replays must not create takes
ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
os.chdir(ROOT / "backend")

import takes  # noqa: E402

JUDGES = ("athena", "apollo", "ares", "aphrodite")


def resolve(arg: str) -> Path:
    p = Path(arg)
    if p.exists():
        return p.resolve()
    p = takes.TAKES_DIR / arg
    if p.exists():
        return p
    matches = [t for t in takes.list_takes() if arg in t.name]
    if len(matches) == 1:
        return matches[0]
    sys.exit(f"Take not found (or ambiguous): {arg}")


def replay(client, folder: Path) -> dict:
    meta = json.loads((folder / "meta.json").read_text(encoding="utf-8"))
    files = []
    audio = folder / "audio.webm"
    if audio.exists():
        files.append(("audio", ("take.webm", audio.read_bytes(), "audio/webm")))
    video = folder / "video.webm"
    if video.exists():
        files.append(("video", ("take-video.webm", video.read_bytes(), "video/webm")))
    for f in sorted(folder.glob("frame_*.jpg"), key=lambda p: int(p.stem.split("_")[1])):
        files.append(("frames", (f.name, f.read_bytes(), "image/jpeg")))
    r = client.post("/api/perform", data={"meta": json.dumps(meta)}, files=files or None)
    r.raise_for_status()
    return r.json()


def judge_scores(result: dict) -> dict:
    j = result.get("judges", {})
    return {k: (j[k]["score"] if isinstance(j.get(k), dict) else j.get(k)) for k in JUDGES}


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("takes", nargs="*", help="take folders or (unique parts of) take names")
    ap.add_argument("--scene", help="only takes of this scene id")
    ap.add_argument("--last", type=int, help="only the N most recent takes")
    ap.add_argument("--json", type=Path, help="write full old/new results to this file")
    ap.add_argument("--list", action="store_true", help="list takes with labels and stop")
    ap.add_argument("--label", nargs=2, metavar=("TAKE", "TEXT"), help="label a take and stop")
    args = ap.parse_args()

    if args.label:
        folder = resolve(args.label[0])
        takes.set_label(folder, args.label[1])
        print(f"Labelled {folder.name}: {args.label[1]}")
        return

    folders = [resolve(t) for t in args.takes] if args.takes else takes.list_takes(args.scene)
    if args.last:
        folders = folders[-args.last:]
    if not folders:
        sys.exit(f"No takes found in {takes.TAKES_DIR}. Play a round first.")

    if args.list:
        for f in folders:
            old = json.loads((f / "result.json").read_text(encoding="utf-8")) if (f / "result.json").exists() else {}
            print(f"{f.name:60s} kleos {old.get('kleos', '?'):>4}  {takes.get_label(f)}")
        return

    logging.disable(logging.WARNING)
    from fastapi.testclient import TestClient

    import app as game

    rows, dump = [], []
    with TestClient(game.app) as client:
        for f in folders:
            old = json.loads((f / "result.json").read_text(encoding="utf-8")) if (f / "result.json").exists() else {}
            try:
                new = replay(client, f)
            except Exception as e:  # noqa: BLE001
                print(f"! {f.name}: replay failed: {e}")
                continue
            new.pop("zeus_audio", None)
            o, n = judge_scores(old), judge_scores(new)
            rows.append((f.name, takes.get_label(f), old.get("kleos"), new.get("kleos"),
                         {k: (o.get(k), n.get(k)) for k in JUDGES}, new.get("transcript", "")))
            dump.append({"take": f.name, "label": takes.get_label(f), "old": old, "new": new})

    print()
    head = f"{'take':44s} {'label':18s} {'kleos':>11s}  " + "  ".join(f"{k[:6]:>9s}" for k in JUDGES) + "  heard"
    print(head)
    print("-" * len(head))
    for name, label, ok, nk, js, heard in rows:
        kleos = f"{ok if ok is not None else '-':>4}->{nk:<4}"
        jcols = "  ".join(f"{str(a if a is not None else '-'):>3}->{str(b):<4}" for a, b in js.values())
        print(f"{name[:44]:44s} {label[:18]:18s} {kleos:>11s}  {jcols}  {heard[:40]!r}")
    if args.json:
        args.json.write_text(json.dumps(dump, indent=1), encoding="utf-8")
        print(f"\nWrote {args.json}")


if __name__ == "__main__":
    main()
