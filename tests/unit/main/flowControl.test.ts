import { describe, it, expect } from 'vitest'
import { createFlowControl } from '../../../src/main/pty/flowControl'

describe('flow control', () => {
  it('pauses once above the high mark and resumes once below the low mark', () => {
    const fc = createFlowControl({ pauseAbove: 1000, resumeBelow: 200 })
    expect(fc.sent(600)).toBeNull()
    expect(fc.sent(500)).toBe('pause')
    expect(fc.paused()).toBe(true)
    expect(fc.sent(100)).toBeNull()
    expect(fc.acked(900)).toBeNull()
    expect(fc.acked(200)).toBe('resume')
    expect(fc.paused()).toBe(false)
    expect(fc.unacked()).toBe(100)
  })

  it('never reports negative unacked bytes', () => {
    const fc = createFlowControl()
    fc.sent(10)
    fc.acked(50)
    expect(fc.unacked()).toBe(0)
  })
})
