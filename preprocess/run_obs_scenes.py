"""Run preprocess_scene.py for every scene in the OBS plan (see build_obs_scenes.py).

Usage: python preprocess/run_obs_scenes.py <scratch dir> <dir holding the two OBS recordings>
"""
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SC, SRC = Path(sys.argv[1]), Path(sys.argv[2])
REC = {"A": SRC / "2026-11-15 00-16-22.mp4", "B": SRC / "2026-11-15 00-21-41.mp4"}
only = set(sys.argv[3:])
for s in json.loads((SC / "obs_plan.json").read_text()):
    if only and s["id"] not in only:
        continue
    print(f"\n######## {s['id']}", flush=True)
    subprocess.run([sys.executable, str(ROOT / "preprocess/preprocess_scene.py"),
                    "--scene", str(ROOT / "scenes" / f"{s['id']}.json"), "--video", str(REC[s["rec"]]),
                    "--start", str(s["start"]), "--end", str(s["end"]), "--brighten",
                    "--shots-file", str(ROOT / "preprocess/shots" / f"{s['id']}.json")],
                   check=True, cwd=ROOT)
