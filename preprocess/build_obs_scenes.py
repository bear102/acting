"""One-off builder for the 8 scenes cut from the two OBS recordings (Circe / Penelope).

Writes scenes/<id>.json (lines with emotion + direction, times relative to the clip) and
preprocess/shots/<id>.json (who is on screen per shot). preprocess_scene.py then cuts the clip,
tracks pose/face and re-times the lines with forced alignment.

Usage: python preprocess/build_obs_scenes.py <scratch dir with rec3/ and rec4/>
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SC = Path(sys.argv[1])
uA = json.loads((SC / "rec3/utterances.json").read_text())
spkA = {"speaker_0": "circe", "speaker_1": "odysseus"}
wB = [w for w in json.loads((SC / "rec4/transcript.json").read_text())["words"] if w.get("type") == "word"]
spkB = {"speaker_0": "penelope", "speaker_1": "telemachus"}

# REC-B: sentence-level utterances built from Scribe's words
uB = []
for w in wB:
    sp = w.get("speaker_id")
    if uB and uB[-1]["spk"] == sp and w["start"] - uB[-1]["end"] < 0.8 and not re.search(r"[.?!]$", uB[-1]["text"]):
        uB[-1]["text"] += " " + w["text"]
        uB[-1]["end"] = w["end"]
    else:
        uB.append({"spk": sp, "start": w["start"], "end": w["end"], "text": w["text"]})

# On-screen character per shot (absolute recording times), labelled from contact sheets.
SHOTS_A = [(69.93, 71.47, None), (71.47, 72.73, None), (72.73, 74.00, "odysseus"), (74.00, 78.80, None),
           (78.80, 79.87, "odysseus"), (79.87, 82.60, "circe"), (82.60, 83.53, "odysseus"), (83.53, 85.47, "circe"),
           (85.47, 86.33, "odysseus"), (86.33, 88.93, "circe"), (88.93, 92.40, "odysseus"), (92.40, 99.80, "circe"),
           (99.80, 102.47, "odysseus"), (102.47, 108.13, "circe"), (108.13, 111.80, "odysseus"),
           (111.80, 115.07, "circe"), (115.07, 116.40, "odysseus"), (116.40, 120.93, "circe"),
           (120.93, 122.60, "odysseus"), (122.60, 124.67, "circe"), (124.67, 125.87, "odysseus"),
           (125.87, 127.87, "circe"), (127.87, 129.07, "odysseus"), (129.07, 134.80, "circe")]
SHOTS_B = [(96.53, 106.47, "penelope"), (106.47, 109.27, "telemachus"), (109.27, 111.80, "penelope"),
           (111.80, 116.33, "telemachus"), (116.33, 123.07, "penelope"), (123.07, 125.13, "telemachus"),
           (125.13, 131.13, "penelope"), (131.13, 133.53, "telemachus"), (133.53, 140.60, "penelope"),
           (140.60, 143.73, "telemachus"), (143.73, 149.47, "penelope"), (149.47, 155.33, "telemachus"),
           (155.33, 160.00, "penelope"), (160.00, 161.33, "telemachus"), (161.33, 168.13, "penelope"),
           (168.13, 170.00, "telemachus"), (170.00, 171.67, "penelope")]

# emotion + stage direction, by the start of the line's text
ACT = [
    ("You say you're all alone", "cunning", "Circle him slowly. You already know the answer."),
    ("No?", "cunning", "Raise an eyebrow. Give nothing away."),
    ("You can only reach", "cunning", "Lean in. Tap the table with one finger."),
    ("I'm looking for them", "resolve", "Hold her gaze. Keep your voice even."),
    ("But you prepared", "cunning", "Gesture at the feast. Turn the question back on her."),
    ("You're questioning me", "rage", "Sit back, offended. Then laugh once."),
    ("A traveler who's clearly", "cunning", "Count his lies on your fingers. Savor each one."),
    ("And who breaks Zeus", "rage", "Point at the dagger. Your smile is gone."),
    ("You have sharp eyes", "awe", "A slow nod. Respect, and a warning."),
    ("Sharpened by the gods", "cunning", "Smile like a cat."),
    ("Do they grant you insights", "cunning", "Lean forward. Test her."),
    ("Truths", "cunning", "Let the pause hang. Look away, then back."),
    ("Would they tell you where I could find my men", "longing", "Your voice cracks a little. You need this."),
    ("Your men?", "cunning", "Tilt your head. Feign surprise."),
    ("That's right", "resolve", "Firm. Don't blink."),
    ("They would", "cunning", "Sip from your cup."),
    ("And would you tell me", "longing", "Almost begging. Hands open on the table."),
    ("Then would you tell me", "longing", "Almost begging. Hands open on the table."),
    ("Perhaps", "cunning", "Hold out your hand, palm up. Wait for the dagger."),
    ("If you give me your dagger", "cunning", "Hold out your hand, palm up. Wait for the dagger."),
    ("You want me to remarry", "rage", "Stunned. Then furious. Stand up straight."),
    ("If you remarry", "resolve", "Calm and rehearsed. You practiced this speech."),
    ("I'm almost of age", "resolve", "Square your shoulders. Prove you're a man."),
    ("I'll tell the elders", "resolve", "Lower your voice: this is the dangerous part."),
    ("Menelaus will back me", "resolve", "Confident. You think you've won."),
    ("So you deny your father", "rage", "Lean right into his face."),
    ("Would you have a better one", "resolve", "Shrug. Challenge her."),
    ("Lock the door", "rage", "Deadly calm. Then spit the last words."),
    ("Do you think if I remarry", "sorrow", "Softer now. Make him see it."),
    ("That world is gone", "rage", "Grip the table. Every word is a blade."),
    ("If he returned", "rage", "Point at him: this is his fate too."),
    ("If I kill them", "fear", "Pacing. You've thought about this every night."),
    ("and without me", "fear", "Quieter. The fear underneath."),
    ("'Cause only a man", "rage", "Bitter laugh. Cut him off."),
    ("Empty throne", "rage", "Repeat it like an insult."),
    ("I've been sitting on that", "rage", "Hand on your chest. Twenty years of anger."),
    ("My knowledge", "sorrow", "Cruel and heartbroken at once."),
]


def act(text):
    for k, e, d in ACT:
        if text.lower().startswith(k.lower()):
            return e, d
    return "resolve", "Say it like you mean it."


def build_lines(utts, spk, a, b, merge_gap):
    ls = []
    for u in utts:
        if u["end"] <= a or u["start"] >= b or u["spk"] not in spk:
            continue
        c, t = spk[u["spk"]], u["text"].strip()
        if (ls and ls[-1]["character"] == c and u["start"] - ls[-1]["_end"] < merge_gap
                and (ls[-1]["_end"] - ls[-1]["_start"]) + (u["end"] - u["start"]) < 6.5):
            ls[-1]["text"] += (" " if ls[-1]["text"][-1] in ".?!" else "… ") + t
            ls[-1]["_end"] = u["end"]
        else:
            ls.append({"character": c, "text": t, "_start": u["start"], "_end": u["end"]})
    out = []
    for ln in ls:
        e, d = act(ln["text"])
        out.append({"character": ln["character"], "text": ln["text"], "emotion": e, "direction": d,
                    "start": round(ln["_start"] - a, 2), "end": round(ln["_end"] - a, 2)})
    return out


CH = {
    "circe": {"id": "circe", "name": "Circe", "description": "The sorceress of Aiaia. Sharp-eyed, amused, dangerous."},
    "odysseus": {"id": "odysseus", "name": "Odysseus", "description": "Starving, armed, and lying about who he is."},
    "penelope": {"id": "penelope", "name": "Penelope", "description": "Twenty years holding the throne alone. Furious."},
    "telemachus": {"id": "telemachus", "name": "Telemachus", "description": "Her son, back from Sparta with a desperate plan."},
}
SCENES = [
    ("circe-warriors-armor", "A Great Warrior's Armor", "Book X · From the film",
     "Circe strips the stranger's story bare, lie by lie, and he can only admire her.", "Medium", "A", 91.30, 111.80, 2),
    ("circe-sharpened-by-the-gods", "Sharpened by the Gods", "Book X · From the film",
     "A duel of half-answers across Circe's table. The price of the truth: his dagger.", "Medium", "A", 111.80, 134.80, 3),
    ("circe-where-are-your-shipmates", "Where Are Your Shipmates?", "Book X · From the film",
     "No one reaches Circe's island alone. She wants to know where his crew went.", "Easy", "A", 69.93, 91.35, 1),
    ("circe-full-interrogation", "The Full Interrogation", "Book X · From the film",
     "All three rounds with the sorceress, back to back. A minute of cat and mouse.", "Hard", "A", 69.93, 134.80, 20),
    ("penelope-remarry", "You Want Me to Remarry?", "Book I · From the film",
     "Telemachus unveils his plan to save the throne. His mother does not take it well.", "Medium", "B", 104.40, 125.70, 4),
    ("penelope-burn-the-bastards", "Burn the Bastards", "Book I · From the film",
     "Penelope has a better plan for the suitors, and it involves fire.", "Easy", "B", 127.90, 147.80, 5),
    ("penelope-empty-throne", "The Empty Throne", "Book I · From the film",
     "Twenty years on an empty throne, and her son thinks only a man can sit on it.", "Medium", "B", 147.95, 171.67, 6),
    ("penelope-full-argument", "The Full Argument", "Book I · From the film",
     "The whole mother-son showdown in one take. Over a minute of fury.", "Hard", "B", 104.40, 171.67, 21),
]

plan = []
for sid, title, book, blurb, diff, rec, a, b, order in SCENES:
    if rec == "A":
        lines, shots_abs, chars = build_lines(uA, spkA, a, b, 2.2), SHOTS_A, ["circe", "odysseus"]
    else:
        lines, shots_abs, chars = build_lines(uB, spkB, a, b, 1.2), SHOTS_B, ["penelope", "telemachus"]
    shots = [{"start": round(max(s, a) - a, 2), "end": round(min(e, b) - a, 2), "character": c}
             for s, e, c in shots_abs if e > a + 0.05 and s < b - 0.05]
    (ROOT / "preprocess/shots" / f"{sid}.json").write_text(json.dumps(shots, indent=1))
    scene = {"id": sid, "order": order, "title": title, "book": book, "blurb": blurb, "difficulty": diff,
             "video": None, "duration": round(b - a, 1), "characters": [CH[c] for c in chars], "lines": lines,
             "source": "The Odyssey (2026 film); OBS screen recording, transcribed with ElevenLabs Scribe v2 (diarized)",
             "reference": None}
    (ROOT / "scenes" / f"{sid}.json").write_text(json.dumps(scene, indent=1, ensure_ascii=False), encoding="utf-8")
    plan.append({"id": sid, "rec": rec, "start": a, "end": b})
    print(f"== {sid}: {len(lines)} lines, {len(shots)} shots")
    for ln in lines:
        print(f"   {ln['start']:5.1f}-{ln['end']:5.1f} {ln['character']:>10} [{ln['emotion']}] {ln['text']}")
(SC / "obs_plan.json").write_text(json.dumps(plan))
