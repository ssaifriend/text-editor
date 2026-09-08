import { describe, it, expect } from 'vitest'
import { createExpectedWrites } from '../../../src/main/watch/expected'

describe('expected writes', () => {
  it('consumes a matching record once', () => {
    const now = 1000
    const ew = createExpectedWrites(() => now, 10_000)
    ew.record('/a', 'h1')
    expect(ew.consume('/a', 'h1')).toBe(true)
    expect(ew.consume('/a', 'h1')).toBe(false)
  })

  it('ignores different hashes and expired records', () => {
    let now = 1000
    const ew = createExpectedWrites(() => now, 10_000)
    ew.record('/a', 'h1')
    expect(ew.consume('/a', 'other')).toBe(false)
    ew.record('/a', 'h1')
    now = 12_000
    expect(ew.consume('/a', 'h1')).toBe(false)
  })
})
