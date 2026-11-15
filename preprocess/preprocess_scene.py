"""Turn a film clip into a playable scene with reference data.

Example (Cyclops scene from the film, actors left->right on screen are Odysseus then Polyphemus):

  .venv\\Scripts\\python preprocess\\preprocess_scene.py ^
      --scene scenes\\my-name-is-noman.json --video "D:\\clips\\odyssey.mp4" ^
      --start 3601.5 --end 3650 --order odysseus polyphemus --retime

What it does:
  1. cuts [start, end] of the source into scenes/media/<scene id>.mp4 (gitignored)
  2. runs MediaPipe Pose + Face Landmarker at 10 fps -> per-character skeleton + blendshape tracks
  3. extracts pitch/energy contours from the clip audio
  4. (--retime) transcribes the clip with ElevenLabs Scribe and snaps each script line's
     start/end to when it is actually spoken, so the teleprompter matches the film
  5. writes everything back into the scene JSON
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from features import (  # noqa: E402
    BLENDSHAPES, FEATURE_FPS, POSE_INDICES, audio_contours, decode_audio, ffmpeg_exe,
)

MODELS = ROOT / "frontend" / "public" / "mediapipe" / "models"


def cut_clip(src: Path, dst: Path, start: float | None, end: float | None) -> None:
    cmd = [ffmpeg_exe(), "-v", "error", "-y"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src)]
    if end is not None:
        cmd += ["-t", f"{end - (start or 0):.3f}"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-vf", "scale=-2:720",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dst)]
    subprocess.run(cmd, check=True)


def track_video(path: Path, n_people: int) -> tuple[list[list], list[list], float]:
    """Return (pose_tracks, face_tracks, duration); tracks indexed by screen position left->right."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODELS / "pose_landmarker_lite.task")),
        running_mode=vision.RunningMode.VIDEO, num_poses=n_people))
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO, num_faces=n_people, output_face_blendshapes=True))

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total / fps
    poses = [[] for _ in range(n_people)]
    faces = [[] for _ in range(n_people)]
    last_x = [(i + 0.5) / n_people for i in range(n_people)]

    k = 0
    while True:
        t = k / FEATURE_FPS
        if t >= duration:
            break
        cap.set(cv2.CAP_PROP_POS_MSEC, t * 1000)
        ok, frame = cap.read()
        if not ok:
            break
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        ts = int(t * 1000)
        pr = pose.detect_for_video(img, ts)
        fr = face.detect_for_video(img, ts)

        # assign people to screen slots (left->right), sticky across frames
        people = pr.pose_landmarks or []
        cx = [(p[11].x + p[12].x) / 2 for p in people]
        slots = [None] * n_people
        if len(people) == n_people:
            for slot, i in enumerate(sorted(range(len(people)), key=lambda i: cx[i])):
                slots[slot] = people[i]
        else:
            taken = set()
            for i, p in enumerate(people):
                cand = [(abs(last_x[s] - cx[i]), s) for s in range(n_people) if s not in taken]
                if cand:
                    _, s = min(cand)
                    taken.add(s)
                    slots[s] = p
        for s, p in enumerate(slots):
            if p is not None:
                last_x[s] = 0.3 * last_x[s] + 0.7 * (p[11].x + p[12].x) / 2
            poses[s].append(None if p is None else
                            [round(v, 3) for i in POSE_INDICES for v in (p[i].x, p[i].y)])

        fslots = [None] * n_people
        taken = set()
        for fi, fl in enumerate(fr.face_landmarks or []):
            fx = fl[1].x
            cand = []
            for s in range(n_people):
                px = slots[s][0].x if slots[s] is not None else last_x[s]
                if s not in taken:
                    cand.append((abs(px - fx), s))
            if cand:
                d, s = min(cand)
                if d < 0.25:
                    taken.add(s)
                    by = {c.category_name: c.score for c in fr.face_blendshapes[fi]}
                    fslots[s] = [round(by.get(n, 0.0), 3) for n in BLENDSHAPES]
        for s in range(n_people):
            faces[s].append(fslots[s])
        k += 1
        if k % 50 == 0:
            print(f"  tracked {t:.0f}s / {duration:.0f}s", flush=True)
    cap.release()
    return poses, faces, duration


def retime_lines(scene: dict, clip: Path) -> None:
    import httpx
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        print("  ! ELEVENLABS_API_KEY missing; keeping existing line timings")
        return
    with open(clip, "rb") as f:
        r = httpx.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": key},
                       data={"model_id": os.getenv("ELEVENLABS_STT_MODEL", "scribe_v1"), "language_code": "en"},
                       files={"file": (clip.name, f, "video/mp4")}, timeout=300)
    r.raise_for_status()
    heard = [w for w in r.json().get("words", []) if w.get("type", "word") == "word"]
    norm = lambda w: "".join(ch for ch in w.lower() if ch.isalnum())  # noqa: E731
    hw = [norm(w["text"]) for w in heard]
    script, owner = [], []
    for li, line in enumerate(scene["lines"]):
        for w in line["text"].split():
            script.append(norm(w))
            owner.append(li)
    hits: dict[int, list[int]] = {}
    for b in SequenceMatcher(None, script, hw, autojunk=False).get_matching_blocks():
        for k in range(b.size):
            hits.setdefault(owner[b.a + k], []).append(b.b + k)
    for li, line in enumerate(scene["lines"]):
        if li in hits:
            line["start"] = round(heard[min(hits[li])]["start"], 2)
            line["end"] = round(heard[max(hits[li])]["end"], 2)
            print(f"  line {li + 1}: {line['start']:.1f}-{line['end']:.1f}s")
        else:
            print(f"  line {li + 1}: NOT FOUND in clip audio, timing unchanged")
    print("  heard:", " ".join(w["text"] for w in heard)[:300])


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene", required=True, type=Path, help="scene JSON to enrich (edit lines first)")
    ap.add_argument("--video", required=True, type=Path, help="source film / clip")
    ap.add_argument("--start", type=float, help="clip start in source, seconds")
    ap.add_argument("--end", type=float, help="clip end in source, seconds")
    ap.add_argument("--order", nargs="+", required=True,
                    help="character ids in left-to-right screen order")
    ap.add_argument("--retime", action="store_true", help="snap line timings to the clip's dialogue")
    args = ap.parse_args()

    scene = json.loads(args.scene.read_text(encoding="utf-8"))
    ids = {c["id"] for c in scene["characters"]}
    bad = [o for o in args.order if o not in ids]
    if bad:
        sys.exit(f"Unknown character id(s) {bad}; scene has {sorted(ids)}")

    media = ROOT / "scenes" / "media"
    media.mkdir(parents=True, exist_ok=True)
    clip = media / f"{scene['id']}.mp4"
    print(f"1/4 cutting clip -> {clip}")
    cut_clip(args.video, clip, args.start, args.end)

    print("2/4 tracking bodies and faces")
    poses, faces, duration = track_video(clip, len(args.order))
    print("3/4 audio contours")
    audio = audio_contours(decode_audio(clip))

    if args.retime:
        print("4/4 retiming lines with ElevenLabs Scribe")
        retime_lines(scene, clip)
    else:
        print("4/4 (skipping retime)")

    scene["video"] = f"media/{clip.name}"
    scene["duration"] = round(max(duration, scene["lines"][-1]["end"] + 1), 1)
    scene["reference"] = {
        "fps": FEATURE_FPS,
        "pose": {cid: poses[i] for i, cid in enumerate(args.order)},
        "face": {cid: faces[i] for i, cid in enumerate(args.order)},
        "audio": audio,
    }
    args.scene.write_text(json.dumps(scene, indent=1), encoding="utf-8")
    cov = {cid: round(sum(p is not None for p in poses[i]) / max(1, len(poses[i])) * 100)
           for i, cid in enumerate(args.order)}
    print(f"Done. Pose coverage per character (%): {cov}")


if __name__ == "__main__":
    main()
