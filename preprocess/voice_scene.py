"""Voice the public-domain Homer text scenes with ElevenLabs (Voice Design + v3 Text-to-Dialogue).

  .venv\\Scripts\\python preprocess\\voice_scene.py voices          # design + save the 6 voices -> backend/voices.json
  .venv\\Scripts\\python preprocess\\voice_scene.py scenes          # voice every text scene
  .venv\\Scripts\\python preprocess\\voice_scene.py scenes my-name-is-noman
  .venv\\Scripts\\python preprocess\\voice_scene.py bard            # one sung invocation per scene
  .venv\\Scripts\\python preprocess\\voice_scene.py names           # name pronunciation chips

Per scene it writes frontend/public/audio/scenes/<id>.mp3 (1.5 s lead, 0.9 s between lines) and
<id>/<i>.mp3 per line, rewrites each line's start/end to the assembled track, and stores
`voiced` + `reference_audio` (pitch/energy contours for Apollo) at the top level of the scene JSON.
`reference` stays null, so the scene is not shown as having film reference data.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))
from features import audio_contours, decode_audio, ffmpeg_exe  # noqa: E402

load_dotenv(ROOT / ".env")
API = "https://api.elevenlabs.io/v1"
VOICES_FILE = ROOT / "backend" / "voices.json"
AUDIO = ROOT / "frontend" / "public" / "audio"
TEXT_SCENES = ["i-am-odysseus", "my-name-is-noman", "bound-to-the-mast", "secret-of-the-bed"]
LEAD, GAP = 1.5, 0.9
spent = 0

DESIGN_TEXT = ("Sing to me, O Muse, of the man of many turns, who wandered far "
               "after he sacked the sacred citadel of Troy.")
VOICES = {
    "bard": ("An ancient Greek bard, elderly man, deep warm resonant voice, slow and solemn, "
             "like an epic storyteller by a fire", "nPczCjzI2devNBz1zQrb"),
    "odysseus": ("Middle-aged Greek hero, weathered warm baritone, clever and controlled, a faint rasp",
                 "JBFqnCBsd6RMkjVDRZzb"),
    "polyphemus": ("An enormous one-eyed giant, very deep booming gravelly bass, slow, menacing, animal-like",
                   "SOYHLrjzK2X1ezoPC6cr"),
    "siren": ("An otherworldly enchanting female voice, airy and seductive, slightly haunting, almost singing",
              "pFZP5JQG7iQjIQuC4Bku"),
    "eurylochus": ("A tough sailor first mate, loud gruff tenor, urgent and commanding", "N2lVS1w4EtoT3dr4eOWO"),
    "penelope": ("A regal queen in her forties, cool composed alto, measured and guarded, warm underneath",
                 "EXAVITQu4vr4xnSDxMaL"),
}
TAGS = {"rage": "[angry]", "fear": "[scared]", "joy": "[laughs]", "sorrow": "[sad]", "cunning": "[sly]",
        "awe": "[awed]", "resolve": "[determined]", "longing": "[wistful]"}
BARD = {
    "i-am-odysseus": "[solemn] Sing, O Muse, of the stranger at the Phaeacian court, who at last spoke his own name.",
    "my-name-is-noman": "[solemn] Sing, O Muse, of the cave of the Cyclops, and of the man who called himself Noman.",
    "bound-to-the-mast": "[solemn] Sing, O Muse, of the singing rocks, and of the man who heard the Sirens and lived.",
    "secret-of-the-bed": "[solemn] Sing, O Muse, of the queen who tested her husband with a bed no mortal could move.",
    "beggar-in-the-hall": "[solemn] Sing, O Muse, of the suitors in Odysseus' hall, and of the beggar none of them knew.",
}
NAMES = ["Antinous", "Penelope", "Odysseus", "Polyphemus", "Eurylochus", "Telemachus", "Calypso",
         "Siren", "the Beggar", "Phaeacians", "Laertes", "Ithaca", "Noman"]


def headers() -> dict:
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY missing in .env")
    return {"xi-api-key": key}


def post(path: str, **kw) -> httpx.Response:
    global spent
    r = httpx.post(API + path, headers=headers(), timeout=180, **kw)
    if r.status_code >= 400:
        raise RuntimeError(f"{path} -> {r.status_code}: {r.text[:300]}")
    try:
        spent += int(r.headers.get("character-cost", 0))
    except ValueError:
        pass
    return r


def load_voices() -> dict:
    if VOICES_FILE.exists():
        return json.loads(VOICES_FILE.read_text())
    return {k: v[1] for k, v in VOICES.items()}  # premade fallbacks


def design_voices() -> None:
    out = load_voices() if VOICES_FILE.exists() else {}
    for name, (desc, fallback) in VOICES.items():
        if name in out and out[name] != fallback:
            print(f"  {name}: already designed ({out[name]})")
            continue
        try:
            d = post("/text-to-voice/design",
                     json={"voice_description": desc, "model_id": "eleven_ttv_v3", "text": DESIGN_TEXT}).json()
            gid = d["previews"][0]["generated_voice_id"]
            v = post("/text-to-voice", json={"voice_name": f"Odysseus game - {name}", "voice_description": desc,
                                             "generated_voice_id": gid}).json()
            out[name] = v["voice_id"]
            print(f"  {name}: designed -> {out[name]}")
        except Exception as e:  # noqa: BLE001
            out[name] = fallback
            print(f"  {name}: design failed ({e}); using premade {fallback}")
        VOICES_FILE.write_text(json.dumps(out, indent=2))


def voice_for(char: str, voices: dict) -> str:
    return voices.get(char) or voices["bard"]


def ff(*args: str) -> None:
    subprocess.run([ffmpeg_exe(), "-v", "error", "-y", *args], check=True)


def duration(path: Path) -> float:
    y = decode_audio(path)
    return len(y) / 16000


def line_spans(d: dict, n: int, y, sr: int = 16000) -> list[tuple[float, float]]:
    """Each input's span in the dialogue audio.

    voice_segments split the text correctly, but their boundary times are coarse (up to ~1.5 s off
    when one voice speaks consecutive lines). The real break between two lines is the pause between
    them, so each cut goes in the middle of the longest pause near the reported boundary.
    """
    import numpy as np

    hop = sr // 100                                  # 10 ms frames
    e = np.array([np.sqrt(np.mean(y[i:i + hop] ** 2)) for i in range(0, len(y) - hop, hop)])
    db = 20 * np.log10(e + 1e-6)
    quiet = db < db.max() - 38
    dur = len(y) / sr
    starts = {}
    for sgm in d["voice_segments"]:
        i = sgm["dialogue_input_index"]
        starts[i] = min(starts.get(i, 1e9), sgm["start_time_seconds"])
    cuts = [0.0]
    for i in range(1, n):
        guess = starts[i]
        lo, hi = max(int((guess - 1.5) * 100), 0), min(int((guess + 2.0) * 100), len(quiet))
        best, run_start = (0, guess), None
        for k in range(lo, hi + 1):
            q = k < hi and quiet[k]
            if q and run_start is None:
                run_start = k
            if not q and run_start is not None:
                length = k - run_start
                if length > best[0]:
                    best = (length, (run_start + k) / 200)   # middle of the pause, seconds
                run_start = None
        cuts.append(best[1])
    cuts.append(dur)
    spans = []
    for i in range(n):
        a, b = cuts[i], cuts[i + 1]
        # trim leading/trailing silence but keep a little air
        ka, kb = int(a * 100), max(int(a * 100) + 1, int(b * 100) - 1)
        loud = [k for k in range(ka, min(kb, len(quiet))) if not quiet[k]]
        if loud:
            a, b = max(a, loud[0] / 100 - 0.12), min(b, loud[-1] / 100 + 0.25)
        spans.append((a, b))
    return spans


def voice_scene(sid: str, voices: dict) -> None:
    p = ROOT / "scenes" / f"{sid}.json"
    scene = json.loads(p.read_text(encoding="utf-8"))
    inputs = [{"text": f"{TAGS.get(l.get('emotion'), '')} {l['text']}".strip(),
               "voice_id": voice_for(l["character"], voices)} for l in scene["lines"]]
    cache = ROOT / "preprocess" / "out" / f"dialogue_{sid}.json"
    if cache.exists() and "--fresh" not in sys.argv:
        d = json.loads(cache.read_text())
    else:
        d = post("/text-to-dialogue/with-timestamps", json={"inputs": inputs, "model_id": "eleven_v3"}).json()
        cache.parent.mkdir(exist_ok=True)
        cache.write_text(json.dumps(d))
    out_dir = AUDIO / "scenes" / sid
    out_dir.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory() as td:
        full = Path(td) / "full.mp3"
        full.write_bytes(base64.b64decode(d["audio_base64"]))
        spans = line_spans(d, len(scene["lines"]), decode_audio(full))
        clips = []
        for i in range(len(scene["lines"])):
            a, b = spans[i]
            clip = out_dir / f"{i}.mp3"
            ff("-ss", f"{max(0, a):.3f}", "-to", f"{b:.3f}", "-i", str(full),
               "-ac", "1", "-ar", "44100", "-b:a", "96k", str(clip))
            clips.append(clip)
        # assemble: lead silence, clips separated by gaps; record each line's timing
        t = LEAD
        parts, filt = [], []
        for i, c in enumerate(clips):
            dur = duration(c)
            scene["lines"][i]["start"], scene["lines"][i]["end"] = round(t, 2), round(t + dur, 2)
            t += dur + GAP
        total = t - GAP + 1.0
        concat = Path(td) / "list.txt"
        sil_lead, sil_gap = Path(td) / "lead.mp3", Path(td) / "gap.mp3"
        ff("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", str(LEAD), "-b:a", "96k", str(sil_lead))
        ff("-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", str(GAP), "-b:a", "96k", str(sil_gap))
        for i, c in enumerate(clips):
            parts.append(sil_lead if i == 0 else sil_gap)
            parts.append(c)
        concat.write_text("".join(f"file '{x.as_posix()}'\n" for x in parts))
        track = AUDIO / "scenes" / f"{sid}.mp3"
        ff("-f", "concat", "-safe", "0", "-i", str(concat), "-ac", "1", "-ar", "44100", "-b:a", "96k", str(track))
    # re-measure line timing on the actual assembled file (mp3 frame padding can drift a little)
    scene["duration"] = round(max(total, scene["lines"][-1]["end"] + 1.0), 1)
    scene["voiced"] = {"track": f"audio/scenes/{sid}.mp3",
                       "lines": [f"audio/scenes/{sid}/{i}.mp3" for i in range(len(clips))]}
    scene["reference_audio"] = audio_contours(decode_audio(track))
    scene["reference"] = None
    p.write_text(json.dumps(scene, indent=2), encoding="utf-8")
    print(f"  {sid}: {len(clips)} lines, track {scene['duration']}s")


def tts(text: str, voice: str, out: Path) -> None:
    r = post(f"/text-to-speech/{voice}", params={"output_format": "mp3_44100_96"},
             json={"text": text, "model_id": "eleven_v3"})
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(r.content)


def main() -> None:
    cmd = sys.argv[1] if len(sys.argv) > 1 else "scenes"
    if cmd == "voices":
        design_voices()
    elif cmd == "scenes":
        voices = load_voices()
        for sid in (sys.argv[2:] or TEXT_SCENES):
            voice_scene(sid, voices)
    elif cmd == "bard":
        voices = load_voices()
        for sid, text in BARD.items():
            tts(text, voices["bard"], AUDIO / "bard" / f"{sid}.mp3")
            print(f"  bard {sid}")
    elif cmd == "names":
        voices = load_voices()
        for n in NAMES:
            slug = n.lower().replace("the ", "").replace(" ", "-")
            tts(n, voices["odysseus"], AUDIO / "names" / f"{slug}.mp3")
            print(f"  name {slug}")
    print(f"credits spent this run: {spent}")


if __name__ == "__main__":
    main()
