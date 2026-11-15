"""External oracles: ElevenLabs (ears + voice of Zeus) and Gemini (the gods' wit).

Every call degrades gracefully - the game must still finish a round with no keys at all.
"""
from __future__ import annotations

import base64
import json
import logging
import os
import random

import httpx

log = logging.getLogger("oracle")

EL_BASE = "https://api.elevenlabs.io/v1"


def _el_key() -> str | None:
    return os.getenv("ELEVENLABS_API_KEY") or None


def _gemini_key() -> str | None:
    return os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY") or None


def status() -> dict:
    return {"elevenlabs": bool(_el_key()), "gemini": bool(_gemini_key())}


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


# --------------------------------------------------------------------------- ElevenLabs TTS

async def speak(text: str) -> str | None:
    """Return base64 mp3 of Zeus speaking, or None."""
    key = _el_key()
    if not key or not text:
        return None
    voice = os.getenv("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            r = await client.post(
                f"{EL_BASE}/text-to-speech/{voice}",
                params={"output_format": "mp3_44100_128"},
                headers={"xi-api-key": key, "Content-Type": "application/json"},
                json={
                    "text": text,
                    "model_id": os.getenv("ELEVENLABS_TTS_MODEL", "eleven_multilingual_v2"),
                    "voice_settings": {"stability": 0.35, "similarity_boost": 0.8, "style": 0.6},
                },
            )
            r.raise_for_status()
            return base64.b64encode(r.content).decode()
    except Exception as e:  # noqa: BLE001
        log.warning("ElevenLabs TTS failed: %s", e)
        return None


# --------------------------------------------------------------------------- Gemini verdict

PROMPT = """You are the council of Olympian gods judging mortals who just performed a scene
from Homer's Odyssey in a party game called "Trials of Odysseus". Be funny, theatrical and
specific, like a game-show panel - roast gently, praise loudly, never cruel. Speak in a mock-epic
Homeric register (epithets, "wine-dark", "rosy-fingered", etc.) but keep it punchy.

SCENE: {title} ({book})
TEAM: {team}
CAST (player -> character): {cast}

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

{frames_hint}

Respond with JSON only:
{{
  "athena": "<one sentence from Athena about the words>",
  "apollo": "<one sentence from Apollo about the voice>",
  "ares": "<one sentence from Ares about movement>",
  "aphrodite": "<one sentence from Aphrodite about emotion>",
  "zeus": "<Zeus's final verdict, 2-3 sentences, spoken aloud, references something concrete>",
  "epithet": "<a Homeric epithet for the team, e.g. 'the Wine-Spilling Crew'>"
}}"""


async def verdict(scene: dict, team: str, cast: str, heard: str, judges: dict,
                  overall: dict, frames: list[bytes]) -> dict:
    key = _gemini_key()
    if key:
        try:
            from google import genai
            from google.genai import types

            script = "\n".join(f"{l['character'].upper()}: {l['text']}" for l in scene["lines"])
            prompt = PROMPT.format(
                title=scene["title"], book=scene.get("book", ""), team=team, cast=cast,
                script=script, heard=heard or "(nothing intelligible)", overall=overall,
                frames_hint=("Attached are snapshots from the performance - mention costumes, "
                             "props, faces or poses you notice." if frames else ""),
                **judges,
            )
            parts = [types.Part.from_bytes(data=f, mime_type="image/jpeg") for f in frames[:4]]
            client = genai.Client(api_key=key)
            resp = await client.aio.models.generate_content(
                model=os.getenv("GEMINI_MODEL", "gemini-2.5-flash"),
                contents=[*parts, prompt],
                config=types.GenerateContentConfig(response_mime_type="application/json", temperature=1.0),
            )
            data = json.loads(resp.text)
            if all(k in data for k in ("athena", "apollo", "ares", "aphrodite", "zeus")):
                data["source"] = "gemini"
                return data
        except Exception as e:  # noqa: BLE001
            log.warning("Gemini verdict failed: %s", e)
    return _fallback(judges, overall)


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
        "zeus": random.choice([
            f"I, Zeus, cloud-gatherer, have watched. Your glory is {overall['kleos']} kleos - "
            f"you are named {overall['rank']}. Now go, before Poseidon notices you.",
            f"Hear me, mortals! {overall['kleos']} kleos. The council names you {overall['rank']}. "
            "Pour a libation and try again.",
        ]),
        "epithet": random.choice(["the Storm-Tossed Crew", "the Much-Enduring Troupe",
                                  "the Wine-Dark Players", "the Lotus-Dazed Company"]),
        "source": "fallback",
    }
