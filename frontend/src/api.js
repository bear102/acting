async function json(res) {
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`)
  return res.json()
}

export const api = {
  health: () => fetch('/api/health').then(json),
  scenes: () => fetch('/api/scenes').then(json),
  scene: (id) => fetch(`/api/scenes/${id}`).then(json),
  leaderboard: (sceneId) => fetch(`/api/leaderboard${sceneId ? `?scene_id=${sceneId}` : ''}`).then(json),
  perform: ({ meta, audio, frames, video }) => {
    const fd = new FormData()
    fd.append('meta', JSON.stringify(meta))
    if (audio) fd.append('audio', audio, 'take.webm')
    // Raw (un-mirrored) webcam recording of the take; the server runs full pose + face analysis on it
    if (video) fd.append('video', video, 'take_video.webm')
    frames.forEach((f, i) => fd.append('frames', f, `frame${i}.jpg`))
    return fetch('/api/perform', { method: 'POST', body: fd }).then(json)
  },
}

// Browser text-to-speech, used for rehearsal read-throughs and as Zeus's backup voice.
export function speak(text, { pitch = 1, rate = 1 } = {}) {
  return new Promise((resolve) => {
    if (!window.speechSynthesis) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    u.pitch = pitch
    u.rate = rate
    u.onend = resolve
    u.onerror = resolve
    window.speechSynthesis.speak(u)
  })
}
