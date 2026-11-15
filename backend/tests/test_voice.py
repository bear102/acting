"""Voice-activity checks. Run:  ..\\.venv\\Scripts\\python backend\\tests\\test_voice.py [path\\to\\film.mp4]

Synthesizes speech with Windows SAPI (System.Speech) and compares speech_mask() against ground
truth for: clean TTS, TTS over noise, pink noise, a 150 Hz hum, music-like chords, silence,
crowd babble (alone and under a foreground voice) and the film clip's known dialogue windows.
Runs both the Silero engine and the spectral fallback.
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import voice  # noqa: E402
from features import decode_audio  # noqa: E402

SR = 16000
FPS = 10
DUR = 20.0
FILM_DIALOGUE = [(1.66, 3.96), (5.0, 6.0), (9.8, 12.54), (13.6, 16.12), (16.52, 18.0)]
DEFAULT_FILM = Path(r"C:\Users\ericw\OneDrive\Desktop\UT Stuff\hackUTA 26\acting\scenes\media\beggar-in-the-hall.mp4")
SENTENCES = [
    "All of us who failed your test.",
    "I haven't.",
    "Did somebody get these beggars out of here?",
    "The door's unlocked until the trial's over.",
    "The trial is over.",
]

rng = np.random.default_rng(7)
_tmp = Path(tempfile.mkdtemp(prefix="vad_test_"))


def tts(text: str, voice_idx: int = 0, rate: int = 0) -> np.ndarray:
    """Windows SAPI text-to-speech -> mono float32 at 16 kHz, silence-trimmed."""
    out = _tmp / f"tts_{abs(hash((text, voice_idx, rate)))}.wav"
    if not out.exists():
        ps = (
            "Add-Type -AssemblyName System.Speech;"
            "$s=New-Object System.Speech.Synthesis.SpeechSynthesizer;"
            f"$v=$s.GetInstalledVoices(); if($v.Count -gt {voice_idx}){{$s.SelectVoice($v[{voice_idx}].VoiceInfo.Name)}};"
            f"$s.Rate={rate};"
            f"$s.SetOutputToWaveFile('{out}');"
            f"$s.Speak(\"{text}\");$s.Dispose()"
        )
        subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True, capture_output=True)
    y = decode_audio(out)
    a = np.abs(y)
    idx = np.where(a > 0.02 * a.max())[0]
    return y[idx[0]: idx[-1] + 1] if len(idx) else y


def place(clips: list[tuple[float, np.ndarray]], dur: float = DUR) -> tuple[np.ndarray, np.ndarray]:
    """Mix clips at start times; returns (audio, ground-truth bool mask at FPS)."""
    y = np.zeros(int(dur * SR), dtype=np.float32)
    truth = np.zeros(int(dur * FPS), dtype=bool)
    for t, c in clips:
        a = int(t * SR)
        c = c[: len(y) - a]
        y[a: a + len(c)] += c
        truth[int(t * FPS): int(np.ceil((t + len(c) / SR) * FPS))] = True
    return y, truth


def pink(n: int, level: float) -> np.ndarray:
    white = rng.standard_normal(n)
    f = np.fft.rfft(white)
    f /= np.sqrt(np.maximum(np.arange(len(f)), 1))
    p = np.fft.irfft(f, n)
    return (p / np.abs(p).max() * level).astype(np.float32)


def chords(n: int) -> np.ndarray:
    t = np.arange(n) / SR
    y = np.zeros(n)
    roots = [220.0, 261.6, 196.0, 174.6]
    for k, r in enumerate(roots):  # four 5 s chords, harmonic tones with soft attack
        seg = (t >= k * 5) & (t < (k + 1) * 5)
        for ratio in (1, 1.25, 1.5, 2):
            for h in range(1, 6):
                y[seg] += np.sin(2 * np.pi * r * ratio * h * t[seg]) / h
    env = 0.5 + 0.5 * np.sin(2 * np.pi * 0.2 * t - np.pi / 2)
    return (y / np.abs(y).max() * 0.3 * (0.4 + 0.6 * env)).astype(np.float32)


def babble(n: int, level: float) -> np.ndarray:
    """Several overlapping voices at once, like a crowded hall."""
    y = np.zeros(n, dtype=np.float32)
    for k in range(6):
        s = tts(SENTENCES[k % len(SENTENCES)] + " " + SENTENCES[(k + 2) % len(SENTENCES)],
                voice_idx=k % 2, rate=(k % 3) - 1)
        t = 0
        while t < n:
            off = t + int(rng.uniform(0, 1.5) * SR)
            seg = s[: max(0, n - off)]
            y[off: off + len(seg)] += seg
            t = off + len(s)
    return (y / (np.abs(y).max() + 1e-9) * level).astype(np.float32)


def score(mask: np.ndarray, truth: np.ndarray) -> tuple[float, float, float]:
    n = min(len(mask), len(truth))
    m, t = mask[:n], truth[:n]
    tp = (m & t).sum()
    prec = tp / m.sum() if m.sum() else float("nan")
    rec = tp / t.sum() if t.sum() else float("nan")
    return prec, rec, m.mean()


def build_cases(film: Path | None):
    n = int(DUR * SR)
    clean_clips = [(1.0 + 3.6 * i, tts(s)) for i, s in enumerate(SENTENCES)]
    clean, truth = place(clean_clips)
    none = np.zeros(int(DUR * FPS), dtype=bool)
    cases = [
        ("clean TTS", clean, truth, "recall>0.85"),
        ("TTS + pink noise (-20dB)", clean + pink(n, 0.03), truth, "recall>0.85"),
        ("TTS + chords", clean + chords(n) * 0.5, truth, "recall>0.75"),
        ("pink noise", pink(n, 0.2), none, "ratio<0.1"),
        ("150 Hz hum", (0.3 * np.sin(2 * np.pi * 150 * np.arange(n) / SR)).astype(np.float32), none, "ratio<0.1"),
        ("music chords", chords(n), none, "ratio<0.1"),
        ("silence", np.zeros(n, dtype=np.float32), none, "ratio<0.1"),
        ("silence + mic hiss", pink(n, 0.003), none, "ratio<0.1"),
        ("babble alone (quiet)", babble(n, 0.05), none, "info"),
        ("TTS + quiet babble", clean + babble(n, 0.03), truth, "recall>0.85"),
    ]
    if film and film.exists():
        y = decode_audio(film)
        t = np.zeros(int(np.ceil(len(y) / SR * FPS)), dtype=bool)
        for a, b in FILM_DIALOGUE:
            t[int(a * FPS): int(np.ceil(b * FPS))] = True
        # Ground truth = Whisper word timestamps, whose word onsets run early (e.g. "Did" at 9.8s
        # while the voice starts ~10.9s). Reported against the 0.75 target but not gating.
        cases.append(("film clip dialogue", y, t, "info: rec>.75"))
    return cases


def check(target: str, prec: float, rec: float, ratio: float) -> bool:
    if target == "info":
        return True
    if target.startswith("info:"):
        return rec > 0.75
    if target.startswith("recall"):
        return rec > float(target.split(">")[1])
    if target.startswith("ratio"):
        return ratio < float(target.split("<")[1])
    return True


def run(engine: str, cases) -> bool:
    if engine == "spectral":
        voice._silero.cache_clear()
        orig = voice._silero_probs
        voice._silero_probs = lambda y16: None
    ok_all = True
    print(f"\n=== engine: {engine} ===")
    print(f"{'case':28s} {'prec':>5s} {'recall':>6s} {'ratio':>6s} {'ms':>5s}  target       result")
    for name, y, truth, target in cases:
        t0 = time.perf_counter()
        mask = voice.speech_mask(y, SR, FPS)
        ms = (time.perf_counter() - t0) * 1000
        prec, rec, ratio = score(mask, truth)
        ok = check(target, prec, rec, ratio)
        ok_all &= ok or target.startswith("info")
        f = lambda v: "  -  " if np.isnan(v) else f"{v:5.2f}"  # noqa: E731
        verdict = "ok" if ok else ("below (info)" if target.startswith("info") else "FAIL")
        print(f"{name:28s} {f(prec)} {f(rec):>6s} {ratio:6.2f} {ms:5.0f}  {target:13s} {verdict}")
    if engine == "spectral":
        voice._silero_probs = orig
    return ok_all


def main():
    film = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_FILM
    voice.speech_mask(np.zeros(SR, dtype=np.float32))  # load model once (excluded from timing)
    cases = build_cases(film)

    # API sanity
    m = np.array([0, 1, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 1], dtype=bool)
    assert voice.speech_segments(m, fps=10, min_gap=0.3, min_len=0.25) == [(0.1, 0.8)], voice.speech_segments(m)
    assert abs(voice.speech_ratio_in(m, 0.1, 0.4) - 1.0) < 1e-9
    assert voice.speech_ratio_in(m, 5, 6) == 0.0
    print("noise floor of pink noise:", voice.noise_floor_db(cases[3][1]), "dBFS;",
          "silence:", voice.noise_floor_db(cases[6][1]), "dBFS")

    film_case = next((c for c in cases if c[0] == "film clip dialogue"), None)
    if film_case:
        segs = voice.speech_segments(voice.speech_mask(film_case[1], SR, FPS))
        print("film speech segments:", segs)

    silero_ok = run("silero", cases)
    run("spectral", cases)  # informational: fallback quality
    print("\nSILERO TARGETS:", "PASS" if silero_ok else "FAIL")
    for f in _tmp.glob("*"):
        f.unlink()
    _tmp.rmdir()
    sys.exit(0 if silero_ok else 1)


if __name__ == "__main__":
    main()
