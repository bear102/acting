"""The reel: the judges' numbers recut into things a player can read at a glance.

Nothing here changes the score. It reshapes what the four judges already measured into:

  beats    one per scripted line: the four domain scores, 0-3 laurels, word-by-word hits,
           and how far off cue the line landed
  voyage   where the total sits on the road of ranks, and how many kleos the next rank costs
  crew     a Homeric epithet per player, taken from the domain they were strongest in
  awards   a few superlatives that are only true of THIS take (best line, streak, timing...)
"""
from __future__ import annotations

from scoring import RANKS, WEIGHTS

DOMAINS = {"words": "athena", "voice": "apollo", "body": "ares", "face": "aphrodite"}
LAUREL_FLOORS = (25, 50, 75)  # beat score needed for 1, 2, 3 laurels
SPOKEN_MIN = 30  # a line the gods barely heard can earn one laurel at most ("lines gate everything")

EPITHETS = {
    "words": "the Silver-Tongued",
    "voice": "the Lyre-Voiced",
    "body": "the Bronze-Limbed",
    "face": "of the Thousand Faces",
}
FAINT_EPITHET = "the Lotus-Dazed"  # nobody's strong suit reached 35


def _by_line(judge: dict) -> dict[int, dict]:
    return {l["line"]: l for l in judge.get("lines") or [] if isinstance(l.get("line"), int)}


def _laurels(score: float, words: float) -> int:
    n = sum(score >= f for f in LAUREL_FLOORS)
    return min(n, 1) if words < SPOKEN_MIN else n


def beats(scene: dict, judges: dict, assignments: dict, names: list[str]) -> list[dict]:
    ath, apo = _by_line(judges["athena"]), _by_line(judges["apollo"])
    are, aph = _by_line(judges["ares"]), _by_line(judges["aphrodite"])
    out = []
    for li, line in enumerate(scene["lines"]):
        char = line["character"]
        a = ath.get(li, {})
        # Body and face are judged per line only when the film gives a reference for that moment;
        # otherwise the line carries its character's score for the whole take.
        body = are[li]["score"] if li in are else judges["ares"].get("per_character", {}).get(char, 0)
        face = aph[li]["score"] if li in aph else judges["aphrodite"].get("per_character", {}).get(char, 0)
        scores = {"words": a.get("score", 0), "voice": apo.get(li, {}).get("score", 0),
                  "body": body, "face": face}
        score = sum(scores[d] * WEIGHTS[j] for d, j in DOMAINS.items())
        heard_at = a.get("heard_at")
        pi = assignments.get(char)
        out.append({
            "line": li, "character": char, "player": pi,
            "player_name": names[pi] if pi is not None and pi < len(names) else None,
            "text": line["text"], "start": line["start"], "end": line["end"],
            "emotion": line.get("emotion"),
            "scores": {k: round(v) for k, v in scores.items()},
            "score": round(score),
            "laurels": _laurels(score, scores["words"]),
            "words": a.get("words") or [{"w": w, "hit": 0} for w in line["text"].split()],
            "heard": a.get("heard", ""),
            "offset": None if heard_at is None else round(heard_at - line["start"], 2),
        })
    return out


def voyage(overall: dict) -> dict:
    """The road of ranks. `next` is the rank above the current one and the kleos it still costs."""
    ladder = sorted(RANKS)  # low -> high
    above = [(floor, name) for floor, name in ladder if floor * 10 > overall["kleos"]]
    nxt = {"name": above[0][1], "kleos": above[0][0] * 10, "gap": above[0][0] * 10 - overall["kleos"]} if above else None
    return {"kleos": overall["kleos"], "rank": overall["rank"], "next": nxt,
            "waypoints": [{"kleos": floor * 10, "name": name} for floor, name in ladder]}


def _streak(bs: list[dict]) -> int:
    best = run = 0
    for b in bs:
        run = run + 1 if b["laurels"] >= 2 else 0
        best = max(best, run)
    return best


def crew(bs: list[dict], judges: dict, stars: list[dict]) -> list[dict]:
    out = []
    for pi, star in enumerate(stars):
        mine = [b for b in bs if b["player"] == pi]
        chars = star.get("characters") or []
        doms = {}
        if mine:
            doms["words"] = sum(b["scores"]["words"] for b in mine) / len(mine)
            doms["voice"] = sum(b["scores"]["voice"] for b in mine) / len(mine)
        for d, j in (("body", "ares"), ("face", "aphrodite")):
            vals = [judges[j].get("per_character", {}).get(c) for c in chars]
            vals = [v for v in vals if v is not None]
            if vals:
                doms[d] = sum(vals) / len(vals)
        best = max(doms, key=doms.get) if doms else None
        epithet = EPITHETS[best] if best and doms[best] >= 35 else FAINT_EPITHET
        out.append({**star, "epithet": epithet, "best": best if best and doms[best] >= 35 else None,
                    "domains": {k: round(v) for k, v in doms.items()}})
    return out


def awards(bs: list[dict], judges: dict) -> list[dict]:
    """Up to four superlatives, praise first. Each one states a fact about this take."""
    praise, roast = [], []
    if not bs:
        return []
    best = max(bs, key=lambda b: b["score"])
    if best["score"] >= 50:
        who = f" ({best['player_name']})" if best["player_name"] else ""
        praise.append({"id": "best_line", "title": "Line of the Night", "line": best["line"],
                       "detail": f"“{best['text']}”{who}"})

    perfect = sum(b["scores"]["words"] >= 95 for b in bs)
    if perfect == len(bs) and len(bs) > 1:
        praise.append({"id": "scribe", "title": "Homer's Own Scribe", "detail": "Every line word-perfect"})
    elif perfect:
        praise.append({"id": "word_perfect", "title": "Word-Perfect",
                       "detail": f"{perfect} of {len(bs)} lines without a slip"})

    run = _streak(bs)
    if run >= 3:
        praise.append({"id": "streak", "title": "Fair Winds", "detail": f"{run} lines in a row with two laurels or more"})

    offs = [b["offset"] for b in bs if b["offset"] is not None]
    if len(offs) >= 2:
        mean_abs, mean = sum(abs(o) for o in offs) / len(offs), sum(offs) / len(offs)
        if mean_abs <= 0.35:
            praise.append({"id": "on_cue", "title": "Swift as Hermes",
                           "detail": f"Lines landed within {mean_abs:.1f}s of their cue"})
        elif mean >= 1.0:
            roast.append({"id": "late", "title": "Late for the Trojan Horse",
                          "detail": f"{mean:.1f}s behind the cue on average"})
        elif mean <= -1.0:
            roast.append({"id": "early", "title": "Sailed Before the Wind",
                          "detail": f"{-mean:.1f}s ahead of the cue on average"})

    spoke = judges["athena"]["score"] >= 40
    if spoke and judges["aphrodite"]["score"] < 15:
        roast.append({"id": "stone_face", "title": "Gaze of Medusa", "detail": "Faces of stone from first line to last"})
    if spoke and judges["ares"]["score"] < 15:
        roast.append({"id": "statue", "title": "Statues of Yourselves", "detail": "Barely a gesture all scene"})
    silent = sum(b["offset"] is None and b["scores"]["words"] < SPOKEN_MIN for b in bs)
    if silent and silent < len(bs):
        roast.append({"id": "lost_lines", "title": "Lost at Sea",
                      "detail": f"{silent} line{'s' if silent > 1 else ''} the gods never heard"})

    out = [{**a, "tone": "praise"} for a in praise] + [{**a, "tone": "roast"} for a in roast]
    return out[:4]


def build(scene: dict, judges: dict, assignments: dict, stars: list[dict], overall: dict) -> dict:
    names = [s["name"] for s in stars]
    bs = beats(scene, judges, assignments, names)
    ranked = sorted(bs, key=lambda b: b["score"])
    return {
        "beats": bs,
        "best": ranked[-1]["line"] if bs else None,
        "worst": ranked[0]["line"] if len(bs) > 1 and ranked[0]["score"] < ranked[-1]["score"] else None,
        "laurels": sum(b["laurels"] for b in bs), "laurels_max": 3 * len(bs),
        "streak": _streak(bs),
        "voyage": voyage(overall),
        "crew": crew(bs, judges, stars),
        "awards": awards(bs, judges),
    }


def highlights(r: dict) -> str:
    """Two lines for the commentary prompt so the gods can name the actual best and worst line."""
    by = {b["line"]: b for b in r["beats"]}
    out = []
    for label, key in (("STRONGEST LINE", "best"), ("WEAKEST LINE", "worst")):
        b = by.get(r.get(key))
        if b:
            who = f" by {b['player_name']}" if b["player_name"] else ""
            out.append(f"{label}: \"{b['text']}\"{who} (words {b['scores']['words']}, voice {b['scores']['voice']}, "
                       f"body {b['scores']['body']}, face {b['scores']['face']})")
    return "\n".join(out)


def hall_place(rows: list[dict], kleos: int) -> dict:
    """Where this take sits among the scene's saved runs (this run included), and the crew just ahead."""
    ahead = [r for r in rows if r.get("kleos", 0) > kleos]
    out = {"place": len(ahead) + 1, "of": max(len(rows), len(ahead) + 1), "rival": None}
    if ahead:
        rival = min(ahead, key=lambda r: r.get("kleos", 0))
        out["rival"] = {"team_name": rival.get("team_name"), "kleos": rival.get("kleos", 0),
                        "gap": rival.get("kleos", 0) - kleos}
    return out
