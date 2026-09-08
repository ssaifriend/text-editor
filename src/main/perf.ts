export type Metrics = {
  readyMs: number | null
  didFinishLoadMs: number | null
  firstPaintMs: number | null
}

const uptimeMs = (): number => Math.round(process.uptime() * 1000)

export const metrics: Metrics = { readyMs: null, didFinishLoadMs: null, firstPaintMs: null }

export const markReady = (): void => {
  metrics.readyMs = uptimeMs()
}

export const markDidFinishLoad = (): void => {
  metrics.didFinishLoadMs = uptimeMs()
}

export const markFirstPaint = (): void => {
  metrics.firstPaintMs = uptimeMs()
}
