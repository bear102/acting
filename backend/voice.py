"""Voice activity detection: which moments of a recording contain a HUMAN VOICE.

Scoring must not mistake background noise, a hum or film music for "the player spoke".
Primary engine: the Silero VAD model that ships inside faster-whisper (ONNX, no download,
~1 ms per second of audio). Fallback when onnxruntime/faster-whisper is unavailable: a
spectral heuristic (adaptive noise floor + harmonicity + syllable-rate modulation).

Public API (scoring depends on these exact signatures):
    speech_mask(y, sr=16000, fps=10) -> bool array, one value per 1/fps second
    speech_ratio_in(mask, start_s, end_s, fps=10) -> float 0..1
    speech_segments(mask, fps=10, min_gap=0.3, min_len=0.25) -> [(start, end), ...]
    noise_floor_db(y, sr) -> float (dBFS)

Known behaviour: distant crowd babble IS human speech, so it is partly detected. To keep
it from counting as the player's voice, frames more than RELATIVE_GATE_DB quieter than the
recording's loudest speech are dropped - when a player speaks into the mic, background
chatter falls below that gate. Babble with no foreground voice at all is still reported
(at a reduced rate), since it is genuinely speech.
"""
from __future__ import annotations

import functools
import logging

import numpy as np

log = logging.getLogger("voice")

SILERO_SR = 16000
SILERO_WIN = 512  # samples per Silero decision (32 ms)
ON_THRESHOLD = 0.5  # hysteresis: enter speech above this probability
OFF_THRESHOLD = 0.35  # ...and stay in speech until below this
RELATIVE_GATE_DB = 28.0  # drop "speech" this much quieter than the loudest speech
ABSOLUTE_FLOOR_DBFS = -58.0  # anything quieter is silence, whatever the model says


# --------------------------------------------------------------------------- engines

@functools.lru_cache(maxsize=1)
def _silero():
    try:
        from faster_whisper.vad import get_vad_model

        return get_vad_model()
    except Exception as e:  # noqa: BLE001
        log.warning("Silero VAD unavailable, using spectral fallback: %s", e)
        return None


def _to_16k(y: np.ndarray, sr: int) -> np.ndarray:
    y = np.asarray(y, dtype=np.float32).reshape(-1)
    if sr != SILERO_SR:
        import librosa

        y = librosa.resample(y, orig_sr=sr, target_sr=SILERO_SR).astype(np.float32)
    return y


def _silero_probs(y16: np.ndarray) -> np.ndarray | None:
    """Speech probability per 32 ms window, or None if the model is unavailable."""
    model = _silero()
    if model is None:
        return None
    pad = (-len(y16)) % SILERO_WIN
    audio = np.pad(y16, (0, pad)).astype(np.float32)
    try:
        return np.asarray(model(audio), dtype=float).reshape(-1)
    except Exception as e:  # noqa: BLE001
        log.warning("Silero VAD failed, using spectral fallback: %s", e)
        return None


def _spectral_probs(y16: np.ndarray) -> np.ndarray:
    """Heuristic speech probability per 32 ms window (fallback engine)."""
    import librosa

    hop = SILERO_WIN
    n = int(np.ceil(len(y16) / hop))
    if n == 0:
        return np.zeros(0)
    y = np.pad(y16, (0, n * hop - len(y16) + hop))
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop, center=False)[0][:n]
    db = 20 * np.log10(rms + 1e-9)
    floor = np.percentile(db, 15)
    loud = np.clip((db - floor - 6) / 12, 0, 1)  # clearly above the noise floor

    flat = librosa.feature.spectral_flatness(y=y, n_fft=hop * 2, hop_length=hop, center=False)[0][:n]
    tonal = np.clip((0.25 - flat) / 0.2, 0, 1)  # noise is flat, voice is peaky

    # Voicing: periodicity in the speech pitch range
    f0, voiced, vprob = librosa.pyin(y, fmin=70, fmax=400, sr=SILERO_SR, frame_length=hop * 4,
                                     hop_length=hop, center=False)
    vprob = np.nan_to_num(vprob[:n]) if vprob is not None else np.zeros(n)
    # A steady hum is perfectly periodic but its pitch never moves; speech pitch wanders.
    f0 = np.nan_to_num(f0[:n])
    wander = np.zeros(n)
    k = 8  # ~0.25 s
    for i in range(n):
        seg = f0[max(0, i - k): i + k]
        seg = seg[seg > 0]
        if len(seg) > 3:
            wander[i] = np.clip(np.std(12 * np.log2(seg / seg.mean())) / 1.0, 0, 1)

    # Syllabic modulation: speech energy fluctuates at ~2-8 Hz; music/hum is steadier
    env = np.convolve(rms, np.ones(3) / 3, mode="same")
    mod = np.zeros(n)
    w = 16  # ~0.5 s
    for i in range(n):
        seg = env[max(0, i - w): i + w]
        if len(seg) > 4 and seg.mean() > 0:
            mod[i] = np.clip(seg.std() / seg.mean() / 0.5, 0, 1)

    m = min(len(loud), len(tonal), len(vprob), len(wander), len(mod))
    p = loud[:m] * (0.35 * tonal[:m] + 0.35 * vprob[:m] + 0.15 * wander[:m] + 0.15 * mod[:m]) * 1.4
    return np.pad(np.clip(p, 0, 1), (0, n - m))


# --------------------------------------------------------------------------- public API

def speech_mask(y: np.ndarray, sr: int = 16000, fps: int = 10) -> np.ndarray:
    """One bool per 1/fps second: True where a human voice is speaking."""
    y16 = _to_16k(y, sr)
    n_out = int(np.ceil(len(y16) / SILERO_SR * fps))
    if n_out == 0:
        return np.zeros(0, dtype=bool)

    probs = _silero_probs(y16)
    if probs is None:
        probs = _spectral_probs(y16)

    # Hysteresis on the 32 ms decisions
    active = np.zeros(len(probs), dtype=bool)
    on = False
    for i, p in enumerate(probs):
        on = p >= ON_THRESHOLD if not on else p >= OFF_THRESHOLD
        active[i] = on

    # Loudness gates (per 32 ms window)
    pad = (-len(y16)) % SILERO_WIN
    win = np.pad(y16, (0, pad)).reshape(-1, SILERO_WIN)[: len(active)]
    db = 20 * np.log10(np.sqrt((win.astype(np.float64) ** 2).mean(1)) + 1e-9)
    active &= db > ABSOLUTE_FLOOR_DBFS
    if active.any():
        loudest = np.percentile(db[active], 95)
        active &= db > loudest - RELATIVE_GATE_DB

    # Resample onto the fps grid: a frame is speech if most of its windows are
    t_win = (np.arange(len(active)) + 0.5) * SILERO_WIN / SILERO_SR
    idx = np.minimum((t_win * fps).astype(int), n_out - 1)
    hits = np.bincount(idx, weights=active.astype(float), minlength=n_out)
    counts = np.maximum(np.bincount(idx, minlength=n_out), 1)
    mask = hits / counts >= 0.5

    # Close tiny gaps inside words (<= 0.1 s) so syllable boundaries don't fragment speech
    if fps >= 5:
        for i in range(1, len(mask) - 1):
            if not mask[i] and mask[i - 1] and mask[i + 1]:
                mask[i] = True
    return mask


def speech_ratio_in(mask: np.ndarray, start_s: float, end_s: float, fps: int = 10) -> float:
    """Fraction of [start_s, end_s) that is speech (0 if the window is empty/outside)."""
    a = max(0, int(np.floor(start_s * fps)))
    b = min(len(mask), int(np.ceil(end_s * fps)))
    if b <= a:
        return 0.0
    return float(np.mean(mask[a:b]))


def speech_segments(mask: np.ndarray, fps: int = 10, min_gap: float = 0.3,
                    min_len: float = 0.25) -> list[tuple[float, float]]:
    """Contiguous speech regions in seconds, merging gaps < min_gap and dropping blips < min_len."""
    segs: list[list[float]] = []
    start = None
    for i, v in enumerate(list(mask) + [False]):
        if v and start is None:
            start = i
        elif not v and start is not None:
            segs.append([start / fps, i / fps])
            start = None
    merged: list[list[float]] = []
    for s in segs:
        if merged and s[0] - merged[-1][1] < min_gap:
            merged[-1][1] = s[1]
        else:
            merged.append(s)
    return [(round(a, 2), round(b, 2)) for a, b in merged if b - a >= min_len]


def noise_floor_db(y: np.ndarray, sr: int = 16000) -> float:
    """Background level in dBFS: the 10th percentile of 50 ms frame loudness."""
    y = np.asarray(y, dtype=np.float64).reshape(-1)
    hop = max(1, int(sr * 0.05))
    n = len(y) // hop
    if n == 0:
        return -120.0
    frames = y[: n * hop].reshape(n, hop)
    db = 20 * np.log10(np.sqrt((frames ** 2).mean(1)) + 1e-9)
    return round(float(np.percentile(db, 10)), 1)
