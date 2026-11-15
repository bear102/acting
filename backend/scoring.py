"""The Olympian panel. Each judge returns a 0-100 score plus a short factual note
that Gemini later turns into in-character commentary.

  Athena    - wisdom      - did you say the right words?
  Apollo    - art         - voice: timing, pitch and energy
  Ares      - war         - body: gestures and movement
  Aphrodite - passion     - face: the emotion of each line
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher

import numpy as np

from features import (
    FEATURE_FPS, coverage, downsample, dtw_distance, emotion_vector, face_seq, fill_gaps,
    normalize_pose_seq,
)

WEIGHTS = {"athena": 0.35, "apollo": 0.25, "ares": 0.20, "aphrodite": 0.20}

RANKS = [
    (90, "Equal to the Gods"),
    (78, "Favored of Athena"),
    (65, "Hero of Troy"),
    (50, "Oarsman of Ithaca"),
    (35, "Lotus-Eater"),
    (0, "Swine of Circe"),
]


def clamp(v: float, lo: float = 0, hi: float = 100) -> float:
    return float(max(lo, min(hi, v)))


def _norm_word(w: str) -> str:
    w = re.sub(r"[^a-z0-9]", "", w.lower())
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def words(text: str) -> list[str]:
    return [n for n in (_norm_word(w) for w in text.split()) if n]


# --------------------------------------------------------------------------- Athena

def judge_athena(scene: dict, heard_words: list[dict]) -> dict:
    """heard_words: [{"text": str, "start": float|None}] in spoken order."""
    script, owner = [], []
    for li, line in enumerate(scene["lines"]):
        for w in words(line["text"]):
            script.append(w)
            owner.append(li)
    heard = []
    heard_time = []
    for hw in heard_words:
        for w in words(hw["text"]):
            heard.append(w)
            heard_time.append(hw.get("start"))

    matched_script = {}
    sm = SequenceMatcher(None, script, heard, autojunk=False)
    for block in sm.get_matching_blocks():
        for k in range(block.size):
            matched_script[block.a + k] = block.b + k

    per_line = []
    for li, line in enumerate(scene["lines"]):
        idxs = [i for i, o in enumerate(owner) if o == li]
        hit = [i for i in idxs if i in matched_script]
        first_time = None
        for i in hit:
            t = heard_time[matched_script[i]]
            if t is not None:
                first_time = t
                break
        per_line.append({
            "character": line["character"],
            "text": line["text"],
            "accuracy": round(100 * len(hit) / max(1, len(idxs))),
            "heard_at": first_time,
            "cue_at": line["start"],
        })

    recall = len(matched_script) / max(1, len(script))
    precision = len(matched_script) / max(1, len(heard)) if heard else 0
    score = clamp(100 * (0.85 * recall + 0.15 * precision) * 1.08)  # small mercy for STT slips
    missed = [p["text"] for p in per_line if p["accuracy"] < 50]
    note = (f"{round(recall * 100)}% of the script's words were spoken. "
            + (f"Fumbled or skipped {len(missed)} line(s), e.g. \"{missed[0]}\"." if missed else "Every line landed."))
    return {"score": round(score), "note": note, "lines": per_line}


# --------------------------------------------------------------------------- Apollo

def judge_apollo(scene: dict, contours: dict, athena: dict, has_word_times: bool) -> dict:
    pitch = np.array([np.nan if v is None else v for v in contours.get("pitch", [])], dtype=float)
    energy = np.array(contours.get("energy", []), dtype=float)
    parts, notes = [], []

    if len(energy) == 0:
        return {"score": 0, "note": "The gods heard only silence."}

    voiced = ~np.isnan(pitch)
    # 1) Presence: how much of the speaking time actually had a voice in it
    speaking = np.zeros(len(energy), dtype=bool)
    for line in scene["lines"]:
        a, b = int(line["start"] * FEATURE_FPS), int(line["end"] * FEATURE_FPS)
        speaking[a:b] = True
    speaking = speaking[: len(voiced)]
    presence = voiced[: len(speaking)][speaking].mean() if speaking.any() else voiced.mean()
    parts.append(("presence", clamp(100 * presence / 0.55), 0.25))

    # 2) Expressiveness (or similarity to the reference actor when we have one)
    ref = (scene.get("reference") or {}).get("audio")
    vp = pitch[voiced]
    if ref and ref.get("pitch"):
        rp = np.array([np.nan if v is None else v for v in ref["pitch"]], dtype=float)
        re_ = np.array(ref["energy"], dtype=float)
        my_p = np.nan_to_num(pitch - np.nanmedian(pitch)) if voiced.any() else np.zeros_like(energy)
        ref_p = np.nan_to_num(rp - np.nanmedian(rp)) if (~np.isnan(rp)).any() else np.zeros_like(re_)
        a = _z(np.stack([my_p, energy], 1))
        b = _z(np.stack([ref_p, re_], 1))
        d = dtw_distance(downsample(a), downsample(b))
        sim = clamp(100 / (1 + (d / 1.1) ** 2) * 1.3)
        parts.append(("melody", sim, 0.45))
        notes.append(f"voice contour {round(sim)}% like the original actor")
    else:
        spread = float(np.std(vp)) if len(vp) > 5 else 0.0  # semitones
        dyn = float(np.percentile(energy, 95) - np.percentile(energy, 30))  # dB
        expr = clamp(55 * min(spread / 3.5, 1.2) + 45 * min(dyn / 22, 1.2))
        parts.append(("melody", expr, 0.45))
        notes.append(f"pitch range {spread:.1f} semitones, dynamics {dyn:.0f} dB")

    # 3) Timing: did each line start near its cue?
    if has_word_times:
        offs = [abs(p["heard_at"] - p["cue_at"]) for p in athena["lines"] if p["heard_at"] is not None]
        if offs:
            timing = 100 * float(np.mean([np.exp(-o / 2.0) for o in offs]))
            parts.append(("timing", timing, 0.30))
            notes.append(f"lines landed {np.mean(offs):.1f}s off cue on average")

    total = sum(s * w for _, s, w in parts) / sum(w for _, _, w in parts)
    notes.insert(0, f"voice present {round(presence * 100)}% of speaking time")
    return {"score": round(clamp(total)), "note": "; ".join(notes) + ".",
            "parts": {k: round(s) for k, s, _ in parts}}


def _z(x: np.ndarray) -> np.ndarray:
    sd = x.std(0)
    sd[sd < 1e-6] = 1
    return (x - x.mean(0)) / sd


# --------------------------------------------------------------------------- Ares

def judge_ares(scene: dict, assignments: dict, players: list[dict]) -> dict:
    """assignments: character_id -> player index."""
    ref_pose = (scene.get("reference") or {}).get("pose") or {}
    per_char, notes = {}, []
    for char_id, pi in assignments.items():
        raw = normalize_pose_seq(players[pi].get("pose", []))
        cov = coverage(raw)
        seq = fill_gaps(raw)
        if len(seq) < 5:
            per_char[char_id] = 0
            continue
        if char_id in ref_pose and ref_pose[char_id]:
            ref = fill_gaps(normalize_pose_seq(ref_pose[char_id]))
            d = dtw_distance(downsample(seq), downsample(ref))
            s = clamp(100 / (1 + (d / 0.9) ** 2) * 1.15)  # tune at venue with real takes
        else:
            # No reference actor: reward bold, purposeful gesture.
            wrists = seq[:, 10:14]  # L/R wrist x,y
            speed = np.linalg.norm(np.diff(wrists, axis=0), axis=1).mean() * FEATURE_FPS
            reach = np.ptp(seq[:, 6:14], axis=0).mean()  # elbow+wrist range of motion
            s = clamp(50 * min(speed / 1.2, 1.2) + 50 * min(reach / 1.4, 1.2))
        per_char[char_id] = round(s * (0.4 + 0.6 * min(cov / 0.8, 1)))
        if cov < 0.6:
            notes.append(f"{_char_name(scene, char_id)} wandered out of frame")
    score = float(np.mean(list(per_char.values()))) if per_char else 0
    mode = "matched against the original blocking" if ref_pose else "judged on boldness of gesture"
    return {"score": round(score), "note": f"Movement {mode}. " + ("; ".join(notes) + "." if notes else ""),
            "per_character": per_char}


# --------------------------------------------------------------------------- Aphrodite

def judge_aphrodite(scene: dict, assignments: dict, players: list[dict]) -> dict:
    ref_face = (scene.get("reference") or {}).get("face") or {}
    per_char, notes = {}, []
    for char_id, pi in assignments.items():
        raw = face_seq(players[pi].get("face", []))
        cov = coverage(raw)
        seq = fill_gaps(raw)
        if len(seq) < 5:
            per_char[char_id] = 0
            continue
        scores = []
        # Emotion asked for by each of this character's lines
        for line in scene["lines"]:
            if line["character"] != char_id:
                continue
            target = emotion_vector(line.get("emotion"))
            a, b = int(line["start"] * FEATURE_FPS), int(line["end"] * FEATURE_FPS) + 5
            window = seq[a:b]
            if target is None or len(window) == 0:
                continue
            # Strongest moment in the line, projected on the target emotion
            act = np.percentile(window @ target, 85)
            scores.append(clamp(100 * act / 0.32))
        if char_id in ref_face and ref_face[char_id]:
            ref = fill_gaps(face_seq(ref_face[char_id]))
            d = dtw_distance(downsample(seq), downsample(ref))
            scores.append(clamp(100 / (1 + (d / 0.35) ** 2) * 1.2))
        if not scores:  # fall back to overall expressiveness
            scores.append(clamp(100 * np.percentile(seq.max(1), 80) / 0.5))
        per_char[char_id] = round(float(np.mean(scores)) * (0.4 + 0.6 * min(cov / 0.8, 1)))
        if cov < 0.6:
            notes.append(f"{_char_name(scene, char_id)} hid their face from the gods")
    score = float(np.mean(list(per_char.values()))) if per_char else 0
    return {"score": round(score),
            "note": "Facial emotion compared to what each line demands. " + ("; ".join(notes) + "." if notes else ""),
            "per_character": per_char}


def _char_name(scene: dict, char_id: str) -> str:
    for c in scene["characters"]:
        if c["id"] == char_id:
            return c["name"]
    return char_id


# --------------------------------------------------------------------------- total

def total(judges: dict) -> dict:
    avg = sum(judges[k]["score"] * w for k, w in WEIGHTS.items())
    rank = next(name for floor, name in RANKS if avg >= floor)
    return {"score": round(avg), "kleos": round(avg * 10), "rank": rank}
