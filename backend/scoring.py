"""The Olympian panel. Each judge returns a 0-100 score plus a short factual note
that Gemini later turns into in-character commentary.

  Athena    - wisdom  - did you say the right words?       (fuzzy, STT-slip tolerant)
  Apollo    - art     - voice, line by line: melody, loudness envelope, pace, cue timing
  Ares      - war     - body: pose + head/shoulder angles + moving when the actor moves
  Aphrodite - passion - face: expression shape and changes vs the actor, and the line's emotion

Design rules (from playtesting: "we missed everything and still got 500"):
  * No free points. Absent, silent, off-script or frozen input scores ~0 on every judge; no
    presence bonuses or mercy multipliers that pay out for doing nothing.
  * Lines gate everything: total = gate(Athena) * weighted mean, so great faces cannot rescue a
    performance where nobody said the words.
  * Calibration maps raw similarity so no effort ~0-10, decent amateur ~55-75, near copy 90+.
"""
from __future__ import annotations

import re
from difflib import SequenceMatcher  # noqa: F401  (kept for callers importing it from here)

import numpy as np

from features import (
    BLENDSHAPES, FEATURE_FPS, coverage, emotion_vector, face_seq, face_swap_lr, fill_gaps,
    normalize_pose_frame, normalize_pose_seq, pose_angles, pose_frame_distance, pose_motion,
    pose_similarity, pose_visible_count,
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

LAG_WINDOW = 6  # frames (+/-0.6 s) a player may trail or lead the actor


def clamp(v: float, lo: float = 0, hi: float = 100) -> float:
    return float(max(lo, min(hi, v)))


def calibrate(raw: float, lo: float, hi: float) -> float:
    """Linear map raw->0..100 where raw<=lo is 0 (no effort) and raw>=hi is 100 (near copy)."""
    return clamp(100 * (raw - lo) / (hi - lo))


def smoothstep(x: float, lo: float, hi: float) -> float:
    t = min(1.0, max(0.0, (x - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


# =========================================================================== Athena

_CONTRACTIONS = [
    (r"\bwon't\b", "will not"), (r"\bcan't\b", "can not"), (r"\bshan't\b", "shall not"),
    (r"\bain't\b", "is not"), (r"n't\b", " not"), (r"'re\b", " are"), (r"'ve\b", " have"),
    (r"'ll\b", " will"), (r"'d\b", " would"), (r"'m\b", " am"), (r"(\w)'s\b", r"\1 is"),
]


def _expand(text: str) -> str:
    t = text.lower().replace("’", "'").replace("`", "'")
    for pat, rep in _CONTRACTIONS:
        t = re.sub(pat, rep, t)
    return t


def _norm_word(w: str) -> str:
    w = re.sub(r"[^a-z0-9]", "", w.lower())
    return w[:-1] if len(w) > 3 and w.endswith("s") else w


def words(text: str) -> list[str]:
    return [n for n in (_norm_word(w) for w in _expand(text).split()) if n]


def _lev(a: str, b: str) -> int:
    if len(a) < len(b):
        a, b = b, a
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


_PHON = str.maketrans("bpdtgkcqszfvmnlr", "ppttkkkksssfnnll")


def _phon(w: str) -> str:
    """Crude sound-alike key: first letter + consonant classes, vowels/h/w/y dropped, runs merged."""
    if not w:
        return ""
    body = re.sub(r"[aeiouhwy]", "", w[1:]).translate(_PHON)
    key = w[0].translate(_PHON) + body
    return re.sub(r"(.)\1+", r"\1", key)


def word_sim(a: str, b: str) -> float:
    """0..1 credit for heard word b standing in for script word a (STT slips get partial credit)."""
    if a == b:
        return 1.0
    if not a or not b:
        return 0.0
    s = 1 - _lev(a, b) / max(len(a), len(b))
    if len(a) > 2 and _phon(a) == _phon(b):
        s = max(s, 0.8)
    need = 0.67 if min(len(a), len(b)) <= 3 else 0.5
    return s if s >= need else 0.0


_TIE_EPS = 0.001  # per-word timing bonus: far too small to outvote real word credit


def align(script: list[str], heard: list[str], near: np.ndarray | None = None) -> list[tuple[int, int, float]]:
    """Order-preserving best alignment (weighted LCS). -> [(script_i, heard_j, credit)].

    A phrase can fit two places in a script ("...until the trial's over." / "The trial is over.").
    `near[i, j]` in 0..1 says how close in time heard word j was to script word i's line; it only
    breaks ties between alignments of equal credit, so the words land on the line they were said in.
    """
    n, m = len(script), len(heard)
    if n == 0 or m == 0:
        return []
    sim = np.array([[word_sim(a, b) for b in heard] for a in script])
    gain = sim + (_TIE_EPS * near if near is not None else 0.0)
    dp = np.zeros((n + 1, m + 1))
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best = max(dp[i - 1, j], dp[i, j - 1])
            if sim[i - 1, j - 1] > 0:
                best = max(best, dp[i - 1, j - 1] + gain[i - 1, j - 1])
            dp[i, j] = best
    # Walk back preferring to skip: with no timing to go on, this pins each heard word to the
    # EARLIEST script word it can stand for, so a word that recurs later in the script ("Noman")
    # is credited to the line that was spoken first, not to the last line that contains it.
    # (Exact-ish comparison: np.isclose's default tolerance is wider than the timing bonus.)
    out, i, j = [], n, m
    while i > 0 and j > 0:
        if abs(dp[i, j] - dp[i - 1, j]) < 1e-9:
            i -= 1
        elif abs(dp[i, j] - dp[i, j - 1]) < 1e-9:
            j -= 1
        else:
            out.append((i - 1, j - 1, float(sim[i - 1, j - 1])))
            i, j = i - 1, j - 1
    return out[::-1]


def _supported(matches: list[tuple[int, int, float]], script: list[str]) -> list[tuple[int, int, float]]:
    """Keep matches that are part of a run (a neighbour in the script also matched next to it in
    what was heard) or are distinctive words. Unrelated chatter shares "the", "of", "out"... with any
    script; isolated hits like that are coincidence, not lines."""
    by_i = {i: j for i, j, _ in matches}
    kept = []
    for i, j, c in matches:
        run = any(k in by_i and 0 < abs(by_i[k] - j) <= 2 for k in (i - 1, i + 1))
        if run or (len(script[i]) >= 5 and c >= 0.8):
            kept.append((i, j, c))
    return kept


def judge_athena(scene: dict, heard_words: list[dict]) -> dict:
    """heard_words: [{"text": str, "start": float|None, "end": float|None}] in spoken order."""
    script, owner = [], []
    for li, line in enumerate(scene["lines"]):
        for w in words(line["text"]):
            script.append(w)
            owner.append(li)
    heard, h_start, h_end, h_raw = [], [], [], []
    for hw in heard_words:
        for w in words(hw["text"]):
            heard.append(w)
            h_start.append(hw.get("start"))
            h_end.append(hw.get("end"))
            h_raw.append(hw["text"])

    # How near in time each heard word is to where its script word falls in the film (the line's
    # span, spread evenly over its words); fades over a couple of seconds, 0 without timestamps.
    near = None
    if script and any(t is not None for t in h_start):
        per_line = np.bincount(owner, minlength=len(scene["lines"]))
        first = np.concatenate([[0], np.cumsum(per_line)[:-1]])
        due = np.array([
            scene["lines"][o]["start"]
            + (i - first[o] + 0.5) / per_line[o] * (scene["lines"][o]["end"] - scene["lines"][o]["start"])
            for i, o in enumerate(owner)])[:, None]
        t = np.array([np.nan if s is None else s for s in h_start], dtype=float)[None, :]
        near = np.nan_to_num(np.exp(-np.abs(t - due) / 2.0))

    matches = _supported(align(script, heard, near), script)
    credit = {i: (j, c) for i, j, c in matches}

    per_line = []
    for li, line in enumerate(scene["lines"]):
        idxs = [i for i, o in enumerate(owner) if o == li]
        got = [credit[i] for i in idxs if i in credit]
        js = [j for j, _ in got]
        first = next((h_start[j] for j in js if h_start[j] is not None), None)
        last_j = next((j for j in reversed(js) if h_start[j] is not None), None)
        end = None
        if last_j is not None:
            end = h_end[last_j] if h_end[last_j] is not None else h_start[last_j] + 0.35
        acc = 100 * sum(c for _, c in got) / max(1, len(idxs))
        # Word-by-word credit against the script as written (a contraction is one token, two words)
        tokens, k = [], 0
        for tok in line["text"].split():
            n = len(words(tok))
            if n == 0:  # a bare dash or other punctuation: glue it to the previous word
                if tokens:
                    tokens[-1]["w"] += " " + tok
                continue
            cs = [credit[i][1] if i in credit else 0.0 for i in idxs[k:k + n]]
            k += n
            tokens.append({"w": tok, "hit": round(sum(cs) / n, 2)})
        per_line.append({
            "line": li,
            "character": line["character"],
            "text": line["text"],
            "accuracy": round(acc),
            "score": round(acc),
            "heard": " ".join(dict.fromkeys(h_raw[j] for j in range(min(js), max(js) + 1))) if js else "",
            "heard_at": first,
            "heard_end": end,
            "cue_at": line["start"],
            "words": tokens,
        })

    total_credit = sum(c for _, _, c in matches)
    recall = total_credit / max(1, len(script))
    precision = total_credit / max(1, len(heard)) if heard else 0.0
    raw = 0.85 * recall + 0.15 * precision
    # A clean read with the odd STT slip lands ~0.9 raw -> 100. Nothing heard -> 0.
    score = calibrate(raw, 0.05, 0.90)
    missed = [p["text"] for p in per_line if p["accuracy"] < 50]
    note = (f"{round(recall * 100)}% of the script's words were spoken. "
            + (f"Fumbled or skipped {len(missed)} line(s), e.g. \"{missed[0]}\"." if missed else "Every line landed."))
    return {"score": round(score), "note": note, "lines": per_line,
            "raw": {"recall": round(recall, 3), "precision": round(precision, 3)}}


# =========================================================================== Apollo

def _arr(xs) -> np.ndarray:
    return np.array([np.nan if v is None else v for v in (xs or [])], dtype=float)


def _window(arr: np.ndarray, a: float, b: float) -> np.ndarray:
    i, j = max(0, int(round(a * FEATURE_FPS))), max(0, int(round(b * FEATURE_FPS)))
    return arr[i:j] if j > i else arr[:0]


def _resample(x: np.ndarray, n: int = 24) -> np.ndarray:
    if len(x) < 2:
        return np.zeros(n)
    return np.interp(np.linspace(0, len(x) - 1, n), np.arange(len(x)), x)


def _corr(a: np.ndarray, b: np.ndarray) -> float:
    if len(a) < 3 or a.std() < 1e-6 or b.std() < 1e-6:
        return 0.0
    return float(np.corrcoef(a, b)[0, 1])


def judge_apollo(scene: dict, contours: dict, athena: dict, has_word_times: bool) -> dict:
    pitch = _arr(contours.get("pitch"))
    energy = _arr(contours.get("energy"))
    if len(energy) == 0:
        return {"score": 0, "note": "The gods heard only silence.", "lines": [], "parts": {}}
    speech = np.asarray(contours.get("speech") or ~np.isnan(pitch), dtype=bool)[: len(energy)]
    if len(speech) < len(energy):
        speech = np.concatenate([speech, np.zeros(len(energy) - len(speech), bool)])

    ref = (scene.get("reference") or {}).get("audio") or scene.get("reference_audio") or {}  # voiced text scenes keep it top-level
    rp, re_ = _arr(ref.get("pitch")), _arr(ref.get("energy"))
    has_ref = len(re_) > 5 and np.nanstd(re_) > 1e-3 and (~np.isnan(rp)).sum() > 10

    lines_out, line_scores, weights = [], [], []
    comp_sum: dict[str, list[float]] = {}
    for li, line in enumerate(scene["lines"]):
        a, b = line["start"], line["end"]
        ath = athena["lines"][li] if li < len(athena.get("lines", [])) else {}
        acc = ath.get("accuracy", 0)
        heard_at, heard_end = ath.get("heard_at"), ath.get("heard_end")
        if heard_at is not None:
            pa, pb = heard_at - 0.3, (heard_end if heard_end is not None else heard_at + (b - a)) + 0.3
        else:
            pa, pb = a - 0.5, b + 1.0
        p_pitch, p_energy, p_speech = _window(pitch, pa, pb), _window(energy, pa, pb), _window(speech, pa, pb)
        p_voiced = p_pitch[~np.isnan(p_pitch)]

        comps: dict[str, float] = {}
        if p_speech.sum() >= 3 and len(p_voiced) >= 3:
            ref_frac = 0.5
            if has_ref:
                r_pitch, r_energy = _window(rp, a - 0.1, b + 0.1), _window(re_, a - 0.1, b + 0.1)
                r_voiced = r_pitch[~np.isnan(r_pitch)]
                ref_frac = max(0.25, float((~np.isnan(r_pitch)).mean()) if len(r_pitch) else 0.5)
                if len(r_voiced) >= 4:
                    shape = max(0.0, _corr(_resample(p_voiced - np.median(p_voiced)),
                                           _resample(r_voiced - np.median(r_voiced))))
                    sp, sr_ = float(p_voiced.std()), float(r_voiced.std())
                    rng = float(np.exp(-abs(np.log((sp + 0.3) / (sr_ + 0.3)))))
                    comps["melody"] = 0.6 * shape + 0.4 * rng
                if len(r_energy) >= 4 and np.nanstd(r_energy) > 0.5 and np.std(p_energy) > 0.5:
                    comps["envelope"] = max(0.0, _corr(_resample(p_energy), _resample(np.nan_to_num(r_energy))))
                elif len(r_energy) >= 4:
                    comps["envelope"] = 0.0
            else:
                spread = float(p_voiced.std())
                dyn = float(np.percentile(p_energy, 95) - np.percentile(p_energy, 30)) if len(p_energy) else 0
                comps["melody"] = min(1.0, spread / 3.0)
                comps["envelope"] = min(1.0, dyn / 20.0)
            comps["voice"] = min(1.0, float(p_speech.mean()) / ref_frac)
            if has_word_times and heard_at is not None:
                comps["timing"] = float(np.exp(-abs(heard_at - a) / 1.2))
                if heard_end is not None and heard_end > heard_at:
                    comps["pace"] = float(np.exp(-1.2 * abs(np.log((heard_end - heard_at) / max(0.3, b - a)))))
        w = {"melody": .30, "envelope": .20, "pace": .15, "timing": .20, "voice": .15}
        raw = sum(comps[k] * w[k] for k in comps) / sum(w[k] for k in comps) if comps else 0.0
        # Apollo judges the delivery of LINES: a hum or off-script babble has nothing to deliver.
        raw *= min(1.0, acc / 70)
        n_words = max(1, len(words(line["text"])))
        line_scores.append(raw)
        weights.append(n_words)
        for k, v in comps.items():
            comp_sum.setdefault(k, []).append(v)
        lines_out.append({"line": li, "character": line["character"], "text": line["text"],
                          "score": round(calibrate(raw, 0.05, 0.85)),
                          "parts": {k: round(100 * v) for k, v in comps.items()}})

    raw_total = float(np.average(line_scores, weights=weights)) if line_scores else 0.0
    score = calibrate(raw_total, 0.05, 0.85)
    parts = {k: round(100 * float(np.mean(v))) for k, v in comp_sum.items()}
    best = max(lines_out, key=lambda x: x["score"]) if lines_out else None
    worst = min(lines_out, key=lambda x: x["score"]) if lines_out else None
    film_ref = bool((scene.get("reference") or {}).get("audio"))
    who = "the film actor's" if film_ref else "the voiced reference"
    what = f"matched against {who} delivery, line by line" if has_ref else "judged on melody and dynamics, line by line"
    note = f"Voice {what}"
    if best and worst and best is not worst:
        note += f"; best \"{_clip(best['text'])}\" {best['score']}, worst \"{_clip(worst['text'])}\" {worst['score']}"
    if parts:
        note += "; " + ", ".join(f"{k} {v}" for k, v in parts.items())
    return {"score": round(score), "note": note + ".", "parts": parts, "lines": lines_out,
            "raw": round(raw_total, 3)}


# =========================================================================== shared: reference tracks

def _ref_track(scene: dict, kind: str, char_id: str) -> list | None:
    track = (((scene.get("reference") or {}).get(kind)) or {}).get(char_id)
    return track if track and any(f for f in track) else None


def _segments(track: list, min_len: int = 5) -> list[tuple[int, int]]:
    """Contiguous runs of non-null reference frames (= the character's shots)."""
    segs, start = [], None
    for i, f in enumerate(list(track) + [None]):
        if f and start is None:
            start = i
        elif not f and start is not None:
            if i - start >= min_len:
                segs.append((start, i))
            start = None
    return segs


def _lagged_corr(ref: np.ndarray, pl: np.ndarray, max_lag: int = LAG_WINDOW) -> tuple[float, int]:
    """Best Pearson correlation of pl vs ref over lags in [-max_lag, max_lag] (pl may trail)."""
    best, best_lag = 0.0, 0
    for lag in range(-max_lag, max_lag + 1):
        if lag >= 0:
            a, b = ref[: len(ref) - lag], pl[lag: lag + len(ref) - lag]
        else:
            a, b = ref[-lag:], pl[: len(ref) + lag]
        n = min(len(a), len(b))
        if n < 4:
            continue
        r = _corr(a[:n], b[:n])
        if r > best:
            best, best_lag = r, lag
    return best, best_lag


def _smooth(x: np.ndarray, k: int = 3) -> np.ndarray:
    x = np.nan_to_num(x)
    return np.convolve(x, np.ones(k) / k, mode="same") if len(x) >= k else x


def _dynamics_match(ref_v: np.ndarray, pl_v: np.ndarray, floor: float) -> tuple[float, int]:
    """Did the player change when the actor changed, and about as much? -> (0..1, lag)."""
    rv, pv = _smooth(ref_v), _smooth(pl_v)
    r, lag = _lagged_corr(rv, pv)
    rm, pm = float(rv.mean()), float(pv.mean())
    # Moving 3x as much as the actor (or not at all) is as wrong as moving at the wrong moments.
    ratio = float(np.exp(-1.5 * abs(np.log((pm + floor) / (rm + floor)))))
    return (0.4 * r * (1 - 0.03 * abs(lag)) + 0.6 * ratio), lag


def _moments(scene: dict, frame_scores: list) -> list[dict]:
    out = []
    for li, line in enumerate(scene["lines"]):
        a, b = int(line["start"] * FEATURE_FPS), int(line["end"] * FEATURE_FPS) + 1
        vals = [v for v in frame_scores[a:b] if v is not None]
        if vals:
            out.append({"line": li, "text": line["text"], "score": round(float(np.mean(vals)))})
    return out


def _line_breakdown(scene: dict, per_char_frames: dict[str, list]) -> list[dict]:
    """Per scripted line: mean frame score of whoever the film shows during it."""
    out = []
    for li, line in enumerate(scene["lines"]):
        a, b = int(line["start"] * FEATURE_FPS), int(line["end"] * FEATURE_FPS) + 1
        vals, chars = [], set()
        for cid, fs in per_char_frames.items():
            v = [x for x in fs[a:b] if x is not None]
            if v:
                vals += v
                chars.add(cid)
        if vals:
            out.append({"line": li, "text": line["text"], "character": line["character"],
                        "on_screen": sorted(chars), "score": round(float(np.mean(vals)))})
    return out


def _moment_note(name: str, what: str, score: float, moments: list[dict], missing: float) -> str:
    note = f"{name} {what} {round(score)}%"
    if len(moments) >= 2:
        best = max(moments, key=lambda m: m["score"])
        worst = min(moments, key=lambda m: m["score"])
        note += (f" (best during \"{_clip(best['text'])}\" {best['score']}, "
                 f"worst during \"{_clip(worst['text'])}\" {worst['score']})")
    elif moments:
        note += f" (during \"{_clip(moments[0]['text'])}\")"
    if missing > 0.3:
        note += f"; missing from frame for {round(missing * 100)}% of the actor's screen time"
    return note


def _clip(text: str, n: int = 40) -> str:
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def _char_name(scene: dict, char_id: str) -> str:
    for c in scene["characters"]:
        if c["id"] == char_id:
            return c["name"]
    return char_id


def _lag_match(ref_items: list, pl_items: list, sim) -> tuple[list, float, float, float]:
    """Frame-by-frame match with ONE time offset per shot (a late-but-faithful player keeps a
    steady lag; letting every frame pick its own best neighbour would reward random input).

    ref_items/pl_items: prepared frames or None. sim(r, p) -> (0..1, weight) | None (= frame not
    comparable, skipped). A missing player frame where the actor is judged scores 0.
    Returns (per-frame scores, weighted mean, fraction missing, mean |lag| in frames).
    """
    n = len(ref_items)
    pl = list(pl_items) + [None] * max(0, n + LAG_WINDOW - len(pl_items))
    scores: list[float | None] = [None] * n
    num = den = missing = judged = lag_sum = 0.0
    i = 0
    while i < n:
        if ref_items[i] is None:
            i += 1
            continue
        j = i
        while j < n and ref_items[j] is not None:
            j += 1
        best = None
        for lag in range(-LAG_WINDOW, LAG_WINDOW + 1):
            seg, s_num, s_den, s_miss = [], 0.0, 0.0, 0
            for k in range(i, j):
                q = k + lag
                p_ = pl[q] if 0 <= q < len(pl) else None
                if p_ is None:
                    seg.append((k, 0.0, 1.0, True))
                    s_den += 1.0
                    s_miss += 1
                    continue
                r = sim(ref_items[k], p_)
                if r is None:
                    continue
                v = r[0] * (1 - 0.02 * abs(lag))
                seg.append((k, v, r[1], False))
                s_num += v * r[1]
                s_den += r[1]
            mean = s_num / s_den if s_den else -1
            if best is None or mean > best[0]:
                best = (mean, seg, s_num, s_den, s_miss, lag)
        _, seg, s_num, s_den, s_miss, lag = best
        for k, v, _, _ in seg:
            scores[k] = v
        num, den = num + s_num, den + s_den
        missing += s_miss
        judged += len(seg)
        lag_sum += abs(lag) * len(seg)
        i = j
    if judged == 0:
        return scores, 0.0, 0.0, 0.0
    return scores, (num / den if den else 0.0), missing / judged, lag_sum / judged


# =========================================================================== Ares

_ARES_LO, _ARES_HI = 0.25, 0.90


def _pose_frame_score(r, p) -> tuple[float, float] | None:
    """(0..1 similarity, weight) for one normalized ref frame vs one normalized player frame."""
    d = pose_frame_distance(r, p)
    if d is None:
        return None
    pos = pose_similarity(d) / 100
    ra, pa = pose_angles(r), pose_angles(p)
    if ra and pa:
        ang = float(np.mean([np.exp(-abs(ra[0] - pa[0]) / 0.15), np.exp(-abs(ra[1] - pa[1]) / 0.20),
                             np.exp(-abs(ra[2] - pa[2]) / 0.30)]))
        sim = 0.5 * pos + 0.5 * ang
    else:
        sim = pos
    # Close-ups expose only nose + shoulders: such frames say less, so they weigh less.
    weight = 1.0 if pose_visible_count(r, p) >= 5 else 0.4
    return sim, weight


def _mirror_pose(frame):
    """Same take seen in a mirror: display x -> 1-x (labels kept; comparisons are screen-ordered)."""
    if not frame:
        return frame
    stride = 3 if len(frame) == 21 else 2
    return [round(1 - v, 4) if k % stride == 0 else v for k, v in enumerate(frame)]


def _pose_track_score(ref: list, player: list) -> dict:
    """Players either copy the screen like a mirror-dance or use the actor's own left/right side
    (which shows mirrored on the stage display). Score both readings of the WHOLE track and keep the
    better one: per-frame max would reward random flailing."""
    a = _pose_track_score_oriented(ref, player)
    if not a["usable"]:
        return a
    b = _pose_track_score_oriented(ref, [_mirror_pose(f) for f in player])
    best = b if b["raw"] > a["raw"] else a
    best["mirrored"] = best is b
    return best


def _pose_track_score_oriented(ref: list, player: list) -> dict:
    ref_n = [normalize_pose_frame(f) for f in ref]
    ref_n = [r if r is not None and (r[1] > 0.5).sum() >= 3 else None for r in ref_n]
    if not any(r is not None for r in ref_n):
        return {"usable": False}
    pl_n = [normalize_pose_frame(f) for f in player]
    frame_scores, match, missing, _ = _lag_match(ref_n, pl_n, _pose_frame_score)
    usable = 1

    # Dynamics: within each shot, move when (and about as much as) the actor moves.
    ref_mv, pl_mv = pose_motion(ref), pose_motion(list(player) + [None] * max(0, len(ref) - len(player)))
    dyn_num = dyn_den = 0.0
    for a, b in _segments(ref):
        rv, pv = ref_mv[a:b], pl_mv[a:b]
        if np.isnan(rv).all():
            continue
        s, _ = _dynamics_match(np.nan_to_num(rv), np.nan_to_num(pv), floor=0.01)
        dyn_num += s * (b - a)
        dyn_den += b - a
    dyn = dyn_num / dyn_den if dyn_den else match
    # Moving with the actor scales the pose credit: holding the right still pose through a scene
    # where the actor moves is not acting.
    raw = match * (0.3 + 0.7 * dyn)
    return {"usable": True, "raw": raw, "match": match, "dynamics": dyn,
            "frames": [None if v is None else round(calibrate(v, _ARES_LO, _ARES_HI)) for v in frame_scores],
            "missing": missing * usable}


def _own_line_mask(scene: dict, char_id: str, n: int, tail: int = 5) -> np.ndarray:
    own = np.zeros(n, bool)
    for line in scene["lines"]:
        if line["character"] == char_id:
            own[int(line["start"] * FEATURE_FPS): int(line["end"] * FEATURE_FPS) + tail] = True
    return own


def _idle_level(values: np.ndarray, own: np.ndarray) -> float:
    """The player's own idle level: median outside their lines (or a low percentile if they
    speak nearly all the time). Anything constant - jitter, fidgeting, random waving - sits at
    this level and therefore earns nothing."""
    rest = values[~own]
    return float(np.median(rest)) if len(rest) >= 10 else float(np.percentile(values, 25))


def _ares_no_ref(scene: dict, char_id: str, player: list) -> tuple[float, str | None]:
    """Text scenes: credit movement and posture that rise ON YOUR OWN LINES above your idle level.

    Per line: (a) movement above the player's idle movement, (b) how far the body is from its idle
    pose compared with how far it usually wanders. The character's score is the MEDIAN over their
    lines, so one lucky line of fidgeting doesn't count and constant waving earns nothing."""
    raw = normalize_pose_seq(player)
    cov = coverage(raw)
    if cov < 0.05:
        return 0.0, "never appeared in frame"
    seq = fill_gaps(raw)
    mv = _smooth(np.nan_to_num(pose_motion(player)), 3)[: len(seq)]
    own = _own_line_mask(scene, char_id, len(seq))
    if not own.any():
        return 0.0, None
    idle_pose = np.median(seq[~own], axis=0) if (~own).sum() >= 10 else np.median(seq, axis=0)
    # A gesture is usually one limb: take the most-displaced landmark, not the average of seven.
    dev = np.linalg.norm((seq - idle_pose).reshape(len(seq), -1, 2), axis=2).max(axis=1)
    # Same statistic inside and outside the lines (like with like), and the excess is scaled by how
    # restless the player is at rest: a gesture has to stand out against your own fidgeting.
    rest = ~own if (~own).sum() >= 10 else np.ones(len(own), bool)
    mv_idle = float(np.mean(mv[rest]))
    dev_idle = float(np.percentile(dev[rest], 80))
    per_line = []
    for line in scene["lines"]:
        if line["character"] != char_id:
            continue
        a, b = int(line["start"] * FEATURE_FPS), int(line["end"] * FEATURE_FPS) + 5
        if a >= len(seq):
            continue
        m = calibrate((float(np.mean(mv[a:b])) - mv_idle) / (1 + mv_idle / 0.1), 0.01, 0.06)
        d = calibrate((float(np.percentile(dev[a:b], 80)) - dev_idle) / (1 + dev_idle / 0.3), 0.10, 0.80)
        per_line.append(0.4 * m + 0.6 * d)
    if not per_line:
        return 0.0, None
    s = float(np.median(per_line)) * min(1.0, cov / 0.8)
    return s, ("wandered out of frame" if cov < 0.6 else None)


def judge_ares(scene: dict, assignments: dict, players: list[dict]) -> dict:
    """assignments: character_id -> player index."""
    per_char, notes, moments, frames, raws, used_ref = {}, [], {}, {}, {}, False
    for char_id, pi in assignments.items():
        player = players[pi].get("pose", []) if pi < len(players) else []
        name = _char_name(scene, char_id)
        ref = _ref_track(scene, "pose", char_id)
        if ref is not None:
            r = _pose_track_score(ref, player)
            if r["usable"]:
                used_ref = True
                s = calibrate(r["raw"], _ARES_LO, _ARES_HI)
                per_char[char_id] = round(s)
                frames[char_id] = r["frames"]
                moments[char_id] = _moments(scene, r["frames"])
                raws[char_id] = {"match": round(r["match"], 3), "dynamics": round(r["dynamics"], 3)}
                notes.append(_moment_note(name, "matched the actor's body", s, moments[char_id], r["missing"])
                             + f" (pose {round(100 * r['match'])}, moved-with-actor {round(100 * r['dynamics'])})")
                continue
        s, why = _ares_no_ref(scene, char_id, player)
        per_char[char_id] = round(s)
        if why:
            notes.append(f"{name} {why}")
    score = float(np.mean(list(per_char.values()))) if per_char else 0
    mode = ("matched against the film actors: pose, head and shoulder angles, and moving when they move"
            if used_ref else "judged on purposeful gesture during your own lines")
    return {"score": round(score), "note": f"Movement {mode}. " + ("; ".join(notes) + "." if notes else ""),
            "per_character": per_char, "moments": moments, "lines": _line_breakdown(scene, frames),
            "raw": raws}


# =========================================================================== Aphrodite

_APH_LO, _APH_HI = 0.12, 0.85
_NEUTRAL_EPS = 0.06  # centered-expression magnitude below which a face counts as "at rest"


def _face_arr(frames: list) -> np.ndarray:
    return face_seq(frames)


def _baseline(arr: np.ndarray) -> np.ndarray | None:
    """Resting face estimate: 20th percentile per blendshape (actors and players are rarely fully
    neutral, so a median would cancel out the very expressions we want to compare)."""
    valid = arr[~np.isnan(arr).any(axis=1)]
    return np.percentile(valid, 20, axis=0) if len(valid) else None


def _face_frame_sim(r: np.ndarray, p: np.ndarray) -> tuple[float, float] | None:
    """Centered ref vs centered player expression -> (0..1, weight), or None to skip the frame.

    Actor at rest: no credit is available (a resting face is not a feat); the frame only counts,
    as a 0, when the player pulls a big expression there (gurning through a calm moment).
    """
    rn, pn = float(np.linalg.norm(r)), float(np.linalg.norm(p))
    if rn < _NEUTRAL_EPS:
        return (0.0, 0.5) if pn > 0.30 else None
    # Shape, not loudness: remove each frame's average activation so "every blendshape up"
    # (gurning, over-acting) is not similar to everything.
    rs, ps = r - r.mean(), p - p.mean()
    rsn, psn = float(np.linalg.norm(rs)), float(np.linalg.norm(ps))
    cos = 0.0 if rsn < 1e-4 or psn < 1e-4 else float(rs @ ps) / (rsn * psn)
    mag = float(np.exp(-abs(np.log((pn + 0.03) / (rn + 0.03)))))
    return 0.65 * max(0.0, cos) + 0.35 * mag * max(0.0, cos) ** 0.5, 1.0


def _emotion_scores(scene: dict, char_id: str, centered: np.ndarray) -> list[tuple[int, float]]:
    """Per line of this character: does the face move toward the line's emotion, compared with the
    player's own face outside their lines? Shape only (frame-demeaned), so 'everything up' gurning
    or random twitching does not count."""
    valid = ~np.isnan(centered).any(axis=1)
    if valid.sum() == 0:
        return []
    shaped = np.where(valid[:, None], centered - np.nanmean(centered, axis=1, keepdims=True), np.nan)
    own = _own_line_mask(scene, char_id, len(shaped))
    out = []
    for li, line in enumerate(scene["lines"]):
        if line["character"] != char_id:
            continue
        target = emotion_vector(line.get("emotion"))
        if target is None:
            continue
        t = target - target.mean()
        t /= np.linalg.norm(t)
        proj = np.where(valid, np.nan_to_num(shaped) @ t, np.nan)
        a, b = int(line["start"] * FEATURE_FPS), int(line["end"] * FEATURE_FPS) + 5
        win = proj[a:b]
        win = win[~np.isnan(win)]
        rest = proj[~own & valid]
        if len(win) == 0:
            continue
        # Like for like: the same percentile of the same projection outside the player's lines.
        idle = float(np.percentile(rest, 80)) if len(rest) >= 10 else float(np.nanpercentile(proj, 25))
        spread = float(np.std(rest)) if len(rest) >= 10 else 0.0
        out.append((li, calibrate((float(np.percentile(win, 80)) - idle) / (1 + spread / 0.05), 0.03, 0.20) / 100))
    return out


def _face_track_score(scene: dict, char_id: str, ref: list, player: list, ref_base: np.ndarray) -> dict:
    """Like the body: try the player's face as-is and with Left/Right blendshapes swapped (mirror
    imitation), for the whole track, and keep the better reading."""
    a = _face_track_score_oriented(scene, char_id, ref, player, ref_base)
    swapped = [list(face_swap_lr(np.asarray(f, dtype=float))) if f and len(f) == len(BLENDSHAPES) else f
               for f in player]
    b = _face_track_score_oriented(scene, char_id, ref, swapped, ref_base)
    if not a.get("usable"):
        return b
    return b if b.get("usable") and b["raw"] > a["raw"] else a


def _face_track_score_oriented(scene: dict, char_id: str, ref: list, player: list, ref_base: np.ndarray) -> dict:
    ref_a = _face_arr(ref)
    pl_a = _face_arr(list(player) + [None] * max(0, len(ref) - len(player)))
    pl_base = _baseline(pl_a)
    if pl_base is None:
        return {"usable": True, "raw": 0.0, "frames": [0 if f else None for f in ref], "missing": 1.0,
                "match": 0.0, "changes": 0.0}
    rc, pc = ref_a - ref_base, pl_a - pl_base
    ref_items = [None if np.isnan(r).any() else r for r in rc]
    pl_items = [None if np.isnan(q).any() else q for q in pc]
    if not any(r is not None for r in ref_items):
        return {"usable": False}
    frame_scores, match, missing, _ = _lag_match(ref_items, pl_items, _face_frame_sim)
    vals = [v for v in frame_scores if v is not None]
    if not vals:
        # Actor at rest throughout: nothing expressive to imitate; judge on the line emotions only.
        match = None

    # Expression changes: intensity rises/falls with the actor's within each shot.
    r_int = np.linalg.norm(np.nan_to_num(rc), axis=1)
    p_int = np.linalg.norm(np.nan_to_num(pc), axis=1)
    ch_num = ch_den = 0.0
    for a, b in _segments(ref):
        s, _ = _dynamics_match(r_int[a:b], p_int[a:b], floor=0.02)
        ch_num += s * (b - a)
        ch_den += b - a
    changes = ch_num / ch_den if ch_den else None  # None: no shot long enough to judge changes
    terms = [(match, 0.70)] if match is not None else []
    if changes is not None:
        terms.append((changes, 0.30))
    if not terms:
        # The actor never shows an expression: fall back to the emotion each line asks for.
        emo = [s for _, s in _emotion_scores(scene, char_id, pc)]
        if emo:
            terms.append((float(np.mean(emo)), 1.0))
    raw = sum(v * w for v, w in terms) / sum(w for _, w in terms) if terms else 0.0
    changes = changes if changes is not None else 0.0
    match = match if match is not None else 0.0
    return {"usable": True, "raw": raw, "match": match, "changes": changes,
            "frames": [None if v is None else round(calibrate(v, _APH_LO, _APH_HI)) for v in frame_scores],
            "missing": missing}


def judge_aphrodite(scene: dict, assignments: dict, players: list[dict]) -> dict:
    per_char, notes, moments, frames, raws, used_ref = {}, [], {}, {}, {}, False
    # Film neutral: per-actor median, pooled across actors when an actor has too few face frames.
    ref_faces = ((scene.get("reference") or {}).get("face")) or {}
    pooled = _baseline(np.concatenate([_face_arr(t) for t in ref_faces.values() if t]
                                      or [np.full((1, len(BLENDSHAPES)), np.nan)]))
    for char_id, pi in assignments.items():
        player = players[pi].get("face", []) if pi < len(players) else []
        name = _char_name(scene, char_id)
        ref = _ref_track(scene, "face", char_id)
        if ref is not None:
            base = pooled  # the film's resting face, estimated from every actor's frames
            r = _face_track_score(scene, char_id, ref, player, base)
            if r["usable"]:
                used_ref = True
                s = calibrate(r["raw"], _APH_LO, _APH_HI)
                per_char[char_id] = round(s)
                frames[char_id] = r["frames"]
                moments[char_id] = _moments(scene, r["frames"])
                raws[char_id] = {"match": round(r["match"], 3), "changes": round(r["changes"], 3)}
                notes.append(_moment_note(name, "mirrored the actor's expressions", s, moments[char_id], r["missing"]))
                continue
        # No usable reference: emotion of each line relative to the player's own resting face.
        arr = _face_arr(player)
        base = _baseline(arr)
        if base is None or coverage(arr) < 0.05:
            per_char[char_id] = 0
            notes.append(f"{name} hid their face from the gods")
            continue
        emo = [s for _, s in _emotion_scores(scene, char_id, arr - base)]
        s = 100 * float(np.median(emo)) if emo else 0.0  # median: one lucky line doesn't count
        per_char[char_id] = round(s * min(1.0, coverage(arr) / 0.8))
        if coverage(arr) < 0.6:
            notes.append(f"{name} hid their face from the gods")
    score = float(np.mean(list(per_char.values()))) if per_char else 0
    how = ("Faces matched moment by moment against the film actors (expression shape and changes)"
           if used_ref else "Facial emotion compared to what each line demands, relative to your resting face")
    return {"score": round(score), "note": f"{how}. " + ("; ".join(notes) + "." if notes else ""),
            "per_character": per_char, "moments": moments, "lines": _line_breakdown(scene, frames),
            "raw": raws}


# =========================================================================== total

def total(judges: dict) -> dict:
    """Weighted mean, gated by Athena: if the lines weren't said, nothing else can carry the take."""
    mean = sum(judges[k]["score"] * w for k, w in WEIGHTS.items())
    gate = smoothstep(judges["athena"]["score"], 10, 95)
    avg = mean * gate
    rank = next(name for floor, name in RANKS if avg >= floor)
    return {"score": round(avg), "kleos": round(avg * 10), "rank": rank, "gate": round(gate, 2)}
