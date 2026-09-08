export type MoruTestHooks = {
  doc(): string
  selections(): { from: number; to: number }[]
  composing(): boolean
  focus(): void
  setCursor(pos: number): void
  setWhitespace(on: boolean): void
  path(): string | null
}

export type MoruMetrics = {
  readyMs: number | null
  didFinishLoadMs: number | null
  firstPaintMs: number | null
}

export type PtyProbeResult = { output: string; exitCode: number }

declare global {
  interface Window {
    __moruTest?: MoruTestHooks
  }
  // eslint-disable-next-line no-var
  var __moruMetrics: MoruMetrics | undefined
  // eslint-disable-next-line no-var
  var __moruProbePty: (() => Promise<PtyProbeResult>) | undefined
}
