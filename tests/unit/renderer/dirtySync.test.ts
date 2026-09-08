import { describe, it, expect, vi } from 'vitest'
import { createDirtySync } from '@renderer/app/dirtySync'

const setup = () => {
  vi.useFakeTimers()
  const write = vi.fn(async (_entry: unknown) => undefined)
  const clear = vi.fn(async (_id: string) => undefined)
  const sync = createDirtySync({ write, clear })
  return { write, clear, sync }
}

const entry = (text: string) => ({ id: 'b1', path: '/a.ts', text, selection: { anchor: 0, head: 0 } })

describe('dirty sync', () => {
  it('writes once 1s after the last change', async () => {
    const { write, sync } = setup()
    sync.changed(entry('a'), true)
    await vi.advanceTimersByTimeAsync(500)
    sync.changed(entry('ab'), true)
    await vi.advanceTimersByTimeAsync(900)
    expect(write).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(200)
    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith(entry('ab'))
    vi.useRealTimers()
  })

  it('caps the delay at 5s while typing continuously', async () => {
    const { write, sync } = setup()
    for (let i = 0; i < 12; i += 1) {
      sync.changed(entry('x'.repeat(i + 1)), true)
      await vi.advanceTimersByTimeAsync(500)
    }
    expect(write).toHaveBeenCalledTimes(1)
    expect(write.mock.calls[0]?.[0]).toMatchObject({ text: 'x'.repeat(10) })
    vi.useRealTimers()
  })

  it('a clean buffer cancels pending writes and clears a previously written entry', async () => {
    const { write, clear, sync } = setup()
    sync.changed(entry('a'), true)
    await vi.advanceTimersByTimeAsync(1100)
    expect(write).toHaveBeenCalledTimes(1)

    sync.changed(entry('ab'), true)
    sync.changed(entry('a'), false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(write).toHaveBeenCalledTimes(1)
    expect(clear).toHaveBeenCalledWith('b1')
    vi.useRealTimers()
  })

  it('clean without a prior write does nothing', async () => {
    const { clear, sync } = setup()
    sync.changed(entry('a'), false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(clear).not.toHaveBeenCalled()
    vi.useRealTimers()
  })

  it('flush writes pending entries immediately', async () => {
    const { write, sync } = setup()
    sync.changed(entry('a'), true)
    await sync.flush()
    expect(write).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})
