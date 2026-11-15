"""Feature definitions shared by the live scorer and the offline scene preprocessor.

Both sides MUST produce identical shapes:
  * pose frame  -> 7 upper-body landmarks [x, y, visibility] flattened (21 floats),
                   image-normalized coordinates as the audience sees them (webcam is
                   mirrored, film is not), or None. 14-float legacy frames are accepted.
  * face frame  -> one float per name in BLENDSHAPES, or None.
  * audio       -> pitch (semitones, NaN when unvoiced) and energy (dB) at FEATURE_FPS.
"""
from __future__ import annotations

import math
import subprocess
from pathlib import Path

import numpy as np

FEATURE_FPS = 10

# Pose similarity = 100/(1+(d/POSE_SCALE)^2), d in shoulder widths. MUST match POSE_SCALE in
# frontend/src/stage/pose.js so the live meter agrees with the final grade.
POSE_SCALE = 0.55

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
#
# Pose frame contract (shared with frontend/src/vision.js):
#   7 landmarks (POSE_INDICES) x [x, y, visibility] = 21 floats, or None.
#   Legacy 14-float frames (no visibility) are read as visibility = 1.
#
# Comparisons happen in SCREEN order, not anatomical order: a film actor faces the camera
# (their left shoulder is on screen-right) while the webcam view is mirrored (the player's
# left shoulder is on screen-left). A player copying the screen therefore matches the actor's
# geometry with swapped labels, so each L/R pair is re-ordered so that "left" = smaller x.

VIS_MIN = 0.5
_LR_PAIRS = [(1, 2), (3, 4), (5, 6)]  # shoulders, elbows, wrists (positions within POSE_INDICES)


def pose_points(frame) -> tuple[np.ndarray, np.ndarray] | None:
    """Raw frame -> (points (7,2), visibility (7,)) or None."""
    if not frame:
        return None
    a = np.asarray(frame, dtype=float)
    if a.size == 21:
        a = a.reshape(7, 3)
        return a[:, :2], a[:, 2]
    if a.size == 14:
        return a.reshape(7, 2), np.ones(7)
    return None


def normalize_pose_frame(frame) -> tuple[np.ndarray, np.ndarray] | None:
    """Body-relative, screen-ordered points: origin shoulder midpoint, unit shoulder width."""
    pv = pose_points(frame)
    if pv is None:
        return None
    pts, vis = pv[0].copy(), pv[1].copy()
    if pts[1, 0] > pts[2, 0]:  # put the screen-left shoulder (and its arm) first
        for a, b in _LR_PAIRS:
            pts[[a, b]] = pts[[b, a]]
            vis[[a, b]] = vis[[b, a]]
    ls, rs = pts[1], pts[2]
    width = np.linalg.norm(ls - rs)
    if width < 1e-3:
        return None
    return (pts - (ls + rs) / 2) / width, vis


def pose_frame_distance(a, b) -> float | None:
    """Mean landmark distance (shoulder widths) over landmarks visible in BOTH frames.

    a, b are outputs of normalize_pose_frame. None when fewer than 3 landmarks are comparable.
    """
    if a is None or b is None:
        return None
    mask = (a[1] > VIS_MIN) & (b[1] > VIS_MIN)
    if mask.sum() < 3:
        return None
    return float(np.linalg.norm(a[0][mask] - b[0][mask], axis=1).mean())


def pose_similarity(d: float) -> float:
    """Contract formula, mirrored by the frontend's live meter."""
    return float(min(100.0, max(0.0, 100.0 / (1.0 + (d / POSE_SCALE) ** 2))))


def pose_angles(n: tuple[np.ndarray, np.ndarray]) -> tuple[float, float, float] | None:
    """(shoulder roll, head tilt, head height) from a normalize_pose_frame() result.

    roll   = angle of the shoulder line vs horizontal (radians)
    tilt   = sideways lean of the head relative to the shoulders' "up" direction (radians)
    height = how far the nose sits above the shoulder line, in shoulder widths (bow / chin up)
    These survive close-ups where only nose + shoulders are visible.
    """
    pts, vis = n
    if vis[0] <= VIS_MIN or vis[1] <= VIS_MIN or vis[2] <= VIS_MIN:
        return None
    u = pts[2] - pts[1]
    u = u / (np.linalg.norm(u) + 1e-9)
    up = np.array([u[1], -u[0]])  # perpendicular pointing toward the head (image y grows down)
    nose = pts[0]
    roll = float(np.arctan2(u[1], u[0]))
    tilt = float(np.arctan2(nose @ u, nose @ up + 1e-9))
    return roll, tilt, float(nose @ up)


def pose_visible_count(a, b) -> int:
    return int(((a[1] > VIS_MIN) & (b[1] > VIS_MIN)).sum())


def pose_motion(frames: list) -> np.ndarray:
    """Per-frame movement magnitude (shoulder widths per frame), NaN where unknown.

    Combines landmark displacement in the body frame, head/shoulder angle changes and a damped
    whole-body translation term. Used to check players move when (and as much as) the actor does.
    """
    n = len(frames)
    out = np.full(n, np.nan)
    prev = prev_raw = None
    for i, f in enumerate(frames):
        cur = normalize_pose_frame(f)
        raw = pose_points(f)
        if cur is not None and prev is not None:
            mask = (cur[1] > VIS_MIN) & (prev[1] > VIS_MIN)
            if mask.sum() >= 3:
                disp = float(np.linalg.norm(cur[0][mask] - prev[0][mask], axis=1).mean())
                ang_c, ang_p = pose_angles(cur), pose_angles(prev)
                ang = 0.0
                if ang_c and ang_p:
                    ang = abs(ang_c[0] - ang_p[0]) + abs(ang_c[1] - ang_p[1]) + abs(ang_c[2] - ang_p[2])
                w = np.linalg.norm(raw[0][1] - raw[0][2]) + 1e-6
                root = np.linalg.norm(((raw[0][1] + raw[0][2]) - (prev_raw[0][1] + prev_raw[0][2])) / 2) / w
                out[i] = disp + 0.5 * ang + 0.3 * min(root, 1.0)
        prev, prev_raw = (cur, raw) if cur is not None else (None, None)
    return out


# Face blendshapes: pairs whose Left/Right labels flip when a player mirrors an on-screen actor.
_BS_LR = [(BLENDSHAPES.index(a), BLENDSHAPES.index(a.replace("Left", "Right")))
          for a in BLENDSHAPES if a.endswith("Left")]


def face_swap_lr(v: np.ndarray) -> np.ndarray:
    w = v.copy()
    for a, b in _BS_LR:
        w[a], w[b] = v[b], v[a]
    return w


def face_distance(a, b) -> float | None:
    if a is None or b is None or len(a) != len(b):
        return None
    return float(np.linalg.norm(np.asarray(a, dtype=float) - np.asarray(b, dtype=float)))


def face_similarity(d: float) -> float:
    return float(min(100.0, max(0.0, 100.0 / (1.0 + (d / 0.35) ** 2))))


def windowed_match(ref: list, player: list, prep, dist, sim, window: int = 6) -> list[float | None]:
    """Score each reference frame against the best player frame within +/- window frames.

    Returns one entry per reference frame: None where the reference has nothing to compare
    (character off screen / unusable), 0 where the player was missing, else the best similarity.
    The window tolerates the player reacting a little late or early.
    """
    ref_n = [prep(f) for f in ref]
    pl_n = [prep(f) for f in player]
    out: list[float | None] = []
    for i, r in enumerate(ref_n):
        if r is None or (isinstance(r, tuple) and (r[1] > VIS_MIN).sum() < 3):
            out.append(None)
            continue
        best = None
        for j in range(max(0, i - window), min(len(pl_n), i + window + 1)):
            d = dist(r, pl_n[j])
            if d is not None and (best is None or d < best):
                best = d
        out.append(0.0 if best is None else sim(best))
    return out


def normalize_pose_seq(frames: list) -> np.ndarray:
    """(N, 14) screen-ordered normalized x,y per frame; NaN rows where missing."""
    out = np.full((len(frames), len(POSE_INDICES) * 2), np.nan)
    for i, f in enumerate(frames):
        n = normalize_pose_frame(f)
        if n is not None:
            out[i] = n[0].reshape(-1)
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

ENERGY_FLOOR_DB = -50.0  # ~0.003 RMS; quieter frames never count as voice


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
    # Voiced = loud relative to the take's own peaks AND above an absolute floor, so mic hiss
    # or room tone in a silent take is not mistaken for a voice.
    voiced = (energy > (np.percentile(energy, 90) - 25)) & (energy > ENERGY_FLOOR_DB)
    pitch = np.where(voiced, 12 * np.log2(f0 / 55.0), np.nan)
    speech = voiced
    # Hook for robust speech-vs-noise detection (feature/voice-activity adds backend/voice.py).
    # TODO: drop the fallback once voice.py is merged everywhere.
    try:
        from voice import speech_mask  # type: ignore

        m = np.asarray(speech_mask(y, sr), dtype=bool)
        speech = np.zeros(n, dtype=bool)
        speech[: min(n, len(m))] = m[:n]
    except ImportError:
        pass
    except Exception:  # noqa: BLE001 - a broken detector must not break scoring
        speech = voiced
    return {
        "pitch": [None if math.isnan(v) else round(float(v), 2) for v in pitch],
        "energy": [round(float(v), 2) for v in energy],
        "speech": [bool(v) for v in speech],
    }
