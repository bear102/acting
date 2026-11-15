// Player colours, importable WITHOUT pulling in MediaPipe (vision.js imports @mediapipe/tasks-vision,
// so importing PLAYER_COLORS from there put ~300 kB of MediaPipe into the first-page bundle).
// Single source of truth: vision.js re-exports this.
export const PLAYER_COLORS = ['#e8b84a', '#5ec8d8', '#e0644a', '#9be07a']
