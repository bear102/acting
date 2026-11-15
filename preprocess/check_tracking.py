"""Draw each scene's tracked reference skeleton on sample frames, to eyeball who is being tracked.

Usage: python preprocess/check_tracking.py <out.jpg> <scene_id>:<t> [<scene_id>:<t> ...]
"""
import json
import sys
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
BONES = [(1, 2), (1, 3), (3, 5), (2, 4), (4, 6)]
tiles = []
for spec in sys.argv[2:]:
    sid, t = spec.split(":")
    t = float(t)
    scene = json.loads((ROOT / "scenes" / f"{sid}.json").read_text(encoding="utf-8"))
    ref = scene["reference"]
    k = int(round(t * ref["fps"]))
    cap = cv2.VideoCapture(str(ROOT / "scenes" / scene["video"]))
    cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
    ok, f = cap.read()
    h, w = f.shape[:2]
    label = f"{sid} t={t}"
    for ci, (cid, track) in enumerate(ref["pose"].items()):
        fr = track[k] if k < len(track) else None
        if not fr:
            continue
        pts = [(int(fr[i * 3] * w), int(fr[i * 3 + 1] * h)) for i in range(7)]
        col = [(0, 220, 255), (255, 200, 60)][ci % 2]
        for a, b in BONES:
            cv2.line(f, pts[a], pts[b], col, 4)
        cv2.circle(f, pts[0], 10, col, -1)
        cv2.putText(f, cid, (pts[0][0] + 12, pts[0][1] - 12), 0, 1.0, col, 3)
        label += f" [{cid}]"
    cv2.putText(f, label, (10, 30), 0, 0.8, (255, 255, 255), 2)
    tiles.append(cv2.resize(f, (640, 360)))
while len(tiles) % 3:
    tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(sys.argv[1], np.vstack([np.hstack(tiles[i:i + 3]) for i in range(0, len(tiles), 3)]))
