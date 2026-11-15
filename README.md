# Trials of Odysseus

A party acting game for HackUTA '26. Pick a scene from the *Odyssey*, choose your crew size, and
perform it on camera. A panel of Olympian gods scores your **words, voice, movement and facial emotion**,
and your crew earns *kleos* (glory) in the Hall of Heroes.

## How it works

```
 Browser (React + MediaPipe Tasks JS)               Backend (FastAPI)
 ─────────────────────────────────────              ──────────────────────────────────────────
 webcam ─► Pose Landmarker (multi-person) ┐         ElevenLabs Scribe ─► Athena  (line accuracy)
        └► Face Landmarker (blendshapes)  ├─ 10Hz ─► librosa pitch/energy ─► Apollo (voice + timing)
 tracker: players sorted left→right       │ features DTW vs reference pose ─► Ares  (movement)
 mic ─► MediaRecorder (webm/opus) ────────┘         blendshapes vs emotion ─► Aphrodite (face)
 4 snapshots ──────────────────────────────────────► Gemini ─► in-character commentary
                                                    MongoDB Atlas ─► Hall of Heroes
```

**Scoring** (`backend/scoring.py`), weighted into a 0–1000 kleos score:

| God | Judges | How |
|---|---|---|
| Athena 🦉 (35%) | Words | Speech-to-text transcript aligned to the script word by word |
| Apollo 🎵 (25%) | Voice | Voice presence, pitch range and dynamics (or DTW against the film actor's pitch contour), and whether each line starts on cue |
| Ares ⚔️ (20%) | Movement | Shoulder-normalized upper-body pose. Each on-screen frame of the film actor is matched to the player's best frame within ±0.6 s, using only landmarks visible in both. Without a reference, gesture boldness |
| Aphrodite 🌹 (20%) | Emotion | Face blendshapes matched the same ±0.6 s way against the actor, blended with the emotion each line calls for (rage, fear, joy, cunning…) |

**The verdict** (`backend/reel.py`, `frontend/src/verdict/`) shows those measurements instead of describing them:

- **Voyage**: your ship sails the road of ranks to your kleos, and a chip says how many kleos the next rank costs,
  how you did against your last attempt, and which crew sits just ahead of you in the Hall.
- **Reel**: one tile per line with 0-3 laurels. Pick a line to see the script with every word marked hit, near
  or missed, how far off cue it landed, its four scores, and your snapshot beside the film still.
- **Council**: one dial and one short zinger per god. The raw notes are folded under "How the gods measured".
- **Laurels**: awards that are only true of this take (line of the night, streaks, timing) and an epithet per player.

The reel only reshapes what the judges measured; it never adds points. `/?preview=verdict` on the dev server opens
this screen on a canned take.

Each integration falls back if it's missing: no ElevenLabs key means local **Whisper** (faster-whisper,
`WHISPER_MODEL`, default `base.en`) for speech-to-text, then browser speech recognition; no Gemini key means canned quips; no Mongo URI means a local JSON leaderboard.

## Run it

```powershell
# one-time setup
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt
cd frontend; npm install; cd ..
copy .env.example .env   # add your keys

# every time
.\start.ps1               # backend :8000 + frontend :5173
```

Open http://localhost:5173 in **Chrome**. It needs camera and mic access, and Chrome supplies the
speech-recognition fallback.

For the demo you can serve everything from one port: `cd frontend; npm run build`, then
run only the backend and open http://localhost:8000.

## Scenes

`scenes/*.json` holds four built-in scenes adapted from Samuel Butler's public-domain translation:
a solo scene, two 2-person scenes and one 3-person scene. Each line has a character, text, timing,
target emotion and stage direction.

### Adding a film clip as the reference

Film clips are copyrighted, so they stay out of git (`scenes/media/` and `preprocess/out/` are ignored).
Film scenes cut between close-ups, so the preprocessor decides who is on screen **per shot**:

```powershell
# Pass 1: detect shot cuts and write a template plus one thumbnail per shot
.venv\Scripts\python preprocess\preprocess_scene.py --scene sceneseggars.json --video clip.mp4 `
    --title "Get These Beggars Out" --characters penelope:Penelope antinous:Antinous odysseus:Odysseus
#   -> preprocess\outeggars.shots.json + preprocess\out\shots_beggars\*.jpg
#   Open the thumbnails and set each shot's "character" (or null for crowd/wide shots).

# Pass 2: track the on-screen actor in every shot, transcribe the dialogue, write the reference
.venv\Scripts\python preprocess\preprocess_scene.py --scene sceneseggars.json --video clip.mp4 `
    --shots-file preprocess\outeggars.shots.json --lines-from-transcript
```

- `--shots "0-4.2:penelope,4.2-14.2:antinous,..."`: give the shot map inline instead of a file
- `--lines-from-transcript`: builds the script from the dialogue (ElevenLabs if keyed, otherwise Whisper
  `small.en`). The speaker is guessed from whoever is on screen, so fix reaction shots by hand.
- `--retime`: keeps hand-written lines and snaps their timing to the dialogue
- `--start/--end`: cut a window out of a longer source first

The output goes into the scene JSON as `reference = {fps, shots, pose, face, audio}`. Each character's
frames are null whenever someone else is on screen. In the game, the clip plays during rehearsal, the
actor's skeleton appears as the ghost on stage, and the gods score you against the actor's frames.

## How we used ElevenLabs

- **Speech to Text (Scribe)**: transcribes each performance with word-level timestamps. Athena scores line
  accuracy from it, and Apollo scores whether each line lands on cue. During preprocessing it also
  aligns script lines to the film's dialogue.

## Project layout

```
backend/     app.py (API), scoring.py (the gods), features.py (shared feature math),
             oracle.py (ElevenLabs + Gemini), local_stt.py (Whisper), store.py (MongoDB / local leaderboard)
frontend/    React app; src/vision.js wraps MediaPipe, src/screens/Stage.jsx is the live stage
preprocess/  preprocess_scene.py: turns a film clip into reference data
scenes/      scene scripts (+ gitignored media/)
```

## Calibrating with real takes

Every round is saved to `backend/data/takes/<time>_<scene>_<crew>/`, which is gitignored. Each folder holds the
features, the mic audio, the snapshots, and the score the game showed. Set `SAVE_TAKES=0` to turn this off.
After a test round, label what the score *should* have been, change the scoring, and replay:

```powershell
.venv\Scripts\python tools\replay_takes.py --list
.venv\Scripts\python tools\replay_takes.py --label <part-of-take-name> "missed everything, should be low"
.venv\Scripts\python tools\replay_takes.py --last 5          # or --scene <id>, or take folders
.venv\Scripts\python tools\replay_takes.py --json out.json   # full old/new results
```

The replay runs each take through the real `/api/perform` pipeline (speech-to-text, judges, totals) with the current code.
It prints the old and new kleos and each judge's old and new score side by side. Replays are not saved as new takes.
