"""Offline speech-to-text with faster-whisper. Used when there's no ElevenLabs key
(live scoring) and by the clip preprocessor.

Pass audio as a 16 kHz mono float32 numpy array (features.decode_audio). Passing a file path
breaks: faster-whisper's own decoder is incompatible with the installed PyAV version.
"""
from __future__ import annotations

import logging
import os
import threading

import numpy as np

log = logging.getLogger("local_stt")
_models: dict[str, object] = {}
_lock = threading.Lock()


def available() -> bool:
    try:
        import faster_whisper  # noqa: F401
        return True
    except Exception:  # noqa: BLE001
        return False


def _model(name: str):
    with _lock:
        if name not in _models:
            from faster_whisper import WhisperModel

            log.info("Loading Whisper model %s (first use downloads it)", name)
            _models[name] = WhisperModel(name, device="cpu", compute_type="int8")
        return _models[name]


def default_model() -> str:
    # base.en keeps live scoring quick on a laptop CPU; preprocessing asks for small.en.
    return os.getenv("WHISPER_MODEL", "base.en")


def transcribe_pcm(y: np.ndarray, model: str | None = None) -> list[dict]:
    """-> [{"text", "start", "end"}] one entry per word, in spoken order."""
    if y is None or len(y) < 1600:
        return []
    segments, _ = _model(model or default_model()).transcribe(
        y.astype(np.float32), language="en", word_timestamps=True, beam_size=1,
        condition_on_previous_text=False)
    words = []
    for seg in segments:
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append({"text": text, "start": round(float(w.start), 2), "end": round(float(w.end), 2)})
    return words


def words_to_segments(words: list[dict], gap: float = 0.8) -> list[dict]:
    """Group words into sentence-ish segments: split on . ? ! or a pause longer than gap."""
    segs, cur = [], []
    for i, w in enumerate(words):
        if cur and w.get("start") is not None and cur[-1].get("end") is not None \
                and w["start"] - cur[-1]["end"] > gap:
            segs.append(cur)
            cur = []
        cur.append(w)
        if w["text"].rstrip()[-1:] in ".?!":
            segs.append(cur)
            cur = []
    if cur:
        segs.append(cur)
    return [{"text": " ".join(w["text"] for w in s), "start": s[0]["start"], "end": s[-1]["end"]}
            for s in segs]
