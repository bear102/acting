"""Turn a film clip into a playable scene with reference data.

Film clips cut between close-ups, so who's on screen is decided per SHOT, not by left/right position.
Typical workflow (two passes):

  1) Detect shots and get a template to fill in:
       .venv\\Scripts\\python preprocess\\preprocess_scene.py --scene scenes\\beggars.json ^
           --video "The Odyssey ... Clip.mp4" --title "Get These Beggars Out" ^
           --characters penelope:Penelope antinous:Antinous odysseus:Odysseus
     -> writes preprocess\\out\\<id>.shots.json and one thumbnail per shot in preprocess\\out\\shots_<id>\\
        Look at the thumbnails and put the character id (or null) into each shot.

  2) Build the reference:
       .venv\\Scripts\\python preprocess\\preprocess_scene.py --scene scenes\\beggars.json ^
           --video "The Odyssey ... Clip.mp4" --shots-file preprocess\\out\\<id>.shots.json ^
           --lines-from-transcript
     (or --shots "0-2.3:penelope,2.3-5.1:antinous,5.1-9.6:odysseus" inline)

  --lines-from-transcript  creates the script from the clip's dialogue (ElevenLabs Scribe if
                           ELEVENLABS_API_KEY is set, otherwise local Whisper small.en); the speaker is
                           guessed from the shot on screen at each line's midpoint. Review it!
  --retime                 keeps your hand-written lines but snaps their timings to the dialogue
                           (ElevenLabs Forced Alignment when keyed, else transcript matching).
  --retime-only            only re-time an existing scene against its existing clip; nothing else changes.
  --start/--end            cut a window out of a longer source first.

Output: scenes/media/<id>.mp4 (gitignored) and the scene JSON's `video`, `duration`, `lines` (if
generated) and `reference` = {fps, shots, pose, face, audio}. A character's pose/face frames are null
whenever they are not the one on screen.
"""
from __future__ import annotations

import argparse
import json
import os
import re
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
OUT = Path(__file__).resolve().parent / "out"
CUT_THRESHOLD = 0.35  # HSV histogram Bhattacharyya distance between consecutive frames
MIN_SHOT = 0.4        # seconds; cuts closer together than this are merged


# --------------------------------------------------------------------------- clip

BRIGHTEN = "eq=gamma=1.6:brightness=0.03:contrast=1.08:saturation=1.2"  # lifts dark film scenes


def cut_clip(src: Path, dst: Path, start: float | None, end: float | None, brighten: bool = False) -> None:
    cmd = [ffmpeg_exe(), "-v", "error", "-y"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(src)]
    if end is not None:
        cmd += ["-t", f"{end - (start or 0):.3f}"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "22", "-vf", "scale=-2:720" + ("," + BRIGHTEN if brighten else ""),
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(dst)]
    subprocess.run(cmd, check=True)


def detect_shots(path: Path) -> tuple[list[dict], float]:
    """Hard cuts via HSV histogram distance on every frame. -> ([{start, end, character: None}], duration)."""
    import cv2

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    prev, i, cuts = None, 0, [0.0]
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        hsv = cv2.cvtColor(cv2.resize(frame, (160, 90)), cv2.COLOR_BGR2HSV)
        h = cv2.calcHist([hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
        cv2.normalize(h, h)
        if prev is not None and cv2.compareHist(prev, h, cv2.HISTCMP_BHATTACHARYYA) > CUT_THRESHOLD:
            t = i / fps
            if t - cuts[-1] >= MIN_SHOT:
                cuts.append(t)
        prev = h
        i += 1
    cap.release()
    duration = i / fps
    bounds = cuts + [duration]
    return [{"start": round(a, 2), "end": round(b, 2), "character": None}
            for a, b in zip(bounds, bounds[1:])], duration


def write_shot_template(scene: dict, clip: Path, shots: list[dict]) -> Path:
    scene_id = scene["id"]
    import cv2

    thumbs = OUT / f"shots_{scene_id}"
    thumbs.mkdir(parents=True, exist_ok=True)
    for old in thumbs.glob("*.jpg"):
        old.unlink()
    cap = cv2.VideoCapture(str(clip))
    for k, s in enumerate(shots):
        cap.set(cv2.CAP_PROP_POS_MSEC, (s["start"] + s["end"]) / 2 * 1000)
        ok, frame = cap.read()
        if ok:
            frame = cv2.resize(frame, (640, int(640 * frame.shape[0] / frame.shape[1])))
            cv2.putText(frame, f"shot {k}: {s['start']:.1f}-{s['end']:.1f}s", (12, 34),
                        cv2.FONT_HERSHEY_SIMPLEX, 0.9, (0, 220, 255), 2)
            cv2.imwrite(str(thumbs / f"shot_{k:02d}_{s['start']:.1f}s.jpg"), frame)
    cap.release()
    tpl = OUT / f"{scene_id}.shots.json"
    # Carry the scene header along so pass 2 doesn't need --characters/--title again.
    header = {k: scene[k] for k in ("id", "title", "book", "blurb", "characters")}
    tpl.write_text(json.dumps({"scene": header, "shots": shots}, indent=1), encoding="utf-8")
    return tpl


def read_shots_file(path: Path) -> tuple[list[dict], dict | None]:
    """Accepts a bare list of shots or the template {"scene": {...}, "shots": [...]}."""
    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        return data, None
    return data["shots"], data.get("scene")


def parse_shots(arg: str) -> list[dict]:
    shots = []
    for part in arg.split(","):
        m = re.fullmatch(r"\s*([\d.]+)\s*-\s*([\d.]+)\s*:\s*([\w-]*)\s*", part)
        if not m:
            sys.exit(f"Bad --shots entry {part!r}; expected start-end:character")
        ch = m.group(3)
        shots.append({"start": float(m.group(1)), "end": float(m.group(2)),
                      "character": None if ch in ("", "none", "null", "-") else ch})
    return shots


def shot_at(shots: list[dict], t: float) -> dict | None:
    for s in shots:
        if s["start"] <= t < s["end"]:
            return s
    return shots[-1] if shots and t >= shots[-1]["start"] else None


# --------------------------------------------------------------------------- tracking

def track_by_shot(path: Path, shots: list[dict], char_ids: list[str]) -> tuple[dict, dict, float]:
    """For every 0.1 s, give the on-screen character the largest face and the pose whose nose sits on it
    (largest pose only when no face is found); others None."""
    import cv2
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODELS / ("pose_landmarker_full.task" if (MODELS / "pose_landmarker_full.task").exists() else "pose_landmarker_lite.task"))),
        running_mode=vision.RunningMode.VIDEO, num_poses=4))
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO, num_faces=4, output_face_blendshapes=True,
        # film faces are often small and dark (over-the-shoulder shots); the 0.5 defaults miss them
        min_face_detection_confidence=0.3, min_face_presence_confidence=0.3, min_tracking_confidence=0.3))

    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 24
    total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total / fps
    n = int(duration * FEATURE_FPS)
    poses = {c: [None] * n for c in char_ids}
    faces = {c: [None] * n for c in char_ids}

    # Read sequentially (seeking is slow and imprecise) and process the frame nearest each 0.1 s tick.
    k, frame_idx = 0, 0
    while k < n:
        ok, frame = cap.read()
        if not ok:
            break
        t_frame = frame_idx / fps
        frame_idx += 1
        if t_frame + 0.5 / fps < k / FEATURE_FPS:
            continue
        t = k / FEATURE_FPS
        shot = shot_at(shots, t)
        char = shot["character"] if shot else None
        if char:
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
            ts = int(t * 1000)
            pr = pose.detect_for_video(img, ts)
            fr = face.detect_for_video(img, ts)
            # Anchor on the largest visible FACE: in over-the-shoulder shots the foreground actor's
            # back is the biggest body, but only the on-screen character shows a face.
            fi, fc = None, None
            if fr.face_landmarks:
                def fbox(lm):
                    xs, ys = [q.x for q in lm], [q.y for q in lm]
                    return (max(xs) - min(xs)) * (max(ys) - min(ys)), ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2), max(xs) - min(xs)
                fi = max(range(len(fr.face_landmarks)), key=lambda i: fbox(fr.face_landmarks[i])[0])
                _, fc, fw = fbox(fr.face_landmarks[fi])
                by = {c.category_name: c.score for c in fr.face_blendshapes[fi]}
                faces[char][k] = [round(by.get(b, 0.0), 3) for b in BLENDSHAPES]
            if pr.pose_landmarks:
                p = None
                if fc is not None:
                    d = lambda lm: ((lm[0].x - fc[0]) ** 2 + (lm[0].y - fc[1]) ** 2) ** 0.5
                    cand = min(pr.pose_landmarks, key=d)
                    if d(cand) <= max(0.12, 1.5 * fw):   # nose must sit on that face
                        p = cand
                if p is None and fc is None:
                    # No face: prefer bodies whose shoulders are fully in frame. A foreground actor's
                    # back in an over-the-shoulder shot is the biggest body but runs off the frame edge.
                    inside = [lm for lm in pr.pose_landmarks
                              if all(0.03 < lm[i].x < 0.97 and 0.0 < lm[i].y < 1.0 for i in (11, 12))]
                    p = max(inside or pr.pose_landmarks,
                            key=lambda lm: abs(lm[11].x - lm[12].x) + abs(lm[11].y - lm[12].y))
                if p is not None:
                    poses[char][k] = [round(v, 3) if j < 2 else round(v, 2)
                                      for i in POSE_INDICES
                                      for j, v in enumerate((p[i].x, p[i].y, p[i].visibility or 0.0))]
        k += 1
        if k % 50 == 0:
            print(f"  tracked {t:.0f}s / {duration:.0f}s", flush=True)
    cap.release()
    return poses, faces, duration


# --------------------------------------------------------------------------- dialogue

def transcribe_clip(clip: Path) -> list[dict]:
    """-> word list [{text, start, end}] via ElevenLabs Scribe if keyed, else local Whisper small.en."""
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    key = os.getenv("ELEVENLABS_API_KEY")
    if key:
        import httpx

        print("  using ElevenLabs Scribe")
        with open(clip, "rb") as f:
            r = httpx.post("https://api.elevenlabs.io/v1/speech-to-text", headers={"xi-api-key": key},
                           data={"model_id": os.getenv("ELEVENLABS_STT_MODEL", "scribe_v2"), "language_code": "en"},
                           files={"file": (clip.name, f, "video/mp4")}, timeout=300)
        r.raise_for_status()
        return [{"text": w["text"], "start": w.get("start"), "end": w.get("end")}
                for w in r.json().get("words", []) if w.get("type", "word") == "word"]
    import local_stt

    print("  using local Whisper small.en (first run downloads ~500 MB)")
    return local_stt.transcribe_pcm(decode_audio(clip), model="small.en")


def lines_from_transcript(words: list[dict], shots: list[dict], fallback_char: str) -> list[dict]:
    import local_stt

    lines = []
    for seg in local_stt.words_to_segments(words):
        mid = (seg["start"] + seg["end"]) / 2
        shot = shot_at(shots, mid)
        lines.append({"character": (shot or {}).get("character") or fallback_char, "text": seg["text"],
                      "emotion": None, "direction": "Watch the shade and match it.",
                      "start": round(seg["start"], 2), "end": round(seg["end"], 2)})
    return lines


def align_lines(scene: dict, clip: Path, max_loss: float = 1.0) -> bool:
    """Snap each script line to the clip with ElevenLabs Forced Alignment (exact per-word times).

    Returns False (timings untouched) when no ElevenLabs key is configured. Space entries are
    ignored; words with loss > max_loss are not trusted; a line with no confident word keeps its
    old timing.
    """
    from dotenv import load_dotenv

    load_dotenv(ROOT / ".env")
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        return False
    import httpx

    text = " ".join(line["text"] for line in scene["lines"])
    with open(clip, "rb") as f:
        r = httpx.post("https://api.elevenlabs.io/v1/forced-alignment", headers={"xi-api-key": key},
                       data={"text": text}, files={"file": (clip.name, f, "video/mp4")}, timeout=300)
    r.raise_for_status()
    aligned = [w for w in r.json().get("words", []) if w.get("text", "").strip()]
    # the response words follow the script order: hand them out line by line
    i = 0
    for li, line in enumerate(scene["lines"]):
        n = len(line["text"].split())
        mine = [w for w in aligned[i:i + n] if w.get("loss", 0) <= max_loss]
        i += n
        if mine:
            old = (line["start"], line["end"])
            line["start"] = round(mine[0]["start"], 2)
            line["end"] = round(mine[-1]["end"], 2)
            print(f"  line {li + 1}: {old[0]:.2f}-{old[1]:.2f}s -> {line['start']:.2f}-{line['end']:.2f}s")
        else:
            print(f"  line {li + 1}: no confident alignment, timing unchanged")
    return True


def retime_lines(scene: dict, words: list[dict]) -> None:
    norm = lambda w: "".join(ch for ch in w.lower() if ch.isalnum())  # noqa: E731
    hw = [norm(w["text"]) for w in words]
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
            line["start"] = round(words[min(hits[li])]["start"], 2)
            line["end"] = round(words[max(hits[li])]["end"], 2)
            print(f"  line {li + 1}: {line['start']:.1f}-{line['end']:.1f}s")
        else:
            print(f"  line {li + 1}: NOT FOUND in clip audio, timing unchanged")


# --------------------------------------------------------------------------- main

def load_or_create_scene(args, header: dict | None = None) -> dict:
    if args.scene.exists():
        scene = json.loads(args.scene.read_text(encoding="utf-8"))
    elif header:
        scene = {"order": 0, "difficulty": "Medium", "video": None, "duration": 0, "lines": [],
                 "source": "The Odyssey (film) clip", "reference": None, **header}
    else:
        if not args.characters:
            sys.exit(f"{args.scene} does not exist. To create it, pass --characters id:Name ... (and --title).")
        scene = {"id": args.scene.stem, "order": 0, "title": args.title or args.scene.stem.replace("-", " ").title(),
                 "book": args.book, "blurb": args.blurb or "Act out the scene from the film.",
                 "difficulty": "Medium", "video": None, "duration": 0, "characters": [], "lines": [],
                 "source": "The Odyssey (film) clip", "reference": None}
    known = {c["id"] for c in scene["characters"]}
    for spec in args.characters or []:
        cid, _, name = spec.partition(":")
        if cid not in known:
            scene["characters"].append({"id": cid, "name": name or cid.title(), "description": ""})
            known.add(cid)
    if args.title:
        scene["title"] = args.title
    return scene


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--scene", required=True, type=Path, help="scene JSON to create or enrich")
    ap.add_argument("--video", type=Path, help="source film / clip (not needed with --retime-only)")
    ap.add_argument("--start", type=float, help="clip start in source, seconds")
    ap.add_argument("--end", type=float, help="clip end in source, seconds")
    ap.add_argument("--characters", nargs="+", metavar="ID:NAME", help="add/declare characters")
    ap.add_argument("--title")
    ap.add_argument("--book", default="The Odyssey (film)")
    ap.add_argument("--blurb")
    ap.add_argument("--shots", help='inline shot map, e.g. "0-2.3:penelope,2.3-5.1:antinous,5.1-6:none"')
    ap.add_argument("--shots-file", type=Path, help="JSON list of {start, end, character}")
    ap.add_argument("--lines-from-transcript", action="store_true", help="generate the script from the dialogue")
    ap.add_argument("--retime", action="store_true", help="snap existing lines to the dialogue timing")
    ap.add_argument("--retime-only", action="store_true",
                    help="ONLY re-time the existing lines against the existing clip (forced alignment); nothing else changes")
    ap.add_argument("--brighten", action="store_true", help="lift dark footage (gamma/brightness/saturation grade) when cutting the clip")
    args = ap.parse_args()

    if args.retime_only:
        scene = json.loads(args.scene.read_text(encoding="utf-8"))
        clip = ROOT / "scenes" / (scene.get("video") or f"media/{scene['id']}.mp4")
        print(f"re-timing {len(scene['lines'])} lines against {clip.name} (forced alignment)")
        if not align_lines(scene, clip):
            sys.exit("--retime-only needs ELEVENLABS_API_KEY (forced alignment).")
        args.scene.write_text(json.dumps(scene, indent=1), encoding="utf-8")
        return

    if args.video is None:
        ap.error("--video is required (unless --retime-only)")
    file_shots, header = read_shots_file(args.shots_file) if args.shots_file else (None, None)
    scene = load_or_create_scene(args, header)
    sid = scene["id"]
    media = ROOT / "scenes" / "media"
    media.mkdir(parents=True, exist_ok=True)
    clip = media / f"{sid}.mp4"
    if args.video.resolve() != clip.resolve():
        print(f"1/5 cutting clip -> {clip}")
        cut_clip(args.video, clip, args.start, args.end, brighten=args.brighten)

    print("2/5 detecting shots")
    auto_shots, duration = detect_shots(clip)
    print(f"  {len(auto_shots)} shots: " + ", ".join(f"{s['start']:.1f}-{s['end']:.1f}" for s in auto_shots))

    if file_shots is not None:
        shots = file_shots
    elif args.shots:
        shots = parse_shots(args.shots)
    else:
        tpl = write_shot_template(scene, clip, auto_shots)
        print(f"\nNo shot map given. Wrote a template to:\n  {tpl}\nand thumbnails to:\n  {OUT / f'shots_{sid}'}\n"
              f"Set each shot's \"character\" to one of {sorted(c['id'] for c in scene['characters'])} "
              f"(or null), then re-run with --shots-file {tpl}")
        return
    ids = {c["id"] for c in scene["characters"]}
    bad = sorted({s["character"] for s in shots if s["character"] and s["character"] not in ids})
    if bad:
        sys.exit(f"Shot map uses unknown character(s) {bad}; scene has {sorted(ids)}. Add them with --characters.")
    if not ids:
        sys.exit("Scene has no characters; pass --characters id:Name ...")

    print("3/5 tracking the on-screen actor in each shot")
    char_ids = [c["id"] for c in scene["characters"]]
    poses, faces, duration = track_by_shot(clip, shots, char_ids)

    print("4/5 audio contours")
    audio = audio_contours(decode_audio(clip))

    if args.lines_from_transcript or args.retime:
        print("5/5 transcribing dialogue")
        words = transcribe_clip(clip)
        print("  heard:", " ".join(w["text"] for w in words)[:400])
        if not words:
            sys.exit("No dialogue was heard in the clip; write the lines into the scene JSON by hand.")
        if args.lines_from_transcript:
            scene["lines"] = lines_from_transcript(words, shots, char_ids[0])
            for ln in scene["lines"]:
                print(f"  [{ln['start']:5.1f}-{ln['end']:5.1f}] {ln['character']:>10}: {ln['text']}")
            print("  ^ speakers are guessed from the shot on screen; fix any reaction shots by hand.")
        elif not align_lines(scene, clip):   # forced alignment when keyed, else transcript matching
            retime_lines(scene, words)
    else:
        print("5/5 (keeping existing lines)")
    if not scene["lines"]:
        sys.exit("Scene has no lines. Re-run with --lines-from-transcript or write them into the JSON.")

    scene["video"] = f"media/{clip.name}"
    scene["duration"] = round(max(duration, scene["lines"][-1]["end"] + 0.5), 1)
    scene["reference"] = {"fps": FEATURE_FPS, "shots": shots, "pose": poses, "face": faces, "audio": audio}
    args.scene.parent.mkdir(parents=True, exist_ok=True)
    args.scene.write_text(json.dumps(scene, indent=1), encoding="utf-8")

    print(f"\nDone -> {args.scene}")
    for c in char_ids:
        on = sum(1 for s in shots if s["character"] == c)
        frames_on = sum(1 for k in range(len(poses[c])) if (shot_at(shots, k / FEATURE_FPS) or {}).get("character") == c)
        got_p = sum(f is not None for f in poses[c])
        got_f = sum(f is not None for f in faces[c])
        print(f"  {c:>12}: {on} shot(s), {frames_on / FEATURE_FPS:.1f}s on screen, "
              f"pose found {got_p}/{frames_on}, face found {got_f}/{frames_on}")


if __name__ == "__main__":
    main()
