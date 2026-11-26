// Layout of the call view: which participants get a tile, and how the grid is shaped.

export interface TileCandidate {
  id: string
  self?: boolean
  speaking: boolean
  videoOn: boolean
  /** When they last started speaking, in ms; 0 if never */
  lastSpokeAt: number
}

/**
 * Picks the participants shown when they don't all fit. We are always shown; then whoever is
 * speaking, then people with their camera on, then whoever spoke most recently. The others are
 * summed up in a "+N" tile, which takes the last place. The original order is kept, so tiles don't
 * jump around while people talk.
 */
export function pickTiles<T extends TileCandidate>(people: T[], max: number): { shown: T[]; hidden: number } {
  if (people.length <= max) return { shown: people, hidden: 0 }
  const rank = (p: T): number[] => [p.self ? 1 : 0, p.speaking ? 1 : 0, p.videoOn ? 1 : 0, p.lastSpokeAt]
  const byRank = [...people].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return rb[i] - ra[i]
    return 0
  })
  const chosen = new Set(byRank.slice(0, max - 1).map((p) => p.id))
  return { shown: people.filter((p) => chosen.has(p.id)), hidden: people.length - chosen.size }
}

/**
 * Columns, rows and tile width for `count` tiles of the given aspect ratio in a `width`×`height`
 * area with `gap` between tiles, making the tiles as large as possible.
 */
export function gridShape(
  count: number,
  width: number,
  height: number,
  gap = 0,
  aspect = 16 / 9
): { cols: number; rows: number; tileWidth: number } {
  let best = { cols: 1, rows: 1, tileWidth: 0 }
  for (let cols = 1; cols <= Math.max(1, count); cols++) {
    const rows = Math.ceil(Math.max(1, count) / cols)
    const tileWidth = Math.min(
      (width - gap * (cols - 1)) / cols,
      ((height - gap * (rows - 1)) / rows) * aspect
    )
    if (tileWidth > best.tileWidth) best = { cols, rows, tileWidth: Math.floor(tileWidth) }
  }
  return best
}

/**
 * The grid when everyone is shown: as large as fits, but no smaller than `minWidth`; then as many
 * columns of that size as fit, and the grid scrolls.
 */
export function allTilesShape(
  count: number,
  width: number,
  height: number,
  gap: number,
  minWidth: number
): { cols: number; tileWidth: number; scrolling: boolean } {
  const fit = gridShape(count, width, height, gap)
  if (fit.tileWidth >= minWidth) return { cols: fit.cols, tileWidth: fit.tileWidth, scrolling: false }
  const cols = Math.max(1, Math.floor((width + gap) / (minWidth + gap)))
  return { cols, tileWidth: Math.floor((width - gap * (cols - 1)) / cols), scrolling: true }
}
