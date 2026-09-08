export type FlowLimits = { readonly pauseAbove: number; readonly resumeBelow: number }

export type FlowControl = {
  readonly sent: (bytes: number) => 'pause' | null
  readonly acked: (bytes: number) => 'resume' | null
  readonly unacked: () => number
  readonly paused: () => boolean
}

const defaults: FlowLimits = { pauseAbove: 1_048_576, resumeBelow: 262_144 }

export const createFlowControl = (limits: FlowLimits = defaults): FlowControl => {
  let unacked = 0
  let paused = false

  return {
    sent: (bytes) => {
      unacked += bytes
      if (!paused && unacked > limits.pauseAbove) {
        paused = true
        return 'pause'
      }
      return null
    },
    acked: (bytes) => {
      unacked = Math.max(0, unacked - bytes)
      if (paused && unacked < limits.resumeBelow) {
        paused = false
        return 'resume'
      }
      return null
    },
    unacked: () => unacked,
    paused: () => paused,
  }
}
