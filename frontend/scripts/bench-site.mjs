// Site performance bench (everything except the live take itself).
//
//   npm run build && npx vite preview --port 4401 --strictPort      (in another terminal)
//   node scripts/bench-site.mjs [url] [--slow-net] [--cpu=4]
//
// Playwright is not a project dependency; point PLAYWRIGHT_MODULE at any install, e.g.
//   set PLAYWRIGHT_MODULE=file:///C:/path/to/node_modules/playwright/index.mjs
//
// Per screen it reports: main-thread busy % while idle (decorative animations), style/layout ms
// per second, frames/s the page paints, long tasks, JS heap. For the first load it reports
// FCP/LCP, transferred bytes and time-to-interactive-ish (Home button clickable).
// The API is mocked from scenes/*.json so the backend is not needed.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..')
const args = process.argv.slice(2)
const URL = args.find((a) => a.startsWith('http')) || 'http://localhost:4401/'
const SLOW = args.includes('--slow-net')
const CPU = Number((args.find((a) => a.startsWith('--cpu=')) || '--cpu=1').split('=')[1])
const IDLE_MS = 4000

const scenes = fs.readdirSync(path.join(REPO, 'scenes')).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(REPO, 'scenes', f), 'utf8')))
for (const s of scenes) if (s.video && !fs.existsSync(path.join(REPO, 'scenes', s.video))) s.video = null
const summary = (s) => ({ id: s.id, title: s.title, book: s.book, blurb: s.blurb, difficulty: s.difficulty, video: s.video,
  duration: s.duration, characters: s.characters, order: s.order, lines: s.lines.length, has_reference: !!s.reference })
const detail = (s) => ({ ...s, reference: s.reference?.pose ? { fps: s.reference.fps, shots: s.reference.shots, pose: s.reference.pose } : null, has_reference: !!s.reference })
const film = scenes.find((s) => s.video) || scenes[0]

function fakeResult(s) {
  const j = (score, note) => ({ score, note })
  return {
    scene_id: s.id, scene_title: s.title, team_name: 'Bench Crew', team_size: s.characters.length,
    score: 68, kleos: 684, rank: 'Hero of Troy',
    judges: {
      athena: { ...j(81, 'bench'), lines: s.lines.map((l) => ({ character: l.character, text: l.text, accuracy: 80, heard_at: l.start, cue_at: l.start })) },
      apollo: j(64, 'bench'),
      ares: { ...j(58, 'bench'), per_character: Object.fromEntries(s.characters.map((c) => [c.id, 60])) },
      aphrodite: { ...j(72, 'bench'), per_character: Object.fromEntries(s.characters.map((c) => [c.id, 70])) },
    },
    stars: s.characters.map((c, i) => ({ name: `P${i + 1}`, characters: [c.id], score: 60 })),
    verdict: { athena: 'a', apollo: 'b', ares: 'c', aphrodite: 'd', zeus: 'Zeus has spoken.', epithet: 'the Bench Crew', source: 'fallback' },
    transcript: 'bench', stt_source: 'whisper', critic: null,
  }
}

async function mock(page) {
  await page.route('**/api/health', (r) => r.fulfill({ json: { ok: true, elevenlabs: true, gemini: false, whisper: true, leaderboard: 'local-file' } }))
  await page.route('**/api/scenes', (r) => r.fulfill({ json: [...scenes].sort((a, b) => (a.order ?? 99) - (b.order ?? 99)).map(summary) }))
  await page.route(/\/api\/scenes\/[^/?]+$/, (r) => { const id = r.request().url().split('/').pop(); r.fulfill({ json: detail(scenes.find((s) => s.id === id)) }) })
  await page.route('**/api/leaderboard**', (r) => r.fulfill({ json: Array.from({ length: 12 }, (_, i) => ({ team_name: `Crew ${i}`, epithet: 'x', scene_title: film.title, scene_id: film.id, team_size: 2, rank: 'Hero of Troy', kleos: 900 - i * 40 })) }))
  await page.route('**/api/perform', async (r) => { await new Promise((res) => setTimeout(res, 2500)); r.fulfill({ json: fakeResult(film) }) })
  await page.route('**/media/**', (r) => {
    const f = path.join(REPO, 'scenes', 'media', r.request().url().split('/media/')[1].split('?')[0])
    return fs.existsSync(f) ? r.fulfill({ path: f, contentType: 'video/mp4' }) : r.fulfill({ status: 404 })
  })
}

// Long tasks + frame counter, installed before any page script runs.
const INIT = () => {
  window.__lt = []
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__lt.push(e.duration))).observe({ type: 'longtask', buffered: true }) } catch { /* unsupported */ }
  window.__lcp = 0
  try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { window.__lcp = e.startTime })).observe({ type: 'largest-contentful-paint', buffered: true }) } catch { /* unsupported */ }
  window.__frames = 0
  const tick = () => { window.__frames++; requestAnimationFrame(tick) }
  requestAnimationFrame(tick)
}

async function metrics(cdp) {
  const { metrics: m } = await cdp.send('Performance.getMetrics')
  return Object.fromEntries(m.map((x) => [x.name, x.value]))
}

// Trace the idle window and count main-thread rendering work PER FRAME. Unlike busy% / fps these
// ratios barely depend on how loaded the machine is, so before/after runs are comparable.
async function trace(cdp, ms) {
  const events = []
  const onData = (d) => { for (const e of d.value) events.push(e) }
  cdp.on('Tracing.dataCollected', onData)
  const done = new Promise((res) => cdp.once('Tracing.tracingComplete', res))
  await cdp.send('Tracing.start', { categories: 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame', transferMode: 'ReportEvents' })
  await new Promise((r) => setTimeout(r, ms))
  await cdp.send('Tracing.end')
  await done
  cdp.off('Tracing.dataCollected', onData)
  const count = (n) => events.filter((e) => e.name === n && e.ph !== 'E').length
  const frames = count('BeginMainThreadFrame') || 1
  let paintArea = 0
  for (const e of events) {
    const c = e.name === 'Paint' && e.args?.data?.clip
    if (c && c.length >= 8) {
      const cx = (v) => Math.max(0, Math.min(1366, v))
      const cy = (v) => Math.max(0, Math.min(768, v))
      paintArea += Math.abs((cx(c[2]) - cx(c[0])) * (cy(c[5]) - cy(c[1])))
    }
  }
  return {
    mainFrames: frames,
    paintsPerFrame: +(count('Paint') / frames).toFixed(2),
    stylePerFrame: +(count('UpdateLayoutTree') / frames).toFixed(2),
    layoutPerFrame: +(count('Layout') / frames).toFixed(2),
    paintKpxPerFrame: Math.round(paintArea / frames / 1000),
  }
}

async function idle(page, cdp, name, { keepMouse = false } = {}) {
  if (!keepMouse) await page.mouse.move(3, 3) // don't let a hover (e.g. film poster playing) pollute the idle numbers
  await page.waitForTimeout(1500) // let entrance animations finish
  await page.evaluate(() => { window.__lt = []; window.__frames = 0 })
  const a = await metrics(cdp)
  const profiling = process.env.PROFILE === name
  if (profiling) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.start') }
  const tr = await trace(cdp, IDLE_MS)
  if (profiling) {
    // PROFILE=<screen>: print the top self-time functions in that idle window
    const { profile } = await cdp.send('Profiler.stop')
    const self = new Map()
    const dtUs = profile.timeDeltas
    const byId = new Map(profile.nodes.map((n) => [n.id, n]))
    profile.samples.forEach((id, i) => {
      const f = byId.get(id).callFrame
      const key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`
      self.set(key, (self.get(key) || 0) + (dtUs[i] || 0))
    })
    console.log(`    top self time in ${name}:`)
    ;[...self].sort((x, y) => y[1] - x[1]).slice(0, 12).forEach(([k, us]) => console.log(`      ${(us / 1000).toFixed(0).padStart(6)} ms  ${k}`))
  }
  const b = await metrics(cdp)
  const dt = (b.Timestamp - a.Timestamp)
  const pg = await page.evaluate(() => ({ lt: window.__lt, frames: window.__frames }))
  const row = {
    screen: name,
    ...tr,
    busyPct: +(100 * (b.TaskDuration - a.TaskDuration) / dt).toFixed(1),
    scriptMsPerS: +(1000 * (b.ScriptDuration - a.ScriptDuration) / dt).toFixed(1),
    styleLayoutMsPerS: +(1000 * ((b.RecalcStyleDuration - a.RecalcStyleDuration) + (b.LayoutDuration - a.LayoutDuration)) / dt).toFixed(1),
    fps: +(pg.frames / dt).toFixed(0),
    longTasks: pg.lt.length,
    heapMB: +(b.JSHeapUsedSize / 1048576).toFixed(1),
  }
  console.log(Object.values(row).map((v) => String(v).padEnd(10)).join(''))
  // Running infinite animations that the compositor can't take (they cost main-thread work every frame)
  row.mainThreadAnimations = await page.evaluate(() => {
    const ok = new Set(['transform', 'opacity', 'translate', 'rotate', 'scale', 'offset', 'computedOffset', 'easing', 'composite'])
    return [...new Set(document.getAnimations()
      .filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)
      .map((a) => {
        const props = [...new Set(a.effect.getKeyframes().flatMap((k) => Object.keys(k)))].filter((p) => !ok.has(p))
        if (!props.length) return null
        const t = a.effect.target
        const cls = (t?.getAttribute?.('class') || t?.tagName || '?').split(' ')[0]
        return `${a.animationName || 'anim'}(${props.join(',')})@${cls}${a.effect.pseudoElement || ''}`
      }).filter(Boolean))]
  })
  if (row.mainThreadAnimations.length) console.log('    main-thread anims:', row.mainThreadAnimations.join('  '))
  return row
}

const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] })
const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, permissions: ['camera', 'microphone'] })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.log('  pageerror:', e.message))
await ctx.addInitScript(INIT)
await mock(page)
const cdp = await ctx.newCDPSession(page)
await cdp.send('Performance.enable')
await cdp.send('Network.enable')
await cdp.send('Network.setCacheDisabled', { cacheDisabled: true })
if (SLOW) await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 })
if (CPU > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU })

let bytes = 0
cdp.on('Network.loadingFinished', (e) => { bytes += e.encodedDataLength })

// ---- first load
const t0 = Date.now()
await page.goto(URL, { waitUntil: 'load' })
const loadMs = Date.now() - t0
const cta = page.locator('.oh-shield').or(page.locator('button').filter({ hasText: /begin|set sail|start|trial/i })).first()
await cta.waitFor({ state: 'visible', timeout: 60000 })
const ctaMs = Date.now() - t0
await page.waitForTimeout(1500)
const paint = await page.evaluate(() => ({
  fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime || 0,
  lcp: window.__lcp,
}))
const firstLoad = { loadMs, ctaVisibleMs: ctaMs, fcp: Math.round(paint.fcp), lcp: Math.round(paint.lcp), transferredKB: Math.round(bytes / 1024) }
console.log('first load:', JSON.stringify(firstLoad))
await cdp.send('Network.setCacheDisabled', { cacheDisabled: false })

console.log(['screen', 'mainFr', 'paint/fr', 'style/fr', 'layout/fr', 'kpx/fr', 'busy%', 'script/s', 'style+lay', 'fps', 'longT', 'heapMB'].map((s) => s.padEnd(10)).join(''))
const rows = []
rows.push(await idle(page, cdp, 'home'))
await cta.click()
await page.waitForTimeout(800)
rows.push(await idle(page, cdp, 'scenes'))
// hover the film card (poster video plays on hover)
const filmCard = page.locator('.ss-film').first()
if (await filmCard.count()) {
  await filmCard.hover()
  rows.push(await idle(page, cdp, 'scenes-hover', { keepMouse: true }))
  await filmCard.click()
} else {
  await page.locator('button').filter({ hasText: film.title }).first().click()
}
await page.waitForTimeout(800)
rows.push(await idle(page, cdp, 'team'))
await page.locator('.ss-cta').first().click()
await page.waitForTimeout(800)
rows.push(await idle(page, cdp, 'rehearse'))
// stage: time until the camera + models are ready
const tStage = Date.now()
await page.locator('.ss-cta').first().click()
let stageReadyMs = null
try {
  await page.getByRole('button', { name: 'Action!' }).waitFor({ timeout: 120000 })
  stageReadyMs = Date.now() - tStage
} catch { console.log('  stage never became ready') }
console.log('stage ready (camera + models):', stageReadyMs, 'ms')
await page.getByRole('button', { name: 'Action!' }).click().catch(() => {})
await page.waitForTimeout(4500)
await page.getByRole('button', { name: /End scene/ }).click().catch(() => {})
await page.waitForTimeout(600)
rows.push(await idle(page, cdp, 'judging'))
await page.waitForTimeout(3000)
rows.push(await idle(page, cdp, 'verdict'))
await page.getByRole('button', { name: /Hall of Heroes/ }).first().click().catch(() => {})
await page.waitForTimeout(800)
rows.push(await idle(page, cdp, 'hall'))

await browser.close()
const out = { url: URL, slowNet: SLOW, cpu: CPU, firstLoad, stageReadyMs, rows }
const outFile = process.env.BENCH_OUT
if (outFile) fs.writeFileSync(outFile, JSON.stringify(out, null, 1))
