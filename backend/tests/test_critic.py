"""Tests for the Gemini side-by-side acting critic. Run as a script from anywhere:

    .venv\\Scripts\\python backend\\tests\\test_critic.py

Needs the (gitignored) film clip at scenes/media/beggar-in-the-hall.mp4. Gemini is mocked;
no API keys are used or required.
"""
from __future__ import annotations

import json
import os
import shutil
import sys
import tempfile
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)
for k in ("ELEVENLABS_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MONGODB_URI"):
    os.environ.pop(k, None)

from fastapi.testclient import TestClient  # noqa: E402

import app as A  # noqa: E402
import film_frames  # noqa: E402
import oracle  # noqa: E402
import store  # noqa: E402

# app.py's load_dotenv may have re-populated keys from a local .env; tests control them explicitly.
for k in ("ELEVENLABS_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "MONGODB_URI"):
    os.environ.pop(k, None)

SCENE_ID = "beggar-in-the-hall"
TMP = Path(tempfile.mkdtemp(prefix="critic_test_"))
store._LOCAL = TMP / "runs.json"  # keep the real leaderboard untouched
film_frames.CACHE_DIR = TMP / "frame_cache"
client = TestClient(A.app)  # no `with`: skip startup warm-up (Whisper download)
results: list[tuple[str, bool, str]] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    results.append((name, bool(ok), detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}" + (f" - {detail}" if detail else ""))


def scene() -> dict:
    return A.load_scenes()[SCENE_ID]


def perform(frames: list[bytes], snapshot_times: list[float] | None = None) -> dict:
    sc = scene()
    n = int(sc["duration"] * 10)
    players = [{"pose": [None] * n, "face": [None] * n} for _ in range(3)]
    meta = {
        "scene_id": SCENE_ID, "team_name": "Test Crew",
        "players": [{"name": "A"}, {"name": "B"}, {"name": "C"}],
        "assignments": {"antinous": 0, "penelope": 1, "odysseus": 2},
        "features": {"fps": 10, "players": players},
        "browser_transcript": [{"text": "all of us who failed your test", "t": 4.0},
                               {"text": "the trial is over", "t": 18.0}],
    }
    if snapshot_times is not None:
        meta["snapshot_times"] = snapshot_times
    files = [("frames", (f"f{i}.jpg", f, "image/jpeg")) for i, f in enumerate(frames)]
    r = client.post("/api/perform", data={"meta": json.dumps(meta)}, files=files)
    assert r.status_code == 200, r.text
    return r.json()


class MockGemini:
    def __init__(self, reply):
        self.reply = reply
        self.contents = None

    async def __call__(self, contents, key):
        self.contents = contents
        return self.reply if isinstance(self.reply, str) else json.dumps(self.reply)


VALID = {
    "athena": "Words well placed.", "apollo": "A fine voice.", "ares": "Bold moves.",
    "aphrodite": "Such feeling.", "zeus": "Hear me, mortals, you have done well.",
    "epithet": "the Bow-Bending Crew",
    "acting": {"antinous": {"score": 12, "why": "nailed the sneer"},   # clamps to 10
               "penelope": {"score": "7", "why": "regal"},             # numeric string accepted
               "odysseus": {"score": "great"},                         # not numeric -> dropped
               "polyphemus": {"score": 9, "why": "not in this scene"}},  # unknown id -> ignored
    "muse_bonus": 9,                                                   # clamps to 5
}


def main() -> None:
    sc = scene()
    if not sc.get("video"):
        sys.exit("Film clip missing: copy beggar-in-the-hall.mp4 into scenes/media/ first")

    # 1) film frame extraction + cache
    times = [1.0, 5.55, 15.0]
    pairs = film_frames.film_pairs(sc, A.SCENES_DIR, times)
    jpegs = [p["film"] for p in pairs]
    check("film frames are JPEGs", all(j and j[:2] == b"\xff\xd8" for j in jpegs),
          f"sizes {[len(j or b'') for j in jpegs]}")
    cached = sorted(p.name for p in (film_frames.CACHE_DIR / SCENE_ID).glob("*.jpg"))
    check("cached per 0.1s", cached == ["1.0.jpg", "15.0.jpg", "5.5.jpg"] or cached == ["1.0.jpg", "15.0.jpg", "5.6.jpg"],
          str(cached))
    # 5.55s: Antinous on screen while the beggar says "I haven't."; 15.0s: the beggar's reaction shot
    check("shot/line labels", pairs[1]["character"] == "antinous" and pairs[2]["character"] == "odysseus"
          and pairs[1]["line"] and pairs[1]["line"].startswith("odysseus") and pairs[0]["line"] is None,
          f"{pairs[1]['character']} / {pairs[2]['character']} / {pairs[1]['line']}")
    real_ffmpeg = film_frames.ffmpeg_exe
    film_frames.ffmpeg_exe = lambda: (_ for _ in ()).throw(RuntimeError("ffmpeg must not run on cache hit"))
    try:
        again = film_frames.film_pairs(sc, A.SCENES_DIR, times)
        check("second extraction served from cache", [p["film"] for p in again] == jpegs)
    finally:
        film_frames.ffmpeg_exe = real_ffmpeg

    player_frames = jpegs[:3]  # any JPEG will do as a "webcam" snapshot

    # 2) no key -> unchanged behaviour, critic absent
    base = perform(player_frames, [1.0, 5.55, 15.0])
    check("no key: critic absent", base["critic"] is None and base["verdict"]["source"] == "fallback")
    check("no key: score straight from the four judges", base["score"] == A.scoring.total(base["judges"])["score"],
          f"score {base['score']} kleos {base['kleos']}")

    os.environ["GEMINI_API_KEY"] = "test-key"
    real_generate = oracle._gemini_generate
    try:
        # 3) valid JSON -> critic applied and clamped
        mock = MockGemini(VALID)
        oracle._gemini_generate = mock
        r = perform(player_frames, [1.0, 5.55, 15.0])
        c = r["critic"]
        check("valid: critic present", c is not None and c["source"] == "gemini", json.dumps(c))
        check("valid: unknown/non-numeric ids dropped", set(c["acting"]) == {"antinous", "penelope"}, str(set(c["acting"])))
        check("valid: scores clamped", c["acting"]["antinous"]["score"] == 10 and c["acting"]["penelope"]["score"] == 7)
        check("valid: muse bonus clamped", c["muse_bonus"] == 5)
        expect = max(0.0, min(100.0, 0.9 * base["score"] + 0.1 * (10 * (10 + 7) / 2) + 5))
        check("valid: score formula", r["score"] == round(expect) and r["kleos"] == round(expect * 10)
              and c["base_score"] == base["score"], f"base {base['score']} -> {r['score']} (expected {expect:.1f})")
        rank = next(n for f, n in A.scoring.RANKS if expect >= f)
        check("valid: rank recomputed", r["rank"] == rank, r["rank"])
        check("valid: verdict text from gemini", r["verdict"]["source"] == "gemini" and r["verdict"]["epithet"] == VALID["epithet"]
              and "critic" not in r["verdict"])
        labels = [x for x in mock.contents if isinstance(x, str)]
        images = [x for x in mock.contents if not isinstance(x, str)]
        check("valid: FILM/PLAYERS pairs sent in order",
              labels[0].startswith("FILM at t=1.0s") and labels[1] == "PLAYERS at t=1.0s"
              and labels[4].startswith("FILM at t=15.0s - on screen: The Beggar") and len(images) == 6,
              f"{labels[:2]} ... {len(images)} images")
        check("valid: prompt asks for acting critique", "muse_bonus" in labels[-1] and "PAIRS" in labels[-1])

        # 4) malformed JSON -> graceful fallback, score unchanged
        oracle._gemini_generate = MockGemini("{not json")
        r = perform(player_frames, [1.0, 5.55, 15.0])
        check("malformed: fallback, no critic", r["critic"] is None and r["verdict"]["source"] == "fallback")
        check("malformed: score unchanged", r["score"] == base["score"] and r["kleos"] == base["kleos"])

        # 4b) valid text but no usable acting marks -> verdict from gemini, score unchanged
        oracle._gemini_generate = MockGemini({**VALID, "acting": {"nobody": 3}, "muse_bonus": "lots"})
        r = perform(player_frames, [1.0, 5.55, 15.0])
        check("no usable marks: critic absent, score unchanged",
              r["critic"] is None and r["verdict"]["source"] == "gemini" and r["score"] == base["score"])

        # 5) snapshot_times absent -> default fractions of the scene duration
        mock = MockGemini(VALID)
        oracle._gemini_generate = mock
        perform(player_frames)  # 3 frames, no times
        want = [round(f * sc["duration"], 2) for f in film_frames.DEFAULT_FRACTIONS][:3]
        got = [x for x in mock.contents if isinstance(x, str) and x.startswith("PLAYERS at")]
        check("default snapshot times", got == [f"PLAYERS at t={t:.1f}s" for t in want], f"{got} vs {want}")
        check("snapshot_times helper", film_frames.snapshot_times({}, sc, 3) == want
              and film_frames.snapshot_times({"snapshot_times": [1, "x", 3]}, sc, 3) == [1.0, 0.0, 3.0])

        # 6) scene without a film -> no pairs, gemini still used, no critic
        mock = MockGemini(VALID)
        oracle._gemini_generate = mock
        meta = {"scene_id": "my-name-is-noman", "team_name": "t", "players": [{"name": "A"}, {"name": "B"}],
                "assignments": {"polyphemus": 0, "odysseus": 1},
                "features": {"fps": 10, "players": [{"pose": [None] * 20, "face": [None] * 20}] * 2},
                "browser_transcript": []}
        rr = client.post("/api/perform", data={"meta": json.dumps(meta)},
                         files=[("frames", ("f.jpg", player_frames[0], "image/jpeg"))]).json()
        check("text scene: no critic, solo frames", rr["critic"] is None and rr["verdict"]["source"] == "gemini"
              and not any(isinstance(x, str) and x.startswith("FILM") for x in mock.contents))
    finally:
        oracle._gemini_generate = real_generate
        os.environ.pop("GEMINI_API_KEY", None)
        shutil.rmtree(TMP, ignore_errors=True)

    failed = [n for n, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
