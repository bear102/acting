// Live-stage performance benchmark.
//
// Drives the real built app in Chrome with a fake camera (a video file with people in it) and a
// fake microphone, walks Home -> scene -> crew -> rehearsal -> stage, presses "Action!", and
// measures the live take: main-thread frame rate, detector cost, React commits/s, long tasks,
// main-thread busy %, and film playback quality. No backend needed: /api/* and /media/* are mocked
// from scenes/.
//
// Run (from frontend/):
//   npm run build
//   node scripts/bench-stage.mjs --cam <people.mjpeg> [--mic <voice.wav>] [--scene beggar-in-the-hall]
//        [--seconds 10] [--headed] [--query "lite=1"] [--label before]
// Needs playwright-core (npm i -D playwright-core, or set PLAYWRIGHT_CORE=<path to its index.js>)
// and Google Chrome (or CHROME_PATH). Make a fake camera clip with ffmpeg, e.g. from any video:
//   ffmpeg -i people.mp4 -t 10 -vf "scale=1280:720,fps=30,format=yuvj420p" -c:v mjpeg -q:v 5 -f mjpeg people.mjpeg
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const frontend = path.resolve(here, '..')
const scenesDir = path.resolve(frontend, '..', 'scenes')

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1] && !all[i + 1].startsWith('--') ? all[i + 1] : true])
  return acc
}, []))
const SCENE = args.scene || 'beggar-in-the-hall'
const SECONDS = +(args.seconds || 10)
const PORT = +(args.port || 4391)
if (!args.cam) { console.error('--cam <file.mjpeg|file.y4m> is required'); process.exit(2) }

async function loadPlaywright() {
  try { return await import('playwright-core') } catch { /* fall through */ }
  if (process.env.PLAYWRIGHT_CORE) return import(pathToFileURL(process.env.PLAYWRIGHT_CORE).href)
  throw new Error('playwright-core not found: npm i -D playwright-core or set PLAYWRIGHT_CORE')
}

function readScenes() {
  return fs.readdirSync(scenesDir).filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(scenesDir, f), 'utf8')))
}

async function waitForServer(url, ms = 20000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    try { if ((await fetch(url)).ok) return } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 300))
  }
  throw new Error(`server did not start: ${url}`)
}

const server = spawn(process.execPath, [path.join(frontend, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview',
  '--port', String(PORT), '--strictPort'], { cwd: frontend, stdio: 'ignore' })
const cleanup = () => { try { server.kill() } catch { /* gone */ } }
process.on('exit', cleanup)

try {
  await waitForServer(`http://localhost:${PORT}/`)
  await new Promise((r) => setTimeout(r, 500))
  if (server.exitCode !== null) throw new Error(`vite preview exited (port ${PORT} busy?) - pass --port`)
  const { chromium } = await loadPlaywright()
  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: !args.headed,
    args: [
      '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
      `--use-file-for-fake-video-capture=${path.resolve(args.cam)}`,
      ...(args.mic ? [`--use-file-for-fake-audio-capture=${path.resolve(args.mic)}`] : []),
      '--autoplay-policy=no-user-gesture-required', '--enable-gpu', '--ignore-gpu-blocklist',
      '--use-angle=d3d11', '--window-size=1440,900',
    ],
  })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 820 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('[pageerror]', e.message))

  // ---- mocks
  const scenes = readScenes()
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, elevenlabs: false, gemini: false, whisper: true, leaderboard: 'local-file' } }))
  await page.route('**/api/scenes', (r) => r.fulfill({
    json: scenes.map((s) => ({ ...s, lines: s.lines.length, reference: undefined, has_reference: !!s.reference })),
  }))
  await page.route(/\/api\/scenes\/[^/]+$/, (r) => {
    const id = r.request().url().split('/').pop()
    const s = scenes.find((x) => x.id === id)
    const ref = s.reference
    r.fulfill({ json: { ...s, reference: ref ? { fps: ref.fps, shots: ref.shots, pose: ref.pose } : null, has_reference: !!ref } })
  })
  await page.route('**/api/leaderboard**', (r) => r.fulfill({ json: [] }))
  // --verify: capture the submitted take and check the payload the backend would score
  let submitted = null
  await page.route('**/api/perform', (r) => {
    const body = r.request().postDataBuffer()?.toString('latin1') || ''
    const m = body.match(/name="meta"\r\n\r\n([\s\S]*?)\r\n--/)
    submitted = { meta: m ? JSON.parse(m[1]) : null, frames: (body.match(/name="frames"/g) || []).length,
      audioBytes: (body.split('name="audio"')[1] || '').length }
    r.fulfill({ status: 500, body: 'bench' })
  })
  await page.route('**/media/**', (r) => {
    const f = path.join(scenesDir, 'media', decodeURIComponent(new URL(r.request().url()).pathname.split('/media/')[1]))
    return fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'video/mp4' }) : r.fulfill({ status: 404 })
  })

  // ---- in-page probes: rAF rate, long tasks, React commits
  await page.addInitScript(() => {
    const P = (window.__bench = { raf: 0, longCount: 0, longMs: 0, commits: 0 })
    const tick = () => { P.raf++; requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) { P.longCount++; P.longMs += e.duration } })
        .observe({ type: 'longtask', buffered: false })
    } catch { /* unsupported */ }
    // React calls this hook on every commit when present (works in production builds)
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
      supportsFiber: true, renderers: new Map(), inject() { return 1 },
      onCommitFiberRoot() { P.commits++ }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {},
      checkDCE() {},
    }
  })

  const q = args.query ? `?${args.query}` : ''
  await page.goto(`http://localhost:${PORT}/${q}`)
  await page.getByText('Begin your trial').click()
  const sceneMeta = scenes.find((s) => s.id === SCENE)
  await page.getByRole('button', { name: new RegExp(sceneMeta.title, 'i') }).first().click()
  await page.getByText(/Set sail for rehearsal/).click()
  await page.getByText(/Take the stage/).click()
  await page.getByRole('button', { name: 'Action!' }).waitFor({ timeout: 60000 })
  const gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info')
    return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'no webgl2'
  })
  await page.getByRole('button', { name: 'Action!' }).click()
  await page.waitForTimeout(2700 + 2000) // countdown + warm-up

  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Performance.enable')
  const metric = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]))
  const snap = () => page.evaluate(() => {
    const film = document.querySelector('.sg-film video')
    const q = film?.getVideoPlaybackQuality?.()
    if (film && !film.__seeks) { film.__seeks = 0; film.addEventListener('seeking', () => film.__seeks++) }
    const s = window.__stagePerf
    if (!s) throw new Error('window.__stagePerf missing: is this the right build?')
    return {
      now: performance.now(), ...window.__bench, frames: s.frames ?? 0, detects: s.detects ?? 0,
      poseMs: s.poseMs, faceMs: s.faceMs, faceDetects: s.faceDetects ?? 0, detectMsTotal: s.detectMsTotal ?? 0, model: s.model, mode: s.mode, delegate: s.delegate,
      filmDropped: q?.droppedVideoFrames ?? 0, filmTotal: q?.totalVideoFrames ?? 0, filmSeeks: film?.__seeks ?? 0,
    }
  })
  const a = await snap(); const ma = await metric()
  await page.waitForTimeout(SECONDS * 1000)
  const b = await snap(); const mb = await metric()
  const secs = (b.now - a.now) / 1000
  const d = (k) => b[k] - a[k]
  const result = {
    label: args.label || '', query: args.query || '', gpu, players: 3, seconds: +secs.toFixed(1),
    rafFps: +(d('raf') / secs).toFixed(1),
    camFramesPerSec: +(d('frames') / secs).toFixed(1),
    posePerSec: +(d('detects') / secs).toFixed(1),
    facePerSec: +(d('faceDetects') / secs).toFixed(1),
    detectMsPerSec: +(d('detectMsTotal') / secs).toFixed(0),
    msPerDetect: +(d('detectMsTotal') / Math.max(1, d('detects'))).toFixed(1),
    reactCommitsPerSec: +(d('commits') / secs).toFixed(1),
    longTasks: d('longCount'), longTaskMs: +d('longMs').toFixed(0),
    mainBusyPct: +(100 * (mb.TaskDuration - ma.TaskDuration) / secs).toFixed(0),
    filmDropped: d('filmDropped'), filmFrames: d('filmTotal'), filmSeeks: d('filmSeeks'),
    poseMsAvg: +(b.poseMs ?? 0).toFixed(0), faceMsAvg: +(b.faceMs ?? 0).toFixed(0),
    model: b.model || '', mode: b.mode || 'main', delegate: b.delegate || '',
  }
  if (args.verbose) console.log(JSON.stringify({ a, b }))
  console.log(JSON.stringify(result))
  if (args.screenshot) await page.screenshot({ path: args.screenshot })
  if (args.verify) {
    // Let the take run to the end and check what would be sent for scoring
    const deadline = Date.now() + (sceneMeta.duration + 20) * 1000
    while (!submitted && Date.now() < deadline) await page.waitForTimeout(500)
    if (!submitted?.meta) throw new Error('take was never submitted')
    const m = submitted.meta
    const expected = Math.floor(m.duration * m.features.fps)
    const per = m.features.players.map((p, i) => ({
      player: i + 1, samples: p.pose.length,
      pose: `${Math.round(100 * p.pose.filter(Boolean).length / p.pose.length)}%`,
      face: `${Math.round(100 * p.face.filter(Boolean).length / p.face.length)}%`,
      poseLen: p.pose.find(Boolean)?.length ?? 0, faceLen: p.face.find(Boolean)?.length ?? 0,
    }))
    const ok = per.every((p) => Math.abs(p.samples - expected) <= 2 && (p.poseLen === 0 || p.poseLen === 21) &&
      (p.faceLen === 0 || p.faceLen === 21)) && m.snapshot_times.length === submitted.frames && submitted.audioBytes > 1000
    console.log(JSON.stringify({ verify: ok ? 'OK' : 'FAIL', duration: +m.duration.toFixed(2), expectedSamples: expected,
      players: per, snapshots: m.snapshot_times, frames: submitted.frames, audioBytes: submitted.audioBytes,
      transcriptSegments: m.browser_transcript.length }))
    if (!ok) process.exitCode = 1
  }
  await browser.close()
} finally {
  cleanup()
}
