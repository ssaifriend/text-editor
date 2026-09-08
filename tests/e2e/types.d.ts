import type { MoruTestHooks } from '../../src/renderer/src/testHooks'

export type { MoruTestHooks }

export type MoruMetrics = {
  readyMs: number | null
  didFinishLoadMs: number | null
  firstPaintMs: number | null
}

export type PtyProbeResult = { output: string; exitCode: number }

declare global {
  // eslint-disable-next-line no-var
  var __moruMetrics: MoruMetrics | undefined
  // eslint-disable-next-line no-var
  var __moruProbePty: (() => Promise<PtyProbeResult>) | undefined
}
