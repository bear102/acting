"""Scoring regression harness. Run as a plain script (from anywhere):

    .venv\\Scripts\\python backend\\tests\\test_scoring.py

Builds synthetic performances from the real film reference in scenes/beggar-in-the-hall.json and
checks the judges rank them sensibly:
  visuals : perfect mirror copy > 0.4 s late copy > noisy amateur copy > statue / flailer / over-actor
  audio   : film audio > Windows TTS reading > hum > silence
Needs the (gitignored) clip at scenes/media/beggar-in-the-hall.mp4 for the audio tests; they are
skipped with a warning if it is missing. TTS uses Windows System.Speech (skipped elsewhere).
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent
ROOT = BACKEND.parent
sys.path.insert(0, str(BACKEND))

import scoring  # noqa: E402
from features import BLENDSHAPES, FEATURE_FPS, audio_contours, decode_audio  # noqa: E402

SCENE = json.loads((ROOT / "scenes" / "beggar-in-the-hall.json").read_text(encoding="utf-8"))
REF = SCENE["reference"]
CHARS = ["antinous", "penelope", "odysseus"]
ASSIGN = {c: i for i, c in enumerate(CHARS)}
N = int(round(SCENE["duration"] * FEATURE_FPS))
CLIP = ROOT / "scenes" / "media" / "beggar-in-the-hall.mp4"
SR = 16000
rng = np.random.default_rng(7)


# --------------------------------------------------------------------------- helpers

def hold(track: list) -> list:
    """Carry the last non-null frame forward (and the first one backward): an always-present player."""
    out, last = [], None
    first = next((f for f in track if f), None)
    for f in track:
        last = f or last
        out.append(last or first)
    return (out + [out[-1]] * N)[:N]


def shift(track: list, frames: int) -> list:
    return ([track[0]] * frames + track)[:N]


def lowpass_noise(shape, sigma: float, smooth: int = 5) -> np.ndarray:
    raw = rng.normal(0, 1, (shape[0] + smooth * 4, *shape[1:]))
    k = np.exp(-0.5 * (np.arange(-smooth * 2, smooth * 2 + 1) / smooth) ** 2)
    k /= k.sum()
    sm = np.apply_along_axis(lambda v: np.convolve(v, k, mode="same"), 0, raw)[smooth * 2: smooth * 2 + shape[0]]
    return sm / (sm.std() + 1e-9) * sigma


def to_webcam(frame: list | None) -> list | None:
    """A player reproducing the film frame on the (mirrored) stage display.

    The browser sends display coordinates, so the on-screen geometry is identical to the film's,
    but anatomical labels flip (the player's left shoulder shows on screen-left, the actor's on
    screen-right). Also re-framed: different scale and position in the webcam image.
    """
    if not frame:
        return None
    a = np.asarray(frame, dtype=float).reshape(7, 3).copy()
    for i, j in ((1, 2), (3, 4), (5, 6)):
        a[[i, j]] = a[[j, i]]
    a[:, :2] = 0.5 + (a[:, :2] - 0.5) * 0.7 + np.array([0.08, 0.05])
    return [round(float(v), 4) for v in a.reshape(-1)]


def pose_copy(char: str) -> list:
    return [to_webcam(f) for f in hold(REF["pose"][char])]


def perturb_pose(track: list, lp: float, white: float) -> list:
    """Noise in SHOULDER WIDTHS (body-relative), smooth drift lp + per-frame jitter white."""
    arr = np.array([np.asarray(f, dtype=float).reshape(7, 3) for f in track])
    sw = np.linalg.norm(arr[:, 1, :2] - arr[:, 2, :2], axis=1)[:, None, None]
    arr[:, :, :2] += (lowpass_noise(arr[:, :, :2].shape, lp) + rng.normal(0, white, arr[:, :, :2].shape)) * sw
    return [list(np.round(f.reshape(-1), 4)) for f in arr]


def exaggerate_pose(track: list, k: float) -> list:
    arr = np.array([np.asarray(f, dtype=float).reshape(7, 3) for f in track])
    mean = arr[:, :, :2].mean(0)
    arr[:, :, :2] = mean + k * (arr[:, :, :2] - mean)
    return [list(np.round(f.reshape(-1), 4)) for f in arr]


def flail_pose() -> list:
    keys = []
    for _ in range(N // 3 + 2):
        f = np.array([[0.5, 0.3, 1], [0.42, 0.45, 1], [0.58, 0.45, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]], float)
        f[0, :2] += rng.normal(0, 0.04, 2)
        for j in range(3, 7):
            f[j, :2] = f[1 + (j % 2 == 0), :2] + rng.uniform(-0.2, 0.2, 2)
        keys.append(f)
    out = []
    for i in range(N):
        a, b, t = keys[i // 3], keys[i // 3 + 1], (i % 3) / 3
        out.append(list(np.round(((1 - t) * a + t * b).reshape(-1), 4)))
    return out


def face_copy(char: str) -> list:
    """Copies the actor's face while on screen (labels mirrored), relaxes toward neutral between."""
    tr = REF["face"][char]
    out, last, since = [], None, 99
    for f in (list(tr) + [None] * N)[:N]:
        if f:
            last, since = np.asarray(f, dtype=float), 0
            v = last
        else:
            since += 1
            k = 0.0 if last is None else float(np.exp(-since / 8))
            v = NEUTRAL if last is None else k * last + (1 - k) * NEUTRAL
        out.append(list(np.round(swap_face(v), 3)))
    return out


def swap_face(v: np.ndarray) -> np.ndarray:
    w = np.asarray(v, dtype=float).copy()
    for i, n in enumerate(BLENDSHAPES):
        if n.endswith("Left"):
            j = BLENDSHAPES.index(n.replace("Left", "Right"))
            w[i], w[j] = v[j], v[i]
    return w


NEUTRAL = np.full(len(BLENDSHAPES), 0.03)
NEUTRAL[[BLENDSHAPES.index("eyeSquintLeft"), BLENDSHAPES.index("eyeSquintRight")]] = 0.12


def face_perturb(track: list, lp: float, white: float) -> list:
    arr = np.array(track, dtype=float)
    arr += lowpass_noise(arr.shape, lp) + rng.normal(0, white, arr.shape)
    return [list(np.round(np.clip(f, 0, 1), 3)) for f in arr]


def face_const(vec: np.ndarray, jitter: float) -> list:
    return [list(np.round(np.clip(vec + rng.normal(0, jitter, len(vec)), 0, 1), 3)) for _ in range(N)]


def face_random() -> list:
    keys = rng.uniform(0, 0.7, (N // 3 + 2, len(BLENDSHAPES)))
    return [list(np.round(keys[i // 3], 3)) for i in range(N)]


# --------------------------------------------------------------------------- visual players

def visual_players() -> dict[str, list[dict]]:
    perfect = [{"pose": pose_copy(c), "face": face_copy(c)} for c in CHARS]
    late = [{"pose": shift(p["pose"], 4), "face": shift(p["face"], 4)} for p in perfect]
    noisy = [{"pose": perturb_pose(p["pose"], 0.12, 0.015), "face": face_perturb(p["face"], 0.10, 0.03)}
             for p in perfect]
    statue = [{"pose": [p["pose"][0]] * N, "face": face_const(NEUTRAL, 0.004)} for p in perfect]
    over = [{"pose": exaggerate_pose(p["pose"], 3.0), "face": face_const(np.full(len(BLENDSHAPES), 0.6), 0.04)}
            for p in perfect]
    flail = [{"pose": flail_pose(), "face": face_random()} for _ in CHARS]
    weak = [{"pose": perturb_pose(p["pose"], 0.30, 0.03), "face": face_perturb(p["face"], 0.18, 0.05)}
            for p in perfect]
    return {"perfect": perfect, "late": late, "noisy": noisy, "weak": weak, "statue": statue,
            "over-actor": over, "flailer": flail}


# --------------------------------------------------------------------------- audio takes

# What Whisper base.en actually heard from the film audio (with its slips), spread over each line.
FILM_HEARD = [
    ("All of us have failed your test.", 0), ("I have it.", 1),
    ("Somebody get these beggars out of here!", 2), ("The door is all locked until the trial's over.", 3),
    ("The trial is over.", 4),
]


def words_over(text: str, start: float, end: float) -> list[dict]:
    ws = text.split()
    step = (end - start) / max(1, len(ws))
    return [{"text": w, "start": round(start + i * step, 2), "end": round(start + (i + 1) * step, 2)}
            for i, w in enumerate(ws)]


def film_words(offset: float = 0.0) -> list[dict]:
    out = []
    for text, li in FILM_HEARD:
        line = SCENE["lines"][li]
        out += words_over(text, line["start"] + offset, line["end"] + offset)
    return out


def tts_take(tmp: Path, only: set[int] | None = None) -> tuple[np.ndarray, list[dict]] | None:
    if os.name != "nt":
        return None
    y = np.zeros(int(SCENE["duration"] * SR) + SR, dtype=np.float32)
    heard = []
    for i, line in enumerate(SCENE["lines"]):
        if only is not None and i not in only:
            continue
        wav = tmp / f"tts{i}.wav"
        if not wav.exists():
            ps = ("Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
                  f"$s.SetOutputToWaveFile('{wav}'); $s.Speak(\"{line['text']}\"); $s.Dispose()")
            r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)
            if r.returncode != 0 or not wav.exists():
                return None
        seg = decode_audio(wav)
        a = int(line["start"] * SR)
        seg = seg[: len(y) - a]
        y[a:a + len(seg)] += seg
        heard += words_over(line["text"], line["start"], line["start"] + len(seg) / SR)
    return y, heard


def audio_takes() -> dict[str, tuple[dict, list[dict]]]:
    takes = {}
    dur = SCENE["duration"]
    if CLIP.exists():
        film = decode_audio(CLIP)
        takes["film audio"] = (audio_contours(film), film_words())
        late = np.concatenate([np.zeros(int(0.4 * SR), np.float32), film])
        takes["film +0.4s"] = (audio_contours(late), film_words(0.4))
    else:
        print(f"! {CLIP} missing; skipping film-audio takes")
    tmp = Path(tempfile.gettempdir()) / "odyssey_scoring_tts"
    tmp.mkdir(exist_ok=True)
    tts = tts_take(tmp)
    if tts is not None:
        takes["TTS reading"] = (audio_contours(tts[0]), tts[1])
        half = tts_take(tmp, only={0, 2, 4})
        takes["TTS half lines"] = (audio_contours(half[0]), half[1])
    else:
        print("! Windows TTS unavailable; skipping TTS take")
    t = np.arange(int(dur * SR)) / SR
    takes["hum"] = (audio_contours((0.2 * np.sin(2 * np.pi * 150 * t)).astype(np.float32)), [])
    takes["silence"] = (audio_contours(rng.normal(0, 1e-4, int(dur * SR)).astype(np.float32)), [])
    return takes


# --------------------------------------------------------------------------- run

def judge_audio(contours: dict, heard: list[dict]) -> tuple[dict, dict]:
    athena = scoring.judge_athena(SCENE, heard)
    has_times = any(w.get("start") is not None for w in heard)
    return athena, scoring.judge_apollo(SCENE, contours, athena, has_times)


def main() -> int:
    failures = []

    def check(label: str, cond: bool):
        print(f"  [{'ok' if cond else 'FAIL'}] {label}")
        if not cond:
            failures.append(label)

    vis = visual_players()
    vres = {k: (scoring.judge_ares(SCENE, ASSIGN, p), scoring.judge_aphrodite(SCENE, ASSIGN, p))
            for k, p in vis.items()}
    print("\nVISUALS                 Ares  Aphrodite   (per character Ares | Aphrodite)")
    for k, (ar, af) in vres.items():
        print(f"  {k:20s} {ar['score']:5d} {af['score']:9d}    {ar['per_character']} | {af['per_character']}")
        print(f"  {'':20s} raw ares {ar.get('raw')}  aphro {af.get('raw')}")

    ares = {k: v[0]["score"] for k, v in vres.items()}
    aph = {k: v[1]["score"] for k, v in vres.items()}
    check("Ares: perfect > late > noisy", ares["perfect"] > ares["late"] > ares["noisy"])
    check("Ares: noisy > statue, flailer, over-actor",
          all(ares["noisy"] > ares[k] for k in ("statue", "flailer", "over-actor")))
    check("Aphrodite: perfect > late > noisy", aph["perfect"] > aph["late"] > aph["noisy"])
    check("Aphrodite: noisy > statue, flailer, over-actor",
          all(aph["noisy"] > aph[k] for k in ("statue", "flailer", "over-actor")))
    check("calibration: perfect visuals >= 85", ares["perfect"] >= 85 and aph["perfect"] >= 85)
    check("calibration: statue visuals <= 15", ares["statue"] <= 15 and aph["statue"] <= 15)
    check("calibration: flailer visuals <= 35, over-actor face <= 35",
          ares["flailer"] <= 35 and aph["flailer"] <= 35 and aph["over-actor"] <= 35)

    takes = audio_takes()
    ares_res = {}
    print("\nAUDIO                   Athena  Apollo")
    for k, (contours, heard) in takes.items():
        ath, apo = judge_audio(contours, heard)
        ares_res[k] = (ath, apo)
        print(f"  {k:20s} {ath['score']:6d} {apo['score']:7d}   raw athena {ath.get('raw')} apollo {apo.get('raw')} {apo.get('parts', '')}")
    sc = {k: v[0]["score"] + v[1]["score"] for k, v in ares_res.items()}
    apo = {k: v[1]["score"] for k, v in ares_res.items()}
    if "film audio" in sc and "TTS reading" in sc:
        check("audio: film > TTS > hum >= silence (Athena+Apollo)",
              sc["film audio"] > sc["TTS reading"] > sc["hum"] >= sc["silence"])
        check("Apollo: film > TTS", apo["film audio"] > apo["TTS reading"])
        check("Athena forgives STT slips on film audio (>= 85)", ares_res["film audio"][0]["score"] >= 85)
    check("Apollo: hum <= 10 and silence == 0", apo["hum"] <= 10 and apo["silence"] == 0)
    check("Athena: hum/silence == 0", ares_res["hum"][0]["score"] == 0 and ares_res["silence"][0]["score"] == 0)

    # Combined performances -> total
    combos = {
        "perfect": ("perfect", "film audio"), "late": ("late", "film +0.4s"),
        "noisy amateur": ("noisy", "TTS reading"), "over-actor": ("over-actor", "TTS reading"),
        "half lines, weak": ("weak", "TTS half lines"), "great face, no lines": ("perfect", "silence"),
        "statue (humming)": ("statue", "hum"), "flailer (silent)": ("flailer", "silence"),
    }
    totals = {}
    print("\nTOTAL                   Athena Apollo  Ares  Aphro   score  kleos  rank")
    for name, (v, a) in combos.items():
        if a not in ares_res:
            continue
        j = {"athena": ares_res[a][0], "apollo": ares_res[a][1], "ares": vres[v][0], "aphrodite": vres[v][1]}
        t = scoring.total(j)
        totals[name] = t["score"]
        print(f"  {name:20s} {j['athena']['score']:6d} {j['apollo']['score']:6d} {j['ares']['score']:5d}"
              f" {j['aphrodite']['score']:6d}  {t['score']:6d} {t['kleos']:6d}  {t['rank']}")
    if len(totals) == len(combos):
        check("total: perfect > late > noisy amateur",
              totals["perfect"] > totals["late"] > totals["noisy amateur"])
        check("total: noisy amateur > over-actor, statue, flailer",
              all(totals["noisy amateur"] > totals[k] for k in ("over-actor", "statue (humming)", "flailer (silent)")))
        kl = {k: v * 10 for k, v in totals.items()}
        check("kleos: near-perfect >= 900", kl["perfect"] >= 900)
        check("kleos: good imitation (late) >= 750", kl["late"] >= 750)
        check("kleos: half lines + weak acting 400-550", 400 <= kl["half lines, weak"] <= 550)
        check("kleos: missed everything <= 150 (statue, flailer, great face with no lines)",
              all(kl[k] <= 150 for k in ("statue (humming)", "flailer (silent)", "great face, no lines")))

    # Old scenes without reference must still score
    old = json.loads((ROOT / "scenes" / "my-name-is-noman.json").read_text(encoding="utf-8"))
    pl = [{"pose": flail_pose(), "face": face_random()}, {"pose": [None] * N, "face": [None] * N}]
    a = {"polyphemus": 0, "odysseus": 1}
    ath = scoring.judge_athena(old, words_over(old["lines"][0]["text"], old["lines"][0]["start"], old["lines"][0]["end"]))
    t = np.arange(int(20 * SR)) / SR
    apo_old = scoring.judge_apollo(old, audio_contours((0.2 * np.sin(2 * np.pi * (150 + 40 * np.sin(t)) * t)).astype(np.float32)), ath, True)
    ar_old, af_old = scoring.judge_ares(old, a, pl), scoring.judge_aphrodite(old, a, pl)
    print(f"\nOLD SCENE (no reference): athena {ath['score']} apollo {apo_old['score']} "
          f"ares {ar_old['score']} aphrodite {af_old['score']}")
    check("old scene path runs and returns 0-100 scores",
          all(0 <= x["score"] <= 100 for x in (ath, apo_old, ar_old, af_old)))

    print(f"\n{'ALL CHECKS PASSED' if not failures else f'{len(failures)} CHECK(S) FAILED'}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
