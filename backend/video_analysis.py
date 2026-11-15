"""Server-side MediaPipe analysis of the recorded take video.

During the take the browser only runs a light live tracker (name tags + favor meter) and records
the raw webcam. After "Cut!" the video is uploaded and analysed here with the FULL pose model and
the face landmarker on every sampled frame, so scoring never suffers from frames a busy laptop
dropped.

Output is byte-for-byte the format the browser used to send (see features.py):
    {"fps": 10, "players": [{"pose": [21 floats | None] * L, "face": [21 floats | None] * L}]}
with L = ceil(duration * 10), index k = take time k/10 s, and pose x in DISPLAYED coordinates
(the webcam is shown mirrored, so raw camera x becomes 1 - x).

Identity (mirrors frontend/src/stage/tracker.js): duplicate detections are suppressed, tracks are
kept by optimal assignment on predicted shoulder centre + shoulder width with a gate, a lost
player is held for 0.4 s, faces go to the player whose pose nose is nearest. Player numbers are
fixed ONCE, from left-to-right order in the first ~1 s where everyone is visible, so people who
cross mid-take keep their identity.
"""
from __future__ import annotations

import logging
import math
import os
import re
import subprocess
import tempfile
import threading
import time
from itertools import permutations
from pathlib import Path

import numpy as np

from features import BLENDSHAPES, FEATURE_FPS, POSE_INDICES, ffmpeg_exe

log = logging.getLogger("video_analysis")

ROOT = Path(__file__).resolve().parent.parent
MODELS = ROOT / "frontend" / "public" / "mediapipe" / "models"
FULL_URL = ("https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/"
            "float16/latest/pose_landmarker_full.task")

ANALYSIS_WIDTH = int(os.getenv("VIDEO_ANALYSIS_WIDTH", "480"))
WORKERS = int(os.getenv("VIDEO_ANALYSIS_WORKERS", str(max(1, min(4, (os.cpu_count() or 4) // 3)))))
# Full pose model costs ~55 ms/frame on a laptop CPU; at 5 Hz (interpolated to 10 Hz) the whole
# take fits the latency budget. Gestures are slow enough, and scoring already matches within 0.6 s.
POSE_EVERY = max(1, int(os.getenv("VIDEO_POSE_EVERY", "2")))
HOLD_S = 0.4  # keep an undetected player this long
FACE_HOLD_S = 0.3
LOST_S = 1.2  # after this a slot can re-acquire anyone
GATE = 2.2  # max track->detection cost (shoulder widths)
NMS_FRAC = 0.4  # same body if shoulder centres closer than this x shoulder width
FACE_GATE = 0.9  # face nose -> pose nose, in shoulder widths
MIN_BODY = 0.05  # min body scale, in frame heights
ORDER_WINDOW = 10  # samples (1 s) where everyone is visible -> decides Player 1..n

_IDX = POSE_INDICES  # [nose, Lsh, Rsh, Lel, Rel, Lwr, Rwr]


# ------------------------------------------------------------------------------------ models

def pose_model_path() -> tuple[Path, str]:
    """Full model if available (downloading it once if needed), else lite."""
    want = os.getenv("VIDEO_POSE_MODEL", "full")
    full = MODELS / "pose_landmarker_full.task"
    lite = MODELS / "pose_landmarker_lite.task"
    if want == "full" and not full.exists():
        try:
            import httpx

            MODELS.mkdir(parents=True, exist_ok=True)
            r = httpx.get(FULL_URL, timeout=60, follow_redirects=True)
            r.raise_for_status()
            full.write_bytes(r.content)
        except Exception as e:  # noqa: BLE001
            log.warning("Could not fetch pose_landmarker_full, using lite: %s", e)
    if want == "full" and full.exists():
        return full, "pose_landmarker_full"
    return lite, "pose_landmarker_lite"


def _make_landmarkers(n_people: int):
    from mediapipe.tasks.python import BaseOptions, vision

    path, name = pose_model_path()
    pose = vision.PoseLandmarker.create_from_options(vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(path)),
        running_mode=vision.RunningMode.VIDEO, num_poses=n_people,
        min_pose_detection_confidence=0.4, min_pose_presence_confidence=0.4, min_tracking_confidence=0.5))
    face = vision.FaceLandmarker.create_from_options(vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")),
        running_mode=vision.RunningMode.VIDEO, num_faces=n_people, output_face_blendshapes=True,
        min_face_detection_confidence=0.4, min_face_presence_confidence=0.4, min_tracking_confidence=0.5))
    return pose, face, name


def warm_up() -> None:
    """Load the models once at startup (first load also JIT-initialises XNNPACK)."""
    try:
        import mediapipe as mp

        pose, face, _ = _make_landmarkers(2)
        img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.zeros((360, 640, 3), np.uint8))
        pose.detect_for_video(img, 0)
        face.detect_for_video(img, 0)
        pose.close()
        face.close()
    except Exception as e:  # noqa: BLE001
        log.warning("Video analysis warm-up failed: %s", e)


# ------------------------------------------------------------------------------------ decoding

def _probe_size(path: str) -> tuple[int, int]:
    err = subprocess.run([ffmpeg_exe(), "-hide_banner", "-i", path], capture_output=True, text=True,
                         errors="replace").stderr
    m = re.search(r"Video:.*?(\d{2,5})x(\d{2,5})", err)
    if not m:
        raise ValueError("no video stream found")
    return int(m.group(1)), int(m.group(2))


def _frames(path: str, width: int):
    """Yield (k, rgb ndarray) at FEATURE_FPS via an ffmpeg raw pipe (robust for browser webm)."""
    w0, h0 = _probe_size(path)
    w = min(width, w0)
    w -= w % 2
    h = int(round(h0 * w / w0 / 2)) * 2
    cmd = [ffmpeg_exe(), "-v", "error", "-i", path, "-an",
           "-vf", f"fps={FEATURE_FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    size = w * h * 3
    k = 0
    try:
        while True:
            buf = proc.stdout.read(size)
            if len(buf) < size:
                break
            yield k, np.frombuffer(buf, np.uint8).reshape(h, w, 3)
            k += 1
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()


# ------------------------------------------------------------------------------------ detection

def _chunk_job(frames: list, start_k: int, n_people: int, pose_every: int) -> tuple:
    """Worker job: own pose + face landmarkers (VIDEO mode) over a contiguous run of 10 Hz frames.

    Pose runs on every `pose_every`-th frame (others -> None = "not analysed"); face on every frame.
    Top-level so a ProcessPoolExecutor can pickle it.
    """
    import mediapipe as mp

    pose_lm, face_lm, model = _make_landmarkers(n_people)
    poses, faces = [], []
    pms = fms = 0.0
    try:
        for i, rgb in enumerate(frames):
            k = start_k + i
            img = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            if k % pose_every == 0:
                t0 = time.perf_counter()
                r = pose_lm.detect_for_video(img, k * 100)
                pms += time.perf_counter() - t0
                poses.append([np.array([[p[j].x, p[j].y, p[j].visibility or 0.0] for j in _IDX])
                              for p in (r.pose_landmarks or [])])
            else:
                poses.append(None)
            t0 = time.perf_counter()
            fr = face_lm.detect_for_video(img, k * 100)
            fms += time.perf_counter() - t0
            fo = []
            for fl, bs in zip(fr.face_landmarks or [], fr.face_blendshapes or []):
                by = {c.category_name: c.score for c in bs}
                fo.append((np.array([fl[1].x, fl[1].y]), [round(by.get(n, 0.0), 3) for n in BLENDSHAPES]))
            faces.append(fo)
    finally:
        pose_lm.close()
        face_lm.close()
    return poses, faces, pms, fms, model


def _worker_init() -> None:
    os.environ.setdefault("GLOG_minloglevel", "2")
    import mediapipe  # noqa: F401  (pay the ~2 s import once per worker, at startup)


_pool = None
_pool_lock = threading.Lock()


def _get_pool():
    """Persistent process pool (threads don't scale: inference holds the GIL). None if unavailable."""
    global _pool
    if WORKERS <= 1:
        return None
    with _pool_lock:
        if _pool is None:
            try:
                from concurrent.futures import ProcessPoolExecutor

                _pool = ProcessPoolExecutor(WORKERS, initializer=_worker_init)
                import atexit

                atexit.register(_shutdown_pool)
            except Exception as e:  # noqa: BLE001
                log.warning("No process pool for video analysis (%s); running in-process", e)
                _pool = False
        return _pool or None


def _reset_pool() -> None:
    global _pool
    with _pool_lock:
        if _pool:
            try:
                _pool.shutdown(wait=False, cancel_futures=True)
            except Exception:  # noqa: BLE001
                pass
        _pool = None


def _shutdown_pool() -> None:
    """Clean exit (avoids ProcessPoolExecutor's noisy weakref traceback at interpreter shutdown)."""
    global _pool
    if _pool:
        try:
            _pool.shutdown(wait=True, cancel_futures=True)
        except Exception:  # noqa: BLE001
            pass
    _pool = None


def warm_pool() -> None:
    """Spin up the workers and import MediaPipe in each (call at app startup, in a thread)."""
    pool = _get_pool()
    if pool:
        try:
            list(pool.map(_noop, range(WORKERS)))
        except Exception as e:  # noqa: BLE001
            log.warning("Video analysis pool warm-up failed: %s", e)


def _noop(_):
    import mediapipe  # noqa: F401
    return os.getpid()


def _detect(path: str, n_people: int) -> tuple[list, list, dict]:
    """Decode once at 10 fps, then pose (every POSE_EVERY-th frame) + face (every frame) over
    contiguous chunks on the process pool. Each chunk restarts VIDEO-mode tracking (one extra
    detector pass); identities are resolved afterwards by our own tracker over the whole take."""
    # multi-player takes: keep people big enough for the person detector (3 across a 480px frame
    # leaves each ~110px wide); single player: 480 is plenty
    width = ANALYSIS_WIDTH if n_people <= 2 else max(ANALYSIS_WIDTH, 640)
    frames = [f for _, f in _frames(path, width)]
    n = len(frames)
    aspect = frames[0].shape[1] / frames[0].shape[0] if frames else 16 / 9
    pool = _get_pool()
    workers = max(1, min(WORKERS, n // 20 or 1)) if pool else 1
    # chunk boundaries on pose frames so every chunk starts with a pose pass
    bounds = [(n * i // workers) // POSE_EVERY * POSE_EVERY for i in range(workers)] + [n]
    jobs = [(frames[bounds[i]:bounds[i + 1]], bounds[i], n_people, POSE_EVERY) for i in range(workers)]
    if pool and workers > 1:
        try:
            futs = [pool.submit(_chunk_job, *j) for j in jobs]
            # never let a stuck/broken pool stall a round: generous timeout, then in-process
            timeout = 15 + 0.25 * n
            results = [f.result(timeout=timeout) for f in futs]
        except Exception as e:  # noqa: BLE001
            log.warning("Process pool failed (%r); analysing in-process", e)
            _reset_pool()
            results = [_chunk_job(frames, 0, n_people, POSE_EVERY)]
    else:
        results = [_chunk_job(*j) for j in jobs]
    poses, faces = [], []
    pms = fms = 0.0
    model = None
    for r in results:
        poses += r[0]
        faces += r[1]
        pms += r[2]
        fms += r[3]
        model = r[4]
    pose_frames = sum(p is not None for p in poses)
    return poses, faces, {"frames": n, "model": model, "aspect": aspect, "workers": workers,
                          "pose_fps": FEATURE_FPS / POSE_EVERY,
                          "pose_ms_avg": round(pms * 1000 / max(1, pose_frames), 1),
                          "face_ms_avg": round(fms * 1000 / max(1, n), 1)}


# ------------------------------------------------------------------------------------ tracking

def _body(lm: np.ndarray, aspect: float, mirrored: bool) -> tuple[float, float, float]:
    """Shoulder centre (displayed coords, x scaled by aspect) and shoulder width."""
    ls, rs = lm[1], lm[2]
    mx = (ls[0] + rs[0]) / 2
    cx = (mx if mirrored else 1 - mx) * aspect
    cy = (ls[1] + rs[1]) / 2
    w = math.hypot((ls[0] - rs[0]) * aspect, ls[1] - rs[1])
    return cx, cy, max(w, 0.02)


def _scale(lm: np.ndarray, aspect: float) -> float:
    """Body size that survives a sideways turn: max(shoulder width, nose-to-shoulder-centre)."""
    ls, rs, nose = lm[1], lm[2], lm[0]
    w = math.hypot((ls[0] - rs[0]) * aspect, ls[1] - rs[1])
    neck = math.hypot((nose[0] - (ls[0] + rs[0]) / 2) * aspect, nose[1] - (ls[1] + rs[1]) / 2)
    return max(w, neck)


def _assign(cost: list[list[float]], gate: float) -> list[int]:
    """Optimal row->column assignment (brute force, n<=5); unmatched rows cost `gate`."""
    n = len(cost)
    m = len(cost[0]) if n else 0
    best, best_pick = math.inf, [-1] * n
    cols = list(range(m)) + [-1] * n
    for perm in set(permutations(cols, n)):
        c = 0.0
        ok = True
        for i, j in enumerate(perm):
            if j < 0:
                c += gate
            elif cost[i][j] >= gate:
                ok = False
                break
            else:
                c += cost[i][j]
            if c >= best:
                ok = False
                break
        if ok and c < best:
            best, best_pick = c, list(perm)
    return best_pick


def _track(poses: list, faces: list, n: int, aspect: float, mirrored: bool) -> tuple[list, list, list]:
    """Per sampled frame -> per slot: (pose 7x3 | None, face bs | None, observed bool)."""
    tracks = [{"home": (i + 0.5) / n * aspect, "body": None, "vel": (0.0, 0.0), "seen": -1e9,
               "lm": None, "face": None, "face_seen": -1e9} for i in range(n)]
    out_pose, out_face, observed = [], [], []
    dt_s = 1 / FEATURE_FPS
    analysed = [d is not None for d in poses]
    for k, dets_raw in enumerate(poses):
        now = k * dt_s
        if dets_raw is None:  # pose not run on this frame (5 Hz): no evidence either way
            dets_raw = []
        # duplicate suppression (biggest bodies first)
        # drop degenerate detections (whole "body" a few pixels across) - real players never are
        items = sorted(((lm, _body(lm, aspect, mirrored)) for lm in dets_raw
                        if lm[1][2] > 0.4 and lm[2][2] > 0.4 and _scale(lm, aspect) >= MIN_BODY),
                       key=lambda d: -d[1][2])
        dets = []
        for lm, b in items:
            if not any(math.hypot(b[0] - o[0], b[1] - o[1]) < NMS_FRAC * max(b[2], o[2]) for _, o in dets):
                dets.append((lm, b))
        # Players are the people closest to the laptop: bystanders walking behind them (or extras in
        # the background of a shot) are smaller, so only the n biggest bodies can be players.
        dets = dets[:n]
        active = [i for i, t in enumerate(tracks) if t["body"] and now - t["seen"] <= LOST_S]
        free = [i for i in range(n) if i not in active]
        taken: set[int] = set()
        seen_now = [False] * n

        def observe(ti, det):
            t = tracks[ti]
            b = det[1]
            if t["body"] and now - t["seen"] < 0.35:
                gap = max(1e-3, now - t["seen"])
                a = 0.4
                t["vel"] = ((1 - a) * t["vel"][0] + a * (b[0] - t["body"][0]) / gap,
                            (1 - a) * t["vel"][1] + a * (b[1] - t["body"][1]) / gap)
            else:
                t["vel"] = (0.0, 0.0)
            t["body"], t["seen"], t["lm"] = b, now, det[0]
            seen_now[ti] = True

        if analysed[k] and active and dets:
            cost = []
            for ti in active:
                t = tracks[ti]
                g = min(now - t["seen"], 0.3)
                px, py = t["body"][0] + t["vel"][0] * g, t["body"][1] + t["vel"][1] * g
                cost.append([math.hypot(b[0] - px, b[1] - py) / t["body"][2] + 0.5 * abs(b[2] - t["body"][2]) / t["body"][2]
                             for _, b in dets])
            for row, j in enumerate(_assign(cost, GATE)):
                if j >= 0:
                    taken.add(j)
                    observe(active[row], dets[j])
        rest = [j for j in range(len(dets)) if j not in taken]
        if analysed[k] and rest and free:
            cost = [[abs(dets[j][1][0] - tracks[ti]["home"]) / aspect for j in rest] for ti in free]
            for row, j in enumerate(_assign(cost, 10.0)):
                if j >= 0:
                    observe(free[row], dets[rest[j]])

        # faces -> nearest pose nose (current or held tracks)
        live = [i for i, t in enumerate(tracks) if t["lm"] is not None and now - t["seen"] <= HOLD_S]
        fr = faces[k] if k < len(faces) else []
        if live and fr:
            cost = []
            for i in live:
                nose = tracks[i]["lm"][0]
                cost.append([math.hypot((f[0][0] - nose[0]) * aspect, f[0][1] - nose[1]) / tracks[i]["body"][2]
                             for f in fr])
            for row, j in enumerate(_assign(cost, FACE_GATE)):
                if j >= 0:
                    tracks[live[row]]["face"] = fr[j][1]
                    tracks[live[row]]["face_seen"] = now

        out_pose.append([t["lm"] if t["lm"] is not None and now - t["seen"] <= HOLD_S + 1e-6 else None for t in tracks])
        out_face.append([t["face"] if t["face"] is not None and now - t["face_seen"] <= FACE_HOLD_S + 1e-6 else None
                         for t in tracks])
        observed.append(seen_now if analysed[k] else (observed[-1] if observed else seen_now))

    # Fill non-analysed frames by interpolating the two neighbouring real detections of that player.
    for k in range(1, len(poses) - 1):
        if analysed[k] or not (analysed[k - 1] and analysed[k + 1]):
            continue
        for s in range(n):
            a, b = out_pose[k - 1][s], out_pose[k + 1][s]
            if a is not None and b is not None and observed[k - 1][s] and observed[k + 1][s]:
                out_pose[k][s] = (a + b) / 2
    return out_pose, out_face, observed


def _player_order(out_pose: list, observed: list, n: int, aspect: float, mirrored: bool) -> list[int]:
    """Slot indices sorted screen-left -> right, from the first 1 s where everyone is detected."""
    run = 0
    for k, obs in enumerate(observed):
        run = run + 1 if all(obs) else 0
        if run >= ORDER_WINDOW:
            ks = range(k - ORDER_WINDOW + 1, k + 1)
            xs = [np.mean([_body(out_pose[j][s], aspect, mirrored)[0] for j in ks]) for s in range(n)]
            return sorted(range(n), key=lambda s: xs[s])
    # nobody stood together for a full second: use each slot's mean position over the take
    xs = []
    for s in range(n):
        vals = [_body(f[s], aspect, mirrored)[0] for f in out_pose if f[s] is not None]
        xs.append(np.mean(vals) if vals else (s + 0.5) / n * aspect)
    return sorted(range(n), key=lambda s: xs[s])


def _pose_feature(lm: np.ndarray, mirrored: bool) -> list[float] | None:
    if lm[1][2] <= 0.4 or lm[2][2] <= 0.4:
        return None
    out = []
    for x, y, v in lm:
        out += [round(float(x if mirrored else 1 - x), 3), round(float(y), 3), round(float(v), 2)]
    return out


# ------------------------------------------------------------------------------------ public API

def analyze_take_video(video: bytes | str | Path, n_players: int, duration: float, offset_s: float = 0.0,
                       mirrored: bool = False) -> dict:
    """Analyse a recorded take. Returns {"features": {...}, "stats": {...}}. Raises on unusable video."""
    t0 = time.perf_counter()
    tmp = None
    if isinstance(video, (bytes, bytearray)):
        if not video:
            raise ValueError("empty video")
        tmp = tempfile.NamedTemporaryFile(suffix=".webm", delete=False)
        tmp.write(video)
        tmp.close()
        path = tmp.name
    else:
        path = str(video)
    try:
        poses, faces, st = _detect(path, n_players + 1)
    finally:
        if tmp:
            os.unlink(tmp.name)
    aspect = st["aspect"]
    out_pose, out_face, observed = _track(poses, faces, n_players, aspect, mirrored)
    order = _player_order(out_pose, observed, n_players, aspect, mirrored) if out_pose else list(range(n_players))

    length = max(1, math.ceil(duration * FEATURE_FPS - 1e-9))
    shift = int(round(offset_s * FEATURE_FPS))  # video frame k is take sample k + shift
    players = [{"pose": [None] * length, "face": [None] * length} for _ in range(n_players)]
    for k in range(len(out_pose)):
        idx = k + shift
        if not 0 <= idx < length:
            continue
        for p, slot in enumerate(order):
            lm = out_pose[k][slot]
            players[p]["pose"][idx] = _pose_feature(lm, mirrored) if lm is not None else None
            players[p]["face"][idx] = out_face[k][slot]

    cov = [round(sum(f is not None for f in pl["pose"]) / length, 3) for pl in players]
    fcov = [round(sum(f is not None for f in pl["face"]) / length, 3) for pl in players]
    stats = {**{k: v for k, v in st.items() if k != "aspect"}, "players": n_players,
             "coverage": cov, "face_coverage": fcov, "seconds": round(time.perf_counter() - t0, 2)}
    return {"features": {"fps": FEATURE_FPS, "players": players}, "stats": stats}


def usable(stats: dict) -> tuple[bool, str]:
    """Is the server analysis good enough to replace the browser's live samples?"""
    cov = stats.get("coverage") or []
    if not cov:
        return False, "no players"
    if stats.get("frames", 0) < 5:
        return False, f"only {stats.get('frames', 0)} frames decoded"
    mean = sum(cov) / len(cov)
    if mean < 0.25:
        return False, f"low body coverage {mean:.0%}"
    return True, "ok"
