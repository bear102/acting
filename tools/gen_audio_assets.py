"""Generate the game's sound effects, music and ambience with ElevenLabs (run once; files are committed).

  .venv\\Scripts\\python tools\\gen_audio_assets.py            # only missing files
  .venv\\Scripts\\python tools\\gen_audio_assets.py --force    # regenerate everything
  .venv\\Scripts\\python tools\\gen_audio_assets.py --only gong,theme

Needs ELEVENLABS_API_KEY in .env. Prints the credit cost of every call (character-cost header).
Output: frontend/public/audio/{sfx,music,ambient}/<name>.mp3
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

import httpx
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "frontend" / "public" / "audio"
API = "https://api.elevenlabs.io/v1"

# name: (prompt, seconds)
SFX = {
    "gong": ("a single deep bronze temple gong strike, warm, with a short shimmering decay", 1.8),
    "cut": ("a single sharp loud wooden film clapperboard slate clap, crisp transient", 1.0),
    "thunder": ("a rolling thunderclap echoing across mountains, epic", 3.0),
    "rank-swine": ("a pig snorts and a crowd jeers and laughs", 3.0),
    "rank-lotus": ("a sleepy yawning sigh over a soft lyre glissando", 3.0),
    "rank-oarsman": ("oars splashing in rhythm then a short cheer from sailors", 3.0),
    "rank-hero": ("a bronze war horn blast followed by a cheering crowd in a great hall", 3.5),
    "rank-favored": ("an owl screech then warm applause and a harp flourish", 3.5),
    "rank-gods": ("a thunderclap, a heavenly choir swell and a roaring crowd", 4.0),
    "applause": ("enthusiastic applause in an ancient amphitheater", 3.0),
}

# name: (prompt, milliseconds)
MUSIC = {
    "theme": ("epic ancient Greek instrumental, solo lyre and frame drum with low strings, slow, mysterious, "
              "mythic, no vocals", 30_000),
    "judging": ("tense suspenseful drumroll with low taiko-like drums and rising strings, ancient epic, no vocals",
                20_000),
    "fanfare-low": ("short comedic brass and lyre sting, slightly mocking, ancient Greek", 6_000),
    "fanfare-mid": ("short heroic lyre and horn fanfare", 7_000),
    "fanfare-high": ("triumphant epic orchestral fanfare with choir, ancient Greek, glorious", 8_000),
}

# seamless loops (sound-generation v2 with loop=true), name: (prompt, seconds)
AMBIENT = {
    "amb-sea": ("calm night sea, gentle waves on rocks, distant gulls", 20.0),
    "amb-hearth": ("crackling hearth fire in a stone hall, faint murmuring crowd", 20.0),
    "amb-wind": ("soft wind over ancient stone ruins at night", 20.0),
}


def normalize(path: Path, target_db: float = -1.0, bitrate: str = "128k") -> None:
    """Gain the file so its peak sits at target_db (fixes quiet transients and clipped peaks)."""
    import subprocess
    import numpy as np
    sys.path.insert(0, str(ROOT / "backend"))
    from features import decode_audio, ffmpeg_exe
    y = decode_audio(path, sr=44100)
    peak = 20 * np.log10(float(np.abs(y).max()) + 1e-9)
    gain = target_db - peak
    if abs(gain) < 0.5:
        return
    tmp = path.with_suffix(".tmp.mp3")
    subprocess.run([ffmpeg_exe(), "-v", "error", "-y", "-i", str(path), "-af", f"volume={gain:.2f}dB",
                    "-c:a", "libmp3lame", "-b:a", bitrate, str(tmp)], check=True)
    tmp.replace(path)
    print(f"    normalized {path.name}: peak {peak:+.1f} dB -> {target_db:+.1f} dB")


def save(resp: httpx.Response, path: Path, label: str, spent: list[int]) -> None:
    if resp.status_code != 200:
        print(f"  ! {label}: HTTP {resp.status_code} {resp.text[:200]}")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(resp.content)
    cost = int(resp.headers.get("character-cost", "0") or 0)
    spent.append(cost)
    print(f"  {label}: {len(resp.content) // 1024} KB, cost {cost}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--only", default="", help="comma-separated names")
    ap.add_argument("--no-ambient", action="store_true")
    args = ap.parse_args()
    load_dotenv(ROOT / ".env")
    key = os.getenv("ELEVENLABS_API_KEY")
    if not key:
        sys.exit("ELEVENLABS_API_KEY missing in .env")
    only = {s.strip() for s in args.only.split(",") if s.strip()}
    want = lambda n, p: (not only or n in only) and (args.force or not p.exists())  # noqa: E731
    H = {"xi-api-key": key}
    spent: list[int] = []
    with httpx.Client(timeout=180) as c:
        for name, (prompt, sec) in SFX.items():
            p = OUT / "sfx" / f"{name}.mp3"
            if want(name, p):
                save(c.post(f"{API}/sound-generation", headers=H, params={"output_format": "mp3_44100_128"},
                            json={"text": prompt, "duration_seconds": sec, "prompt_influence": 0.5}), p, name, spent)
        for name, (prompt, ms) in MUSIC.items():
            p = OUT / "music" / f"{name}.mp3"
            if want(name, p):
                save(c.post(f"{API}/music", headers=H, params={"output_format": "mp3_44100_96"},
                            json={"prompt": prompt, "music_length_ms": ms}), p, name, spent)
        if not args.no_ambient:
            for name, (prompt, sec) in AMBIENT.items():
                p = OUT / "ambient" / f"{name}.mp3"
                if want(name, p):
                    save(c.post(f"{API}/sound-generation", headers=H, params={"output_format": "mp3_44100_64"},
                                json={"text": prompt, "duration_seconds": sec, "prompt_influence": 0.5,
                                      "loop": True, "model_id": "eleven_text_to_sound_v2"}), p, name, spent)
    for p in sorted((OUT / "sfx").glob("*.mp3")):
        if not only or p.stem in only:
            normalize(p, -1.0, "128k")
    for p in sorted((OUT / "music").glob("*.mp3")):
        if not only or p.stem in only:
            normalize(p, -1.0, "96k")
    print(f"credits spent this run: {sum(spent)}")


if __name__ == "__main__":
    main()
