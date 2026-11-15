"""External oracles: ElevenLabs (ears) and Gemini (the gods' wit).

Every call degrades gracefully - the game must still finish a round with no keys at all.
"""
from __future__ import annotations

import json
import logging
import os
import random

import httpx

import local_stt

log = logging.getLogger("oracle")

EL_BASE = "https://api.elevenlabs.io/v1"


def _el_key() -> str | None:
    return os.getenv("ELEVENLABS_API_KEY") or None


def _gemini_key() -> str | None:
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or None


def status() -> dict:
    return {"elevenlabs": bool(_el_key()), "gemini": bool(_gemini_key()), "whisper": local_stt.available()}


# --------------------------------------------------------------------------- ElevenLabs STT

async def transcribe(audio: bytes, filename: str) -> list[dict] | None:
    """Return [{"text", "start", "end"}] word list, or None if unavailable."""
    key = _el_key()
    if not key or not audio:
        return None
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{EL_BASE}/speech-to-text",
                headers={"xi-api-key": key},
                data={"model_id": os.getenv("ELEVENLABS_STT_MODEL", "scribe_v1"),
                      "language_code": "en", "tag_audio_events": "false"},
                files={"file": (filename, audio, "audio/webm")},
            )
            r.raise_for_status()
            data = r.json()
        out = [{"text": w["text"], "start": w.get("start"), "end": w.get("end")}
               for w in data.get("words", []) if w.get("type", "word") == "word"]
        if not out and data.get("text"):
            out = [{"text": t, "start": None, "end": None} for t in data["text"].split()]
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("ElevenLabs STT failed: %s", e)
        return None


# --------------------------------------------------------------------------- local Whisper STT

async def transcribe_local(pcm) -> list[dict] | None:
    """Offline fallback: faster-whisper on decoded 16 kHz PCM. None if unavailable or it fails."""
    if pcm is None or not local_stt.available():
        return None
    from fastapi.concurrency import run_in_threadpool

    try:
        return await run_in_threadpool(local_stt.transcribe_pcm, pcm)
    except Exception as e:  # noqa: BLE001
        log.warning("Whisper STT failed: %s", e)
        return None


# --------------------------------------------------------------------------- Gemini verdict

PROMPT = """You are the council of Olympian gods judging mortals who just performed a scene
from Homer's Odyssey in a party game called "Trials of Odysseus". Be funny, theatrical and
specific, like a game-show panel - roast gently, praise loudly, never cruel. Speak in a mock-epic
Homeric register (epithets, "wine-dark", "rosy-fingered", etc.) but keep it punchy.

SCENE: {title} ({book})
TEAM: {team}
CAST (player -> character): {cast}
CHARACTER IDS: {char_ids}

SCRIPT:
{script}

WHAT THE MORTALS ACTUALLY SAID (speech-to-text):
{heard}

SCORES (0-100) AND MEASUREMENTS:
- Athena (words): {athena[score]} - {athena[note]}
- Apollo (voice): {apollo[score]} - {apollo[note]}
- Ares (movement): {ares[score]} - {ares[note]}
- Aphrodite (facial emotion): {aphrodite[score]} - {aphrodite[note]}
- Overall: {overall[score]} -> rank "{overall[rank]}"
{highlights}

{frames_hint}

The players see your words next to charts of every line, so be BRIEF: each god gets one zinger a
crowd can read in two seconds. Name a concrete moment (a line, a word they dropped, a gesture)
rather than describing the score.

Respond with JSON only:
{{
  "athena": "<Athena on the words, max 12 words>",
  "apollo": "<Apollo on the voice, max 12 words>",
  "ares": "<Ares on the movement, max 12 words>",
  "aphrodite": "<Aphrodite on the emotion, max 12 words>",
  "epithet": "<a Homeric epithet for the team, e.g. 'the Wine-Spilling Crew'>"{critic_schema}
}}"""

PAIRS_HINT = """The images come in PAIRS, in time order. Each "FILM" image is a still of the real actors
from the film at that moment; the "PLAYERS" image right after it is the mortals' webcam at the same
moment of their performance (mirrored, like a selfie). Compare them: facial expression, posture,
gesture, energy and staging. Mention a concrete resemblance or difference you see."""

SOLO_HINT = "Attached are snapshots from the performance - mention costumes, props, faces or poses you notice."

CRITIC_SCHEMA = """,
  "acting": {{"<character id>": {{"score": <0-10, how closely this player's acting resembles the film actor in the paired frames>, "why": "<max 15 words>"}}}},
  "muse_bonus": <integer -5..5 for overall theatrical commitment: costume, props, energy, bravery>"""

TEXT_KEYS = ("athena", "apollo", "ares", "aphrodite")


async def _gemini_generate(contents: list, key: str) -> str:
    """One Gemini call returning the raw JSON text. Tests monkeypatch this."""
    from google import genai
    from google.genai import types

    client = genai.Client(api_key=key)
    resp = await client.aio.models.generate_content(
        model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
        contents=contents,
        config=types.GenerateContentConfig(response_mime_type="application/json", temperature=1.0),
    )
    return resp.text


def _image(data: bytes):
    from google.genai import types

    return types.Part.from_bytes(data=data, mime_type="image/jpeg")


def build_contents(scene: dict, frames: list[bytes], pairs: list[dict] | None, prompt: str) -> list:
    """Interleave labels and images: "FILM at t=X" still then "PLAYERS at t=X" snapshot, per moment."""
    contents: list = []
    if pairs:
        for i, p in enumerate(pairs[: len(frames)]):
            if p.get("film"):
                who = _char_name(scene, p["character"]) if p.get("character") else "a wide shot"
                label = f"FILM at t={p['t']:.1f}s - on screen: {who}"
                if p.get("line"):
                    label += f"; line being spoken: {p['line']}"
                contents += [label, _image(p["film"])]
            contents += [f"PLAYERS at t={p['t']:.1f}s", _image(frames[i])]
    else:
        contents += [_image(f) for f in frames[:4]]
    contents.append(prompt)
    return contents


def parse_critic(data: dict, scene: dict) -> dict | None:
    """Validate and clamp the side-by-side critique. None unless a known character got a numeric score."""
    ids = {c["id"] for c in scene["characters"]}
    acting = {}
    raw = data.get("acting")
    if isinstance(raw, dict):
        for cid, v in raw.items():
            if cid not in ids:
                continue
            score = v.get("score") if isinstance(v, dict) else v
            try:
                score = float(score)
            except (TypeError, ValueError):
                continue
            if score != score:  # NaN
                continue
            why = v.get("why", "") if isinstance(v, dict) else ""
            acting[cid] = {"score": round(max(0.0, min(10.0, score)), 1), "why": str(why)[:160]}
    if not acting:
        return None
    try:
        bonus = int(round(float(data.get("muse_bonus", 0))))
    except (TypeError, ValueError):
        bonus = 0
    return {"acting": acting, "muse_bonus": max(-5, min(5, bonus)), "source": "gemini"}


async def verdict(scene: dict, team: str, cast: str, heard: str, judges: dict,
                  overall: dict, frames: list[bytes], pairs: list[dict] | None = None,
                  highlights: str = "") -> dict:
    """The gods' commentary. Given film `pairs` (film_frames.film_pairs), Gemini also compares the
    players with the film side by side; that lands in result["critic"] (None if unavailable/invalid)."""
    key = _gemini_key()
    has_pairs = bool(pairs and frames and any(p.get("film") for p in pairs))
    if key:
        try:
            script = "\n".join(f"{l['character'].upper()}: {l['text']}" for l in scene["lines"])
            prompt = PROMPT.format(
                title=scene["title"], book=scene.get("book", ""), team=team, cast=cast,
                char_ids=", ".join(c["id"] for c in scene["characters"]),
                script=script, heard=heard or "(nothing intelligible)", overall=overall,
                frames_hint=PAIRS_HINT if has_pairs else (SOLO_HINT if frames else ""),
                critic_schema=CRITIC_SCHEMA if has_pairs else "", highlights=highlights,
                **judges,
            )
            contents = build_contents(scene, frames, pairs if has_pairs else None, prompt)
            data = json.loads(await _gemini_generate(contents, key))
            if isinstance(data, dict) and all(isinstance(data.get(k), str) and data[k] for k in TEXT_KEYS):
                out = {k: data[k] for k in TEXT_KEYS}
                out["epithet"] = str(data.get("epithet") or "")[:80] or None
                out["source"] = "gemini"
                out["critic"] = parse_critic(data, scene) if has_pairs else None
                return out
            log.warning("Gemini verdict missing keys; using fallback")
        except Exception as e:  # noqa: BLE001
            log.warning("Gemini verdict failed: %s", e)
    return {**_fallback(judges, overall), "critic": None}


def _char_name(scene: dict, cid: str) -> str:
    return next((c["name"] for c in scene["characters"] if c["id"] == cid), cid)


def _fallback(judges: dict, overall: dict) -> dict:
    def pick(score, hi, mid, lo):
        return hi if score >= 70 else mid if score >= 45 else lo

    a, ap, ar, af = (judges[k]["score"] for k in ("athena", "apollo", "ares", "aphrodite"))
    return {
        "athena": pick(a, "Every word in its place, like spears in a phalanx. I am pleased.",
                       "You remembered most of it, which is more than the suitors ever did.",
                       "Those were words, certainly. Not Homer's, but words."),
        "apollo": pick(ap, "A voice fit for my own lyre!",
                       "Some music in it - and some ship's bilge.",
                       "Even the Sirens would plug their ears."),
        "ares": pick(ar, "You moved like warriors on the plains of Troy!",
                     "Adequate. You fought like a well-fed suitor.",
                     "You stood so still I mistook you for statues of yourselves."),
        "aphrodite": pick(af, "Such passion! Even I am moved.",
                          "A flicker of feeling, like a lamp in the wind.",
                          "Your faces showed the emotion of a boiled octopus."),
        "epithet": random.choice(["the Storm-Tossed Crew", "the Much-Enduring Troupe",
                                  "the Wine-Dark Players", "the Lotus-Dazed Company"]),
        "source": "fallback",
    }
