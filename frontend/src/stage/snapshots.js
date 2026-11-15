const SNAPSHOT_FRACTIONS = [0.2, 0.45, 0.7, 0.9] // fallback when a scene has no lines
const MAX_SNAPSHOTS = 6

// When to photograph the players: the middle of each line (where the acting is), at most
// MAX_SNAPSHOTS spread evenly across the lines. Times are seconds since "Action!".
export function snapshotPlan(scene) {
  const mids = scene.lines.map((l) => (l.start + l.end) / 2).filter((x) => x < scene.duration)
  if (mids.length === 0) return SNAPSHOT_FRACTIONS.map((f) => f * scene.duration)
  if (mids.length <= MAX_SNAPSHOTS) return mids
  return Array.from({ length: MAX_SNAPSHOTS }, (_, k) => mids[Math.round((k * (mids.length - 1)) / (MAX_SNAPSHOTS - 1))])
}
