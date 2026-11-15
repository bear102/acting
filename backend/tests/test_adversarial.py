"""Adversarial scoring tests: bad performances must score LOW, good ones HIGH.

Players reported "it gave us ~500 when we missed everything". These cases drive the real
POST /api/perform endpoint (local Whisper STT, no ElevenLabs/Gemini) with realistic bad takes and
assert kleos ceilings, plus two positive controls so the bar can't be met by zeroing everything.

Run:   ..\\.venv\\Scripts\\python backend\\tests\\test_adversarial.py      (prints a table, exit 1 on failure)
  or:  pytest backend/tests/test_adversarial.py

Fixtures:
  * TTS-based audio (babble, wrong words, one line, full script) is committed in tests/fixtures/
    as small opus .webm files. If missing, they are regenerated with Windows SAPI voices.
  * Silence, humming and the film's own audio are synthesized/extracted at runtime.
  * The film scene needs scenes/media/beggar-in-the-hall.mp4 (gitignored); its cases are skipped
    if the clip isn't present.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
ROOT = BACKEND.parent
FIX = HERE / "fixtures"
SR = 16000
FPS = 10

# Force the offline path: local Whisper ears, canned gods, local leaderboard.
for k in ("ELEVENLABS_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MONGODB_URI"):
    os.environ[k] = ""
sys.path.insert(0, str(BACKEND))

from features import BLENDSHAPES, EMOTION_TEMPLATES, decode_audio, ffmpeg_exe  # noqa: E402

FILM = "beggar-in-the-hall"
TEXT = "my-name-is-noman"

# --------------------------------------------------------------------------- expectations

CEILINGS = {
    "silence_empty": 80,      # silence + nobody in frame
    "silence_still": 120,     # silence + players standing still, neutral faces
    "noise_fidget": 150,      # crowd chatter / room noise + random fidgeting
    "wrong_words": 200,       # clear speech of unrelated text + random gestures
    "missed_most": 350,       # only 1 line spoken (on cue), otherwise still
    "humming": 200,           # humming the melody during the lines, no words
    "over_actor": 250,        # all blendshapes 0.7, flailing arms, shouting wrong words
}
FLOORS = {
    "control_film": (FILM, 750),   # film's own audio + mirrored reference poses/faces
    "control_text": (TEXT, 550),   # TTS of the exact script on cue + gestures + matching emotions
}

UNRELATED = [
    "Did you see the game last night? The second half was incredible.",
    "I think the pizza is getting cold, somebody should grab it before it is gone.",
    "My laptop battery died again, does anyone have a charger I can borrow?",
    "The wifi in this building is terrible, I cannot push my code at all.",
    "We should probably start the demo video soon, the deadline is at noon.",
    "Honestly the coffee here is better than the coffee at my apartment.",
]
WRONG_TEXT = (
    "Preheat the oven to three hundred and fifty degrees. In a large bowl, whisk together the flour, "
    "the sugar and a pinch of salt. Add two eggs and a cup of milk, then stir until smooth. "
    "Pour the batter into a greased pan and bake for twenty five minutes, or until golden brown. "
    "Let it cool before slicing, and serve with fresh strawberries."
)


def load_scene(sid: str) -> dict:
    return json.loads((ROOT / "scenes" / f"{sid}.json").read_text(encoding="utf-8"))


def film_available() -> bool:
    return (ROOT / "scenes" / "media" / f"{FILM}.mp4").exists()


# --------------------------------------------------------------------------- audio helpers

def encode_webm(y: np.ndarray, path: Path, bitrate: str = "24k") -> None:
    """float32 mono 16k -> opus/webm, like the browser's MediaRecorder."""
    with tempfile.TemporaryDirectory() as td:
        raw = Path(td) / "a.f32"
        np.clip(y, -1, 1).astype("<f4").tofile(raw)
        subprocess.run([ffmpeg_exe(), "-v", "error", "-y", "-f", "f32le", "-ar", str(SR), "-ac", "1",
                        "-i", str(raw), "-c:a", "libopus", "-b:a", bitrate, str(path)], check=True)


def webm_bytes(y: np.ndarray) -> bytes:
    with tempfile.TemporaryDirectory() as td:
        p = Path(td) / "take.webm"
        encode_webm(y, p, "32k")
        return p.read_bytes()


def track(duration: float) -> np.ndarray:
    return np.zeros(int(duration * SR) + SR // 2, dtype=np.float32)


def place(dst: np.ndarray, clip: np.ndarray, at: float, gain: float = 1.0) -> None:
    a = int(at * SR)
    n = min(len(clip), len(dst) - a)
    if n > 0:
        dst[a:a + n] += gain * clip[:n]


def mic_floor(n: int, rng: np.random.Generator, level: float = 0.002) -> np.ndarray:
    return (rng.standard_normal(n) * level).astype(np.float32)


def pink_noise(n: int, rng: np.random.Generator) -> np.ndarray:
    white = rng.standard_normal(n)
    f = np.fft.rfft(white)
    f /= np.sqrt(np.maximum(np.arange(len(f)), 1))
    y = np.fft.irfft(f, n)
    return (y / (np.abs(y).max() + 1e-9)).astype(np.float32)


def tts(items: list[dict], out_dir: Path) -> list[np.ndarray]:
    """Windows SAPI TTS. items: [{text, voice ('David'|'Zira'), rate (-10..10)}] -> 16k float arrays."""
    out_dir.mkdir(parents=True, exist_ok=True)
    jobs = []
    for i, it in enumerate(items):
        jobs.append({"text": it["text"], "voice": f"Microsoft {it.get('voice', 'David')} Desktop",
                     "rate": int(it.get("rate", 0)), "path": str(out_dir / f"t{i}.wav")})
    spec = out_dir / "jobs.json"
    spec.write_text(json.dumps(jobs), encoding="utf-8")
    ps = out_dir / "tts.ps1"
    ps.write_text(
        "Add-Type -AssemblyName System.Speech\n"
        f"$jobs = Get-Content -Raw -Path '{spec}' | ConvertFrom-Json\n"
        "foreach ($j in $jobs) {\n"
        "  $s = New-Object System.Speech.Synthesis.SpeechSynthesizer\n"
        "  $s.SelectVoice($j.voice); $s.Rate = $j.rate\n"
        "  $s.SetOutputToWaveFile($j.path); $s.Speak($j.text); $s.Dispose()\n"
        "}\n", encoding="utf-8")
    subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", str(ps)], check=True)
    return [decode_audio(j["path"]) for j in jobs]


def longest_line(scene: dict) -> dict:
    return max(scene["lines"], key=lambda l: len(l["text"].split()))


def build_fixtures(force: bool = False) -> None:
    """Generate the committed TTS fixtures (needs Windows System.Speech)."""
    needed = ["babble.webm", "wrong_words.webm", "wrong_words_shout.webm",
              f"one_line_{FILM}.webm", f"one_line_{TEXT}.webm", f"script_{TEXT}.webm"]
    if not force and all((FIX / n).exists() for n in needed):
        return
    FIX.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(7)
    with tempfile.TemporaryDirectory() as td:
        td = Path(td)
        # Crowd chatter: several voices at different rates/offsets + pink noise.
        chat = tts([{"text": t, "voice": ("David", "Zira")[i % 2], "rate": (i % 3) - 1}
                    for i, t in enumerate(UNRELATED)], td / "chat")
        y = track(26)
        for i, c in enumerate(chat):
            for rep in range(2):
                place(y, c, (i * 2.1 + rep * 12.5) % 22, gain=0.35 + 0.1 * (i % 3))
        y += 0.06 * pink_noise(len(y), rng)
        encode_webm(y / max(1e-6, np.abs(y).max()) * 0.6, FIX / "babble.webm")

        # Clear speech of the wrong text, and a shouted/clipped version of it.
        wrong = tts([{"text": WRONG_TEXT, "voice": "David", "rate": 0}], td / "wrong")[0]
        y = track(52)
        place(y, wrong, 1.0)
        place(y, wrong, 1.0 + len(wrong) / SR + 0.8)
        y = y[: int(52 * SR)]
        encode_webm(y * 0.8 + mic_floor(len(y), rng), FIX / "wrong_words.webm")
        encode_webm(np.clip(y * 3.0, -0.95, 0.95) + mic_floor(len(y), rng), FIX / "wrong_words_shout.webm")

        # Only one line (the longest = most favourable to the players), placed on its cue.
        for sid in (FILM, TEXT):
            s = load_scene(sid)
            line = longest_line(s)
            clip = tts([{"text": line["text"], "voice": "David", "rate": 1}], td / f"one_{sid}")[0]
            y = track(s["duration"])
            place(y, clip, line["start"])
            encode_webm(y * 0.8 + mic_floor(len(y), rng), FIX / f"one_line_{sid}.webm")

        # Positive control for the text scene: every line on cue, a voice per character.
        s = load_scene(TEXT)
        voices = {c["id"]: ("David", "Zira")[i % 2] for i, c in enumerate(s["characters"])}
        clips = tts([{"text": l["text"], "voice": voices[l["character"]], "rate": 1} for l in s["lines"]],
                    td / "script")
        y = track(s["duration"])
        for l, c in zip(s["lines"], clips):
            place(y, c, l["start"])
        encode_webm(y * 0.8 + mic_floor(len(y), rng), FIX / f"script_{TEXT}.webm")


def fixture(name: str) -> bytes:
    return (FIX / name).read_bytes()


def silence_audio(scene: dict, rng) -> bytes:
    y = track(scene["duration"])
    return webm_bytes(y + mic_floor(len(y), rng))


def hum_audio(scene: dict, rng) -> bytes:
    """Humming / mumbling the melody: voiced, intonated, syllable-shaped, ONLY during lines, no words.
    For a scene with reference audio the hum follows the film's own pitch contour (worst case)."""
    y = track(scene["duration"])
    t = np.arange(len(y)) / SR
    ref = (scene.get("reference") or {}).get("audio") or {}
    rp = np.array([np.nan if v is None else v for v in ref.get("pitch", [])], dtype=float)
    if len(rp) and np.isfinite(rp).any():
        semis = np.interp(t * FPS, np.arange(len(rp)), np.where(np.isfinite(rp), rp, np.nanmedian(rp)))
    else:
        semis = 25 + 3 * np.sin(2 * np.pi * 0.35 * t) + 1.5 * np.sin(2 * np.pi * 1.1 * t)
    f0 = 55 * 2 ** (semis / 12)
    phase = 2 * np.pi * np.cumsum(f0) / SR
    tone = sum((0.6 / k) * np.sin(k * phase) for k in range(1, 7))   # buzzy "mmm"
    gate = np.zeros_like(t)
    for l in scene["lines"]:
        gate[(t >= l["start"]) & (t <= l["end"])] = 1
    syll = 0.55 + 0.45 * np.clip(np.sin(2 * np.pi * 3.2 * t), 0, 1)
    y = (0.25 * tone * gate * syll).astype(np.float32)
    return webm_bytes(y + mic_floor(len(y), rng))


def film_audio() -> bytes:
    y = decode_audio(ROOT / "scenes" / "media" / f"{FILM}.mp4")
    return webm_bytes(y)


# --------------------------------------------------------------------------- body/face helpers

def n_frames(scene: dict) -> int:
    return int(scene["duration"] * FPS) + 1


def base_pose(i: int, n: int) -> np.ndarray:
    """(7,3) [x,y,vis] for player i of n standing in a row (display coords, mirrored webcam)."""
    cx = (i + 0.5) / n
    hw = 0.05 if n >= 3 else 0.065
    return np.array([
        [cx, 0.30, .99],                   # nose
        [cx - hw, 0.45, .98], [cx + hw, 0.45, .98],          # shoulders
        [cx - hw - .02, 0.60, .93], [cx + hw + .02, 0.60, .93],  # elbows
        [cx - hw - .01, 0.73, .88], [cx + hw + .01, 0.73, .88],  # wrists (arms hanging)
    ])


def flat(p: np.ndarray) -> list:
    return [round(float(v), 3) for v in p.reshape(-1)]


def neutral_face(rng) -> np.ndarray:
    return np.clip(0.04 + 0.012 * rng.standard_normal(len(BLENDSHAPES)), 0, 1)


def still(i: int, n: int, N: int, rng) -> dict:
    b = base_pose(i, n)
    pose = []
    for _ in range(N):
        p = b.copy()
        p[:, :2] += 0.002 * rng.standard_normal((7, 2))       # detector jitter
        pose.append(flat(p))
    return {"pose": pose, "face": [neutral_face(rng).round(3).tolist() for _ in range(N)]}


def fidget(i: int, n: int, N: int, rng) -> dict:
    b = base_pose(i, n)
    off = np.zeros((7, 2))
    face = np.full(len(BLENDSHAPES), 0.05)
    pose, faces = [], []
    for _ in range(N):
        off = 0.92 * off + 0.012 * rng.standard_normal((7, 2))
        off[:3] = 0.92 * off[:3] + 0.004 * rng.standard_normal((3, 2))   # torso moves less
        p = b.copy()
        p[:, :2] += off
        pose.append(flat(p))
        face = np.clip(0.9 * face + 0.1 * rng.uniform(0, 0.3, len(BLENDSHAPES)), 0, 1)
        faces.append(face.round(3).tolist())
    return {"pose": pose, "face": faces}


def random_gestures(i: int, n: int, N: int, rng) -> dict:
    b = base_pose(i, n)
    cur = b.copy()
    target = b.copy()
    pose, faces = [], []
    face = neutral_face(rng)
    for k in range(N):
        if k % FPS == 0:   # pick a new random arm position every second
            target = b.copy()
            for j in (3, 4, 5, 6):
                target[j, 0] = b[j, 0] + rng.uniform(-0.12, 0.12)
                target[j, 1] = b[j, 1] + rng.uniform(-0.35, 0.05)
            face = np.clip(rng.uniform(0, 0.35, len(BLENDSHAPES)), 0, 1)
        cur[:, :2] += 0.3 * (target[:, :2] - cur[:, :2])
        pose.append(flat(cur))
        faces.append(face.round(3).tolist())
    return {"pose": pose, "face": faces}


def over_actor(i: int, n: int, N: int, rng) -> dict:
    b = base_pose(i, n)
    pose = []
    for _ in range(N):
        p = b.copy()
        for j in (3, 4, 5, 6):   # flailing: arms anywhere, every frame
            p[j, 0] = b[j, 0] + rng.uniform(-0.18, 0.18)
            p[j, 1] = b[j, 1] + rng.uniform(-0.45, 0.1)
        p[0, :2] += rng.uniform(-0.03, 0.03, 2)
        pose.append(flat(p))
    return {"pose": pose, "face": [[0.7] * len(BLENDSHAPES) for _ in range(N)]}


def acting(scene: dict, chars: list[str], i: int, n: int, N: int, rng) -> dict:
    """Text-scene control: moderate gestures + the emotion each line asks for, during own lines."""
    b = base_pose(i, n)
    pose, faces = [], []
    names = {nm: k for k, nm in enumerate(BLENDSHAPES)}
    for k in range(N):
        t = k / FPS
        p = b.copy()
        p[:, :2] += 0.002 * rng.standard_normal((7, 2))
        face = neutral_face(rng)
        line = next((l for l in scene["lines"] if l["character"] in chars and l["start"] <= t <= l["end"]), None)
        if line:
            ph = (t - line["start"]) / max(0.1, line["end"] - line["start"])
            env = min(1.0, ph * 4, (1 - ph) * 4)
            p[5, 1] -= 0.18 * env * (0.6 + 0.4 * np.sin(2 * np.pi * 0.7 * t))    # expressive arm
            p[3, 1] -= 0.08 * env
            p[5, 0] -= 0.05 * env
            for nm, w in EMOTION_TEMPLATES.get(line.get("emotion", ""), {}).items():
                face[names[nm]] += 0.5 * w * env
        pose.append(flat(p))
        faces.append(np.clip(face, 0, 1).round(3).tolist())
    return {"pose": pose, "face": faces}


def mirror_reference(scene_full: dict, char: str, N: int) -> dict:
    """Perfect imitation of the film actor, as a mirrored webcam would report it."""
    ref = scene_full["reference"]

    def carry(seq):
        out, last = [], None
        first = next((f for f in seq if f), None)
        for f in seq:
            last = f or last
            out.append(last or first)
        return (out + [out[-1]] * N)[:N]

    pose = [[round(1 - v, 3) if k % 3 == 0 else v for k, v in enumerate(f)] if f else None
            for f in ref["pose"][char]]
    return {"pose": carry(pose), "face": carry(ref["face"][char])}


def nobody(N: int) -> dict:
    return {"pose": [None] * N, "face": [None] * N}


# --------------------------------------------------------------------------- the cases

def make_cases() -> list[dict]:
    build_fixtures()
    cases = []
    for sid in (FILM, TEXT):
        if sid == FILM and not film_available():
            print(f"! {FILM}.mp4 not found in scenes/media: skipping film-scene cases")
            continue
        s = load_scene(sid)
        N = n_frames(s)
        chars = [c["id"] for c in s["characters"]]
        n = len(chars)
        rng = np.random.default_rng({FILM: 11, TEXT: 22}[sid])  # deterministic

        def everyone(fn):
            return [fn(i, n, N, rng) for i in range(n)]

        cases += [
            dict(scene=sid, case="silence_empty", audio=silence_audio(s, rng), players=[nobody(N)] * n),
            dict(scene=sid, case="silence_still", audio=silence_audio(s, rng), players=everyone(still)),
            dict(scene=sid, case="noise_fidget", audio=fixture("babble.webm"), players=everyone(fidget)),
            dict(scene=sid, case="wrong_words", audio=fixture("wrong_words.webm"), players=everyone(random_gestures)),
            dict(scene=sid, case="missed_most", audio=fixture(f"one_line_{sid}.webm"), players=everyone(still)),
            dict(scene=sid, case="humming", audio=hum_audio(s, rng), players=everyone(still)),
            dict(scene=sid, case="over_actor", audio=fixture("wrong_words_shout.webm"), players=everyone(over_actor)),
        ]
        if sid == FILM:
            cases.append(dict(scene=sid, case="control_film", audio=film_audio(),
                              players=[mirror_reference(s, c, N) for c in chars]))
        else:
            cases.append(dict(scene=sid, case="control_text", audio=fixture(f"script_{sid}.webm"),
                              players=[acting(s, [c], i, n, N, rng) for i, c in enumerate(chars)]))
    return cases


def run_cases() -> list[dict]:
    from fastapi.testclient import TestClient

    import app as app_module
    import store

    tmp = Path(tempfile.mkdtemp()) / "runs.json"
    store._LOCAL = tmp   # keep the real leaderboard clean
    cases = make_cases()
    rows = []
    with TestClient(app_module.app) as client:
        for c in cases:
            s = load_scene(c["scene"])
            chars = [ch["id"] for ch in s["characters"]]
            meta = {
                "scene_id": c["scene"], "team_name": f"adversary-{c['case']}",
                "players": [{"name": f"P{i + 1}"} for i in range(len(chars))],
                "assignments": {ch: i for i, ch in enumerate(chars)},
                "duration": s["duration"],
                "features": {"fps": FPS, "players": c["players"]},
                "browser_transcript": [],
            }
            t0 = time.time()
            r = client.post("/api/perform", data={"meta": json.dumps(meta)},
                            files=[("audio", ("take.webm", c["audio"], "audio/webm"))])
            if r.status_code != 200:
                rows.append({**c, "error": f"HTTP {r.status_code}: {r.text[:200]}"})
                continue
            d = r.json()
            rows.append({"scene": c["scene"], "case": c["case"], "secs": time.time() - t0,
                         **{k: d["judges"][k]["score"] for k in ("athena", "apollo", "ares", "aphrodite")},
                         "kleos": d["kleos"], "rank": d["rank"], "stt": d["stt_source"],
                         "heard": d.get("transcript", "")})
    try:
        tmp.unlink()
    except OSError:
        pass
    return rows


def check(rows: list[dict]) -> list[str]:
    failures = []
    for r in rows:
        tag = f"{r['scene']}/{r['case']}"
        if "error" in r:
            failures.append(f"{tag}: {r['error']}")
        elif r["case"] in CEILINGS and r["kleos"] > CEILINGS[r["case"]]:
            failures.append(f"{tag}: kleos {r['kleos']} > ceiling {CEILINGS[r['case']]}")
        elif r["case"] in FLOORS and r["kleos"] < FLOORS[r["case"]][1]:
            failures.append(f"{tag}: kleos {r['kleos']} < floor {FLOORS[r['case']][1]}")
    return failures


def print_table(rows: list[dict]) -> None:
    hdr = f"{'scene':20s} {'case':14s} {'athena':>6s} {'apollo':>6s} {'ares':>5s} {'aphro':>5s} {'kleos':>5s} {'limit':>7s}  {'rank':18s} {'stt':8s} heard"
    print(hdr)
    print("-" * len(hdr))
    for r in rows:
        if "error" in r:
            print(f"{r['scene']:20s} {r['case']:14s} ERROR {r['error']}")
            continue
        lim = (f"<={CEILINGS[r['case']]}" if r["case"] in CEILINGS else f">={FLOORS[r['case']][1]}")
        ok = "ok " if not check([r]) else "FAIL"
        print(f"{r['scene']:20s} {r['case']:14s} {r['athena']:6d} {r['apollo']:6d} {r['ares']:5d} "
              f"{r['aphrodite']:5d} {r['kleos']:5d} {lim:>7s} {ok} {r['rank']:18s} {r['stt']:8s} "
              f"{r['heard'][:40]!r}")


_ROWS: list[dict] | None = None


def _rows() -> list[dict]:
    global _ROWS
    if _ROWS is None:
        _ROWS = run_cases()
    return _ROWS


def test_adversarial_ceilings_and_controls():
    rows = _rows()
    print_table(rows)
    failures = check(rows)
    assert not failures, "\n" + "\n".join(failures)


if __name__ == "__main__":
    if "--rebuild-fixtures" in sys.argv:
        build_fixtures(force=True)
    t = time.time()
    rows = _rows()
    print_table(rows)
    fails = check(rows)
    print(f"\n{len(rows)} cases in {time.time() - t:.0f}s, {len(fails)} failure(s)")
    for f in fails:
        print("  FAIL", f)
    sys.exit(1 if fails else 0)
