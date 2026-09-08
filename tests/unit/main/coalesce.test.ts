import { describe, it, expect, vi } from 'vitest'
import { createCoalescer } from '../../../src/main/watch/coalesce'

describe('coalescer', () => {
  it('flushes each path once after the quiet period', async () => {
    vi.useFakeTimers()
    const flushed: string[] = []
    const c = createCoalescer(100, (p) => flushed.push(p))
    c.touch('/a')
    c.touch('/b')
    await vi.advanceTimersByTimeAsync(60)
    c.touch('/a')
    await vi.advanceTimersByTimeAsync(60)
    expect(flushed).toEqual(['/b'])
    await vi.advanceTimersByTimeAsync(60)
    expect(flushed).toEqual(['/b', '/a'])
    c.dispose()
    vi.useRealTimers()
  })
})
