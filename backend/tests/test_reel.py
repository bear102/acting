"""The reel reshapes judge output for the verdict screen; it must never invent points.

Run:  .venv\\Scripts\\python backend\\tests\\test_reel.py
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import reel  # noqa: E402
import scoring  # noqa: E402

SCENE = {
    "characters": [{"id": "ody", "name": "Odysseus"}, {"id": "cyc", "name": "Polyphemus"}],
    "lines": [
        {"character": "ody", "text": "My name is Noman.", "start": 1.0, "end": 3.0, "emotion": "cunning"},
        {"character": "cyc", "text": "Then I'll eat Noman last.", "start": 4.0, "end": 6.5, "emotion": "rage"},
        {"character": "ody", "text": "Drink, Cyclops - drink!", "start": 7.0, "end": 9.0, "emotion": "joy"},
    ],
}
ASSIGN = {"ody": 0, "cyc": 1}
STARS = [{"name": "Maya", "characters": ["ody"], "score": 70}, {"name": "Jo", "characters": ["cyc"], "score": 40}]


def heard(*segments):
    out = []
    for text, t in segments:
        for k, w in enumerate(text.split()):
            out.append({"text": w, "start": t + 0.3 * k, "end": t + 0.3 * k + 0.25})
    return out


def judges(words, apollo_lines=None, ares=None, aph=None):
    return {
        "athena": scoring.judge_athena(SCENE, words),
        "apollo": {"score": 60, "lines": apollo_lines or []},
        "ares": ares or {"score": 50, "per_character": {"ody": 60, "cyc": 40}, "lines": []},
        "aphrodite": aph or {"score": 50, "per_character": {"ody": 80, "cyc": 20}, "lines": []},
    }


def test_word_tokens_follow_the_script_as_written():
    j = scoring.judge_athena(SCENE, heard(("my name is noman", 1.0), ("then i will eat last", 4.0)))
    l0, l1, l2 = (l["words"] for l in j["lines"])
    assert [t["w"] for t in l0] == ["My", "name", "is", "Noman."] and all(t["hit"] == 1 for t in l0)
    # "I'll" is one token on screen but two script words; "Noman" was dropped
    assert [t["w"] for t in l1] == ["Then", "I'll", "eat", "Noman", "last."]
    assert {t["w"]: t["hit"] for t in l1}["Noman"] == 0 and {t["w"]: t["hit"] for t in l1}["I'll"] == 1
    # the bare dash is glued to the word before it, never a token of its own
    assert [t["w"] for t in l2] == ["Drink,", "Cyclops -", "drink!"] and all(t["hit"] == 0 for t in l2)


def test_repeated_phrase_lands_on_the_line_it_was_said_in():
    scene = {"lines": [
        {"character": "p", "text": "The door's unlocked until the trial's over.", "start": 13.6, "end": 16.1},
        {"character": "a", "text": "The trial is over.", "start": 16.5, "end": 18.0},
    ]}
    # Said the start of line 1, then all of line 2 on its cue: line 2 must get the credit
    j = scoring.judge_athena(scene, heard(("the door is unlocked", 13.7), ("the trial is over", 16.6)))
    assert j["lines"][1]["accuracy"] == 100 and j["lines"][0]["accuracy"] == 44  # 4 of 9 words
    # Same words, but the second half arrives inside line 1's time: that is line 1 finishing late
    j = scoring.judge_athena(scene, heard(("the door is unlocked", 13.0), ("the trial is over", 14.3)))
    assert j["lines"][0]["accuracy"] > 80 and j["lines"][1]["accuracy"] == 0


def test_beats_blend_the_judges_with_the_scoring_weights():
    js = judges(heard(("my name is noman", 1.1)),
                apollo_lines=[{"line": 0, "score": 80}, {"line": 1, "score": 0}, {"line": 2, "score": 0}])
    b0, b1, _ = reel.beats(SCENE, js, ASSIGN, ["Maya", "Jo"])
    assert b0["scores"] == {"words": 100, "voice": 80, "body": 60, "face": 80}
    assert b0["score"] == round(100 * .35 + 80 * .25 + 60 * .20 + 80 * .20) and b0["laurels"] == 3
    assert b0["player_name"] == "Maya" and abs(b0["offset"] - 0.1) < 1e-6
    # an unspoken line: no cue offset, and at most one laurel however good the face was
    assert b1["offset"] is None and b1["scores"]["words"] == 0 and b1["laurels"] <= 1


def test_unspoken_line_cannot_earn_laurels_from_body_and_face():
    js = judges([], ares={"score": 100, "per_character": {"ody": 100, "cyc": 100}, "lines": []},
                aph={"score": 100, "per_character": {"ody": 100, "cyc": 100}, "lines": []})
    assert all(b["laurels"] <= 1 for b in reel.beats(SCENE, js, ASSIGN, ["Maya", "Jo"]))


def test_film_line_scores_win_over_the_character_average():
    js = judges([], ares={"score": 50, "per_character": {"ody": 60, "cyc": 40},
                          "lines": [{"line": 1, "score": 91}]})
    bs = reel.beats(SCENE, js, ASSIGN, ["Maya", "Jo"])
    assert bs[1]["scores"]["body"] == 91 and bs[0]["scores"]["body"] == 60


def test_voyage_names_the_next_rank_and_its_cost():
    v = reel.voyage({"kleos": 613, "rank": "Oarsman of Ithaca"})
    assert v["next"] == {"name": "Hero of Troy", "kleos": 650, "gap": 37}
    assert [w["kleos"] for w in v["waypoints"]] == [0, 350, 500, 650, 780, 900]
    assert reel.voyage({"kleos": 950, "rank": "Equal to the Gods"})["next"] is None


def test_build_awards_and_crew():
    words = heard(("my name is noman", 1.0), ("then i will eat noman last", 4.1), ("drink cyclops drink", 7.1))
    js = judges(words, apollo_lines=[{"line": i, "score": 70} for i in range(3)])
    r = reel.build(SCENE, js, ASSIGN, STARS, {"kleos": 700, "rank": "Hero of Troy", "score": 70})
    ids = {a["id"] for a in r["awards"]}
    assert {"best_line", "scribe", "streak", "on_cue"} <= ids and len(r["awards"]) <= 4
    assert r["laurels_max"] == 9 and r["streak"] == 3 and r["best"] is not None
    maya, jo = r["crew"]
    assert maya["epithet"] == "the Silver-Tongued" and maya["score"] == 70
    assert jo["best"] == "words" and jo["domains"]["face"] == 20
    assert "STRONGEST LINE" in reel.highlights(r)


def test_silent_take_gets_no_praise():
    r = reel.build(SCENE, judges([]), ASSIGN, STARS, {"kleos": 0, "rank": "Swine of Circe", "score": 0})
    assert not [a for a in r["awards"] if a["tone"] == "praise"]
    assert r["laurels"] <= len(SCENE["lines"])  # one laurel a line at most when nothing was said


def test_hall_place_and_rival():
    rows = [{"team_name": "A", "kleos": 900}, {"team_name": "B", "kleos": 640}, {"team_name": "Me", "kleos": 600}]
    h = reel.hall_place(rows, 600)
    assert h["place"] == 3 and h["of"] == 3 and h["rival"] == {"team_name": "B", "kleos": 640, "gap": 40}
    assert reel.hall_place(rows, 900)["rival"] is None and reel.hall_place([], 10)["place"] == 1


def test_hall_rival_is_never_your_own_take():
    rows = [{"team_name": "A", "kleos": 900}, {"team_name": "Me", "kleos": 700},
            {"team_name": " me ", "kleos": 650}, {"team_name": "Me", "kleos": 600}]
    h = reel.hall_place(rows, 600, "Me")
    assert h["place"] == 4 and h["of"] == 4, h
    assert h["rival"] == {"team_name": "A", "kleos": 900, "gap": 300}, h  # skips both of my earlier takes
    # only my own takes are ahead: the chip chases my own best, flagged as such
    mine = [{"team_name": "Me", "kleos": 700}, {"team_name": "Me", "kleos": 600}]
    assert reel.hall_place(mine, 600, "Me")["rival"] == {"own": True, "team_name": "Me", "kleos": 700, "gap": 100}
    # no team name given: today's behaviour, the nearest row ahead whoever it is
    assert reel.hall_place(rows, 600) == {"place": 4, "of": 4, "rival": {"team_name": " me ", "kleos": 650, "gap": 50}}
    assert reel.hall_place(mine, 600)["rival"] == {"team_name": "Me", "kleos": 700, "gap": 100}


if __name__ == "__main__":  # the venv has no pytest: run as a plain script like the other harnesses
    failed = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            try:
                fn()
                print(f"[PASS] {name}")
            except AssertionError as e:
                failed += 1
                print(f"[FAIL] {name} {e}")
    sys.exit(1 if failed else 0)
