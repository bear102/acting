"""Feature definitions shared by the live scorer and the offline scene preprocessor.

Both sides MUST produce identical shapes:
  * pose frame  -> 7 upper-body landmarks [x, y] flattened (14 floats), image-normalized
                   coordinates as the audience sees them (webcam is mirrored), or None.
  * face frame  -> one float per name in BLENDSHAPES, or None.
  * audio       -> pitch (semitones, NaN when unvoiced) and energy (dB) at FEATURE_FPS.
"""
from __future__ import annotations

import math
import subprocess
from pathlib import Path

import numpy as np

FEATURE_FPS = 10

# MediaPipe pose indices: nose, L/R shoulder, L/R elbow, L/R wrist.
# Hips are skipped on purpose: webcam players are usually framed from the waist up.
POSE_INDICES = [0, 11, 12, 13, 14, 15, 16]

BLENDSHAPES = [
    "browDownLeft", "browDownRight", "browInnerUp", "browOuterUpLeft", "browOuterUpRight",
    "eyeSquintLeft", "eyeSquintRight", "eyeWideLeft", "eyeWideRight", "jawOpen",
    "mouthFrownLeft", "mouthFrownRight", "mouthSmileLeft", "mouthSmileRight", "mouthPucker",
    "mouthPressLeft", "mouthPressRight", "noseSneerLeft", "noseSneerRight", "cheekSquintLeft",
    "cheekSquintRight",
]
_BS_INDEX = {n: i for i, n in enumerate(BLENDSHAPES)}

# Target facial "shape" for each emotion a line can ask for (weights over BLENDSHAPES).
EMOTION_TEMPLATES: dict[str, dict[str, float]] = {
    "rage": {"browDownLeft": 1, "browDownRight": 1, "noseSneerLeft": .7, "noseSneerRight": .7,
             "eyeSquintLeft": .5, "eyeSquintRight": .5, "jawOpen": .5, "mouthPressLeft": .3, "mouthPressRight": .3},
    "fear": {"browInnerUp": 1, "eyeWideLeft": 1, "eyeWideRight": 1, "jawOpen": .6, "browOuterUpLeft": .4, "browOuterUpRight": .4},
    "joy": {"mouthSmileLeft": 1, "mouthSmileRight": 1, "cheekSquintLeft": .6, "cheekSquintRight": .6,
            "eyeSquintLeft": .3, "eyeSquintRight": .3},
    "sorrow": {"browInnerUp": 1, "mouthFrownLeft": 1, "mouthFrownRight": 1, "mouthPressLeft": .3, "mouthPressRight": .3},
    "cunning": {"mouthSmileLeft": .8, "mouthSmileRight": .4, "eyeSquintLeft": .7, "eyeSquintRight": .7,
                "browDownLeft": .3, "browDownRight": .3},
    "awe": {"eyeWideLeft": 1, "eyeWideRight": 1, "browOuterUpLeft": .8, "browOuterUpRight": .8,
            "browInnerUp": .5, "jawOpen": .7},
    "resolve": {"browDownLeft": .8, "browDownRight": .8, "mouthPressLeft": .8, "mouthPressRight": .8,
                "eyeSquintLeft": .3, "eyeSquintRight": .3},
    "longing": {"browInnerUp": 1, "mouthFrownLeft": .4, "mouthFrownRight": .4, "eyeSquintLeft": .2, "eyeSquintRight": .2},
}


def emotion_vector(emotion: str | None) -> np.ndarray | None:
    tpl = EMOTION_TEMPLATES.get((emotion or "").lower())
    if not tpl:
        return None
    v = np.zeros(len(BLENDSHAPES))
    for name, w in tpl.items():
        v[_BS_INDEX[name]] = w
    return v / np.linalg.norm(v)


# --------------------------------------------------------------------------- pose / face

def normalize_pose_seq(frames: list) -> np.ndarray:
    """Turn raw pose frames into body-relative coordinates.

    Origin = shoulder midpoint, unit = shoulder width, so distance to camera and
    where the player stands stop mattering. Missing frames become NaN rows.
    """
    out = np.full((len(frames), len(POSE_INDICES) * 2), np.nan)
    for i, f in enumerate(frames):
        if not f:
            continue
        p = np.asarray(f, dtype=float).reshape(-1, 2)
        ls, rs = p[1], p[2]
        width = np.linalg.norm(ls - rs)
        if width < 1e-3:
            continue
        out[i] = ((p - (ls + rs) / 2) / width).reshape(-1)
    return out


def face_seq(frames: list) -> np.ndarray:
    out = np.full((len(frames), len(BLENDSHAPES)), np.nan)
    for i, f in enumerate(frames):
        if f and len(f) == len(BLENDSHAPES):
            out[i] = f
    return out


def fill_gaps(seq: np.ndarray) -> np.ndarray:
    """Linear-interpolate NaN rows; returns empty array if nothing valid."""
    valid = ~np.isnan(seq).any(axis=1)
    if valid.sum() == 0:
        return seq[:0]
    if valid.all():
        return seq
    idx = np.arange(len(seq))
    out = seq.copy()
    for c in range(seq.shape[1]):
        out[:, c] = np.interp(idx, idx[valid], seq[valid, c])
    return out


def coverage(seq: np.ndarray) -> float:
    if len(seq) == 0:
        return 0.0
    return float((~np.isnan(seq).any(axis=1)).mean())


def dtw_distance(a: np.ndarray, b: np.ndarray, band_frac: float = 0.25) -> float:
    """Mean per-step Euclidean distance along the best DTW path (Sakoe-Chiba band)."""
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return float("inf")
    cost = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).sum(-1))
    band = max(int(max(n, m) * band_frac), abs(n - m) + 2)
    acc = np.full((n + 1, m + 1), np.inf)
    steps = np.zeros((n + 1, m + 1))
    acc[0, 0] = 0.0
    for i in range(1, n + 1):
        center = i * m / n
        lo, hi = max(1, int(center - band)), min(m, int(center + band) + 1)
        for j in range(lo, hi + 1):
            choices = (acc[i - 1, j - 1], acc[i - 1, j], acc[i, j - 1])
            k = int(np.argmin(choices))
            prev = (steps[i - 1, j - 1], steps[i - 1, j], steps[i, j - 1])[k]
            acc[i, j] = cost[i - 1, j - 1] + choices[k]
            steps[i, j] = prev + 1
    if not np.isfinite(acc[n, m]):
        return float("inf")
    return float(acc[n, m] / steps[n, m])


def downsample(seq: np.ndarray, max_len: int = 240) -> np.ndarray:
    if len(seq) <= max_len:
        return seq
    idx = np.linspace(0, len(seq) - 1, max_len).round().astype(int)
    return seq[idx]


# --------------------------------------------------------------------------- audio

def ffmpeg_exe() -> str:
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def decode_audio(path: str | Path, sr: int = 16000, start: float | None = None,
                 end: float | None = None) -> np.ndarray:
    """Decode any audio/video file to mono float32 PCM via the bundled ffmpeg."""
    cmd = [ffmpeg_exe(), "-v", "error"]
    if start is not None:
        cmd += ["-ss", f"{start:.3f}"]
    cmd += ["-i", str(path)]
    if end is not None:
        cmd += ["-t", f"{(end - (start or 0)):.3f}"]
    cmd += ["-vn", "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"]
    raw = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()


def audio_contours(y: np.ndarray, sr: int = 16000) -> dict:
    """Pitch (semitones re 55Hz, NaN when unvoiced) and energy (dB) at FEATURE_FPS."""
    import librosa

    hop = sr // FEATURE_FPS
    if len(y) < hop * 2:
        return {"pitch": [], "energy": []}
    rms = librosa.feature.rms(y=y, frame_length=hop * 2, hop_length=hop, center=True)[0]
    energy = 20 * np.log10(rms + 1e-6)
    f0 = librosa.yin(y, fmin=70, fmax=500, sr=sr, frame_length=2048, hop_length=hop)
    n = min(len(f0), len(energy))
    f0, energy = f0[:n], energy[:n]
    voiced = energy > (np.percentile(energy, 90) - 25)
    pitch = np.where(voiced, 12 * np.log2(f0 / 55.0), np.nan)
    return {
        "pitch": [None if math.isnan(v) else round(float(v), 2) for v in pitch],
        "energy": [round(float(v), 2) for v in energy],
    }
