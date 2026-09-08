import { describe, it, expect } from 'vitest'
import { fnv1a32 } from '@shared/hash'

describe('fnv1a32', () => {
  it('is stable, 8 hex digits, and sensitive to content', () => {
    expect(fnv1a32('')).toBe('811c9dc5')
    expect(fnv1a32('a')).toBe('e40c292c')
    expect(fnv1a32('한글')).toMatch(/^[0-9a-f]{8}$/)
    expect(fnv1a32('ab')).not.toBe(fnv1a32('ba'))
  })
})
