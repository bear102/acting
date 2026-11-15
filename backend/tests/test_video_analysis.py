"""Server-side analysis of the recorded take video.

Run:  .venv\\Scripts\\python backend\\tests\\test_video_analysis.py
Needs scenes/media/beggar-in-the-hall.mp4 (gitignored film clip); skips otherwise.

Synthetic "webcams" are built from the film clip with the bundled ffmpeg:
  * take_mirror.webm : the film flipped horizontally (= a raw camera of someone imitating the film
                       perfectly, since the stage shows the camera mirrored), 640x360 VP8
  * take_film.webm   : the film un-flipped (to check the mirroring round trip)
  * take_empty.webm  : a test pattern with nobody in it
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("GLOG_minloglevel", "2")
os.environ["SAVE_TAKES"] = "0"
os.environ["GEMINI_API_KEY"] = ""
os.environ["GOOGLE_API_KEY"] = ""

CLIP = ROOT / "scenes" / "media" / "beggar-in-the-hall.mp4"
failures: list[str] = []


def check(cond: bool, label: str) -> None:
    print(("[PASS] " if cond else "[FAIL] ") + label, flush=True)
    if not cond:
        failures.append(label)


def ff(*args: str) -> None:
    from features import ffmpeg_exe

    subprocess.run([ffmpeg_exe(), "-v", "error", "-y", *args], check=True)


def make_videos(tmp: Path) -> dict[str, Path]:
    vp8 = ["-an", "-c:v", "libvpx", "-b:v", "1M", "-deadline", "realtime", "-cpu-used", "8"]
    out = {"mirror": tmp / "take_mirror.webm", "film": tmp / "take_film.webm", "empty": tmp / "take_empty.webm"}
    ff("-i", str(CLIP), "-vf", "hflip,scale=640:360,fps=24", *vp8, str(out["mirror"]))
    ff("-i", str(CLIP), "-vf", "scale=640:360,fps=24", *vp8, str(out["film"]))
    ff("-f", "lavfi", "-i", "testsrc=size=640x360:rate=24", "-t", "6", *vp8, str(out["empty"]))
    return out


def perform(client, meta: dict, video: bytes | None, audio: bytes | None = None) -> dict:
    files = []
    if audio:
        files.append(("audio", ("take.webm", audio, "audio/webm")))
    if video is not None:
        files.append(("video", ("take-video.webm", video, "video/webm")))
    r = client.post("/api/perform", data={"meta": json.dumps(meta)}, files=files or None)
    assert r.status_code == 200, r.text[:300]
    return r.json()


def _person(cx: float, cy: float, w: float, arm: float = 0.0):
    """7x3 raw-camera landmarks for a body whose DISPLAYED shoulder centre is (cx, cy)."""
    import numpy as np

    x = 1 - cx  # raw camera x (the stage mirrors it)
    return np.array([[x, cy - w * 0.9, 1], [x + w / 2, cy, 1], [x - w / 2, cy, 1],
                     [x + w * 0.7, cy + w, 1], [x - w * 0.7, cy + w, 1],
                     [x + w * 0.8, cy + 2 * w - arm, 1], [x - w * 0.8, cy + 2 * w, 1]], float)


def tracker_checks(va) -> None:
    import random

    aspect = 16 / 9
    rnd = random.Random(7)
    poses, faces, truth = [], [], []
    for k in range(70):
        bx = 0.5
        f = min(1.0, max(0.0, (k - 35) / 20))  # frames 35-55: A and C swap places and stay there
        ax, cx = 0.22 + 0.56 * f, 0.78 - 0.56 * f  # (A walks right, C walks left; A nearer the camera)
        people = [("A", _person(ax, 0.42, 0.13)), ("C", _person(cx, 0.40, 0.10))]
        if not 25 <= k <= 29:  # B drops out for 0.5 s
            people.append(("B", _person(bx, 0.41, 0.11, arm=0.05 * (k % 4))))
        dets = [p for _, p in people]
        if k == 20:  # duplicate detection of A
            dets.append(_person(ax + 0.01, 0.425, 0.125))
        if k == 60:  # a small bystander far behind
            dets.append(_person(0.6, 0.3, 0.03))
        rnd.shuffle(dets)
        poses.append(dets)
        faces.append([(p[0][:2].copy(), [0.1 * "ABC".index(n)] * 21) for n, p in people])
        truth.append({n: (1 - p[1][0] + 1 - p[2][0]) / 2 for n, p in people})
    out_pose, out_face, observed = va._track(poses, faces, 3, aspect, False)
    order = va._player_order(out_pose, observed, 3, aspect, False)

    def disp_x(f):
        return (1 - f[1][0] + 1 - f[2][0]) / 2

    who = {}
    for rank, slot in enumerate(order):
        x = disp_x(out_pose[5][slot])
        who[rank] = min(truth[5], key=lambda n: abs(truth[5][n] - x))
    check(who == {0: "A", 1: "B", 2: "C"}, f"3 players numbered screen-left to right at the start ({who})")
    wrong = 0
    for k in range(70):
        for rank, name in who.items():
            f = out_pose[k][order[rank]]
            if f is not None and name in truth[k]:
                wrong += abs(disp_x(f) - truth[k][name]) > 0.05
    check(wrong == 0, f"identities survive A/C crossing, a duplicate and a bystander ({wrong} wrong frames)")
    held = [out_pose[k][order[1]] is not None for k in range(25, 30)]
    check(held[:4] == [True] * 4 and not held[4], f"B held 0.4 s during a 0.5 s dropout, then released ({held})")
    check(all(out_pose[k][order[1]] is not None for k in range(31, 35)), "B re-acquired into the same slot")
    fa = [out_face[k][order[0]] for k in range(5, 25)]
    check(all(f is not None and abs(f[0]) < 1e-9 for f in fa), "faces follow their own player (by nose)")


def main() -> int:
    if not CLIP.exists():
        print(f"SKIP: {CLIP} missing")
        return 0
    import video_analysis as va
    from features import FEATURE_FPS
    import scoring

    scene = json.loads((ROOT / "scenes" / "beggar-in-the-hall.json").read_text(encoding="utf-8"))
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        vids = make_videos(tmp)

        # 1) single player imitating the film: shape, timing, accuracy
        t0 = time.perf_counter()
        r = va.analyze_take_video(vids["mirror"].read_bytes(), 1, scene["duration"])
        secs = time.perf_counter() - t0
        st, feats = r["stats"], r["features"]
        L = -(-int(round(scene["duration"] * 100)) // 10)
        print("   stats:", st)
        check(feats["fps"] == FEATURE_FPS and len(feats["players"]) == 1, "features shape: fps 10, one player")
        check(all(len(feats["players"][0][k]) == L for k in ("pose", "face")), f"tracks are ceil(duration*10) = {L} long")
        frame = next(f for f in feats["players"][0]["pose"] if f)
        check(len(frame) == 21 and 0 <= frame[0] <= 1 and 0 <= frame[2] <= 1, "pose frames are 21 floats [x, y, vis]")
        face = next((f for f in feats["players"][0]["face"] if f), None)
        check(face is not None and len(face) == 21, "face frames are 21 blendshapes")
        check(st["coverage"][0] > 0.6, f"body coverage on the film {st['coverage'][0]:.0%} > 60%")
        print(f"   analysis took {secs:.2f}s for a {scene['duration']}s take ({st.get('workers')} workers, "
              f"pose {st.get('pose_fps')} Hz)")
        check(secs < 20, "analysis time sane (< 20 s even on a busy, shared laptop)")

        # Mirror round trip on Penelope's shot (2.4-4.2 s: bright, one person, full figure): the
        # un-flipped film analysed as "already displayed" (mirrored=True) must give the same
        # displayed-coordinate track as the flipped "raw camera" (mirrored=False).
        from features import normalize_pose_frame, pose_frame_distance

        film = va.analyze_take_video(vids["film"].read_bytes(), 1, scene["duration"], mirrored=True)
        fp = film["features"]["players"][0]["pose"]
        mine = feats["players"][0]["pose"]
        pairs = [(fp[k], mine[k]) for k in range(24, 42) if fp[k] and mine[k]]
        d = sorted(v for v in (pose_frame_distance(normalize_pose_frame(x), normalize_pose_frame(y)) for x, y in pairs)
                   if v is not None)
        med = d[len(d) // 2] if d else 9.0
        check(len(d) >= 8 and med < 0.2, f"flipped camera == displayed film after mirroring (median {med:.3f} sw, {len(d)} frames)")
        nose_dx = sorted(abs(x[0] - y[0]) for x, y in pairs)
        check(bool(nose_dx) and nose_dx[len(nose_dx) // 2] < 0.02, "nose x agrees in displayed coordinates (x' = 1 - x applied)")

        # Format/alignment check through the real judge: a reference built (per shot, like
        # preprocessing) from this very analysis must score the track as a near-perfect imitation,
        # and a statue must score far lower.
        ref_scene = json.loads(json.dumps(scene))
        shots = scene["reference"]["shots"]
        ref_pose = {c["id"]: [None] * L for c in scene["characters"]}
        for k, f in enumerate(mine[:L]):
            shot = next((x for x in shots if x["start"] <= k / 10 < x["end"]), None)
            if f and shot and shot["character"]:
                ref_pose[shot["character"]][k] = f
        ref_scene["reference"]["pose"] = ref_pose
        assign = {c["id"]: 0 for c in scene["characters"]}
        ares = scoring.judge_ares(ref_scene, assign, feats["players"])
        still = next(f for f in mine if f)
        ares_still = scoring.judge_ares(ref_scene, assign, [{"pose": [still] * L, "face": [None] * L}])
        print("   ares imitation:", ares["score"], ares.get("per_character"), "| statue:", ares_still["score"])
        check(ares["score"] >= 80, f"server-tracked imitation scores Ares {ares['score']} >= 80 (format & timing line up)")
        check(ares_still["score"] < ares["score"] - 30, "a statue scores far below the imitation")

        # offset: video starting 1 s after take start shifts samples by 10
        r2 = va.analyze_take_video(vids["mirror"].read_bytes(), 1, scene["duration"], offset_s=1.0)
        b2 = r2["features"]["players"][0]["pose"]
        check(all(x is None for x in b2[:10]) and b2[30] == mine[20], "video_offset_s shifts samples onto take time")

        # 2) three players: the identity tracker on synthetic detections (MediaPipe's own multi-person
        #    detection quality can only be judged on real webcam footage)
        tracker_checks(va)

        # 3) API: server tracking used; corrupt / empty videos fall back to the browser's samples
        from fastapi.testclient import TestClient
        import app as A

        client_feats = {"fps": 10, "players": [{"pose": [None] * L, "face": [None] * L}]}
        meta = {"scene_id": scene["id"], "team_name": "VideoTest", "players": [{"name": "A"}],
                "assignments": assign, "duration": scene["duration"], "features": client_feats,
                "browser_transcript": [], "video_offset_s": 0.0, "video_mirrored": False}
        with TestClient(A.app) as c:
            res = perform(c, meta, vids["mirror"].read_bytes())
            check(res["tracking"]["source"] == "server", f"/api/perform uses server tracking ({res['tracking'].get('source')})")
            check(res["tracking"].get("coverage", [0])[0] > 0.6, f"API server tracking coverage {res['tracking'].get('coverage')}")

            res = perform(c, meta, b"this is not a video")
            check(res["tracking"]["source"] == "client", "corrupt video -> browser features")

            res = perform(c, meta, vids["empty"].read_bytes())
            check(res["tracking"]["source"] == "client", f"video with nobody in it -> browser features ({res['tracking'].get('reason')})")

            res = perform(c, meta, None)
            check(res["tracking"]["source"] == "client", "no video -> browser features (unchanged behaviour)")

    print(f"\n{'ALL PASSED' if not failures else f'{len(failures)} FAILED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
