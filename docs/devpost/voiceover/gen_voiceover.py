"""Generate the Devpost demo-video voiceover with ElevenLabs v3 TTS.

Run from the repo root:  .venv\\Scripts\\python docs\\devpost\\voiceover\\gen_voiceover.py [--voice ID]

Writes voiceover.mp3, script.md and voiceover-timed.md next to this file. Audio tags in
[brackets] are performance directions for eleven_v3 (acted, not spoken); the script checks
that by transcribing the result with Scribe and failing if any tag word shows up.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
load_dotenv(ROOT / ".env")
API = "https://api.elevenlabs.io/v1"
BRIAN = "nPczCjzI2devNBz1zQrb"  # premade fallback narrator

# (tag, sentence) — tags are v3 audio tags; one sentence per entry so timings are per sentence.
SCRIPT = [
    ("solemn", "Homer sang of a man of many turns."),
    ("solemn", "Tonight, you become him."),
    ("warmly", "Trials of Odysseus is a party game: pick a scene from the Odyssey, watch the film, and act it out with your crew."),
    ("excited", "The gods are watching."),
    ("excited", "Athena judges your words with ElevenLabs Scribe."),
    ("excited", "Apollo, your voice. Ares, your body, and Aphrodite, your face, tracked live with MediaPipe."),
    ("dramatic", "Then the council delivers its verdict, and your crew earns kleos in the Hall of Heroes."),
    ("solemn", "Act the epic. Face the gods."),
]


def bard_voice() -> str | None:
    p = ROOT / "backend" / "voices.json"
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8")).get("bard")
        except Exception:  # noqa: BLE001
            return None
    return None


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--voice", help="voice id (default: backend/voices.json 'bard', else Brian)")
    args = ap.parse_args()
    voice = args.voice or bard_voice() or BRIAN
    key = os.environ["ELEVENLABS_API_KEY"]
    H = {"xi-api-key": key}

    text = " ".join(f"[{tag}] {s}" for tag, s in SCRIPT)
    with httpx.Client(timeout=180) as c:
        r = c.post(f"{API}/text-to-speech/{voice}/with-timestamps", headers=H,
                   params={"output_format": "mp3_44100_128"},
                   json={"text": text, "model_id": "eleven_v3"})
        r.raise_for_status()
        cost = int(r.headers.get("character-cost", 0) or 0)
        data = r.json()
        audio = base64.b64decode(data["audio_base64"])
        (HERE / "voiceover.mp3").write_bytes(audio)

        # Verify the tags were acted, not read aloud.
        s = c.post(f"{API}/speech-to-text", headers=H, data={"model_id": "scribe_v2", "language_code": "en"},
                   files={"file": ("voiceover.mp3", audio, "audio/mpeg")})
        s.raise_for_status()
        heard = s.json().get("text", "")
        cost += int(s.headers.get("character-cost", 0) or 0)

    spoken_tags = sorted({t for t, _ in SCRIPT if re.search(rf"\b{t}\b", heard, re.I)})

    # Per-sentence timings from the character alignment: map each sentence's span in `text`.
    al = data.get("normalized_alignment") or data["alignment"]
    chars, starts, ends = al["characters"], al["character_start_times_seconds"], al["character_end_times_seconds"]
    joined = "".join(chars)
    rows, pos = [], 0
    for tag, sent in SCRIPT:
        i = joined.find(sent[:20], pos)
        if i < 0:
            rows.append((tag, sent, None, None))
            continue
        j = min(len(chars) - 1, i + len(sent) - 1)
        rows.append((tag, sent, starts[i], ends[j]))
        pos = j
    duration = max(e for *_, e in rows if e is not None)

    (HERE / "script.md").write_text(
        "# Demo voiceover script\n\nGenerated with ElevenLabs `eleven_v3` text-to-speech "
        f"(voice `{voice}`). Bracketed audio tags are performance directions, not spoken.\n\n"
        "```\n" + text + "\n```\n", encoding="utf-8")
    lines = ["# Voiceover timings", "", f"`voiceover.mp3`: {duration:.1f}s. Cut the demo video to these marks.", "",
             "| # | Start | End | Tone | Line |", "|---|---|---|---|---|"]
    for k, (tag, sent, a, b) in enumerate(rows, 1):
        fmt = lambda t: "?" if t is None else f"{int(t // 60)}:{t % 60:05.2f}"  # noqa: E731
        lines.append(f"| {k} | {fmt(a)} | {fmt(b)} | {tag} | {sent} |")
    (HERE / "voiceover-timed.md").write_text("\n".join(lines) + "\n", encoding="utf-8")

    print(json.dumps({"voice": voice, "duration_s": round(duration, 2), "approx_credits": cost,
                      "tags_read_aloud": spoken_tags, "heard": heard[:400]}, indent=1))
    if spoken_tags:
        sys.exit(2)


if __name__ == "__main__":
    main()
