# Trials of Odysseus

A party acting game for HackUTA '26. Pick a scene from the *Odyssey*, choose your crew size, and
perform it on camera. A panel of Olympian gods scores your **words, voice, movement and facial emotion**,
Zeus delivers a spoken verdict, and your crew earns *kleos* (glory) in the Hall of Heroes.

## How it works

```
 Browser (React + MediaPipe Tasks JS)               Backend (FastAPI)
 ─────────────────────────────────────              ──────────────────────────────────────────
 webcam ─► Pose Landmarker (multi-person) ┐         ElevenLabs Scribe ─► Athena  (line accuracy)
        └► Face Landmarker (blendshapes)  ├─ 10Hz ─► librosa pitch/energy ─► Apollo (voice + timing)
 tracker: players sorted left→right       │ features DTW vs reference pose ─► Ares  (movement)
 mic ─► MediaRecorder (webm/opus) ────────┘         blendshapes vs emotion ─► Aphrodite (face)
 4 snapshots ──────────────────────────────────────► Gemini ─► in-character commentary
                                                    ElevenLabs TTS ─► Zeus's spoken verdict
                                                    MongoDB Atlas ─► Hall of Heroes
```

**Scoring** (`backend/scoring.py`), weighted into a 0–1000 kleos score:

| God | Judges | How |
|---|---|---|
| Athena 🦉 (35%) | Words | Speech-to-text transcript aligned to the script word by word |
| Apollo 🎵 (25%) | Voice | Voice presence, pitch range and dynamics (or DTW against the film actor's pitch contour), and whether each line starts on cue |
| Ares ⚔️ (20%) | Movement | Shoulder-normalized upper-body pose, DTW against the film actor's pose, or gesture boldness when there's no reference |
| Aphrodite 🌹 (20%) | Emotion | Face blendshapes projected onto the emotion each line calls for (rage, fear, joy, cunning…), plus DTW against the actor's face |

Each integration falls back if it's missing: no ElevenLabs key means browser speech recognition and
browser TTS; no Gemini key means canned quips; no Mongo URI means a local JSON leaderboard.

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

Film clips are copyrighted, so they stay out of git (`scenes/media/` is ignored). To attach one:

```powershell
.venv\Scripts\python preprocess\preprocess_scene.py `
    --scene scenes\my-name-is-noman.json --video D:\clips\odyssey.mp4 `
    --start 3601.5 --end 3650 --order odysseus polyphemus --retime
```

- `--order`: character ids in left-to-right order as they appear on screen
- `--retime`: transcribes the clip with ElevenLabs and snaps each script line to when it's actually said.
  Edit the scene's `lines` to match the film's dialogue first.

The script cuts the clip, runs MediaPipe on it at 10 fps, extracts the audio contours, and writes it
all into the scene JSON. The game then plays the clip during rehearsal, draws the actor's pose as a
dashed "ghost" skeleton on stage, and scores against the actor instead of using the heuristics.

## How we used ElevenLabs

- **Speech to Text (Scribe)**: transcribes each performance with word-level timestamps. Athena scores line
  accuracy from it, and Apollo scores whether each line lands on cue. During preprocessing it also
  aligns script lines to the film's dialogue.
- **Text to Speech**: Zeus reads the final verdict aloud in an expressive voice.

## Project layout

```
backend/     app.py (API), scoring.py (the gods), features.py (shared feature math),
             oracle.py (ElevenLabs + Gemini), store.py (MongoDB / local leaderboard)
frontend/    React app; src/vision.js wraps MediaPipe, src/screens/Stage.jsx is the live stage
preprocess/  preprocess_scene.py: turns a film clip into reference data
scenes/      scene scripts (+ gitignored media/)
```
