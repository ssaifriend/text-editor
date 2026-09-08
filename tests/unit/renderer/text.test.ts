import { describe, it, expect } from 'vitest'
import { graphemeCount } from '@renderer/editor/text'

describe('graphemeCount', () => {
  it('counts ASCII characters', () => {
    expect(graphemeCount('abc')).toBe(3)
  })

  it('counts precomposed Hangul syllables as one each', () => {
    expect(graphemeCount('한글')).toBe(2)
  })

  it('counts a decomposed (NFD) Hangul syllable as one', () => {
    expect(graphemeCount('한'.normalize('NFD'))).toBe(1)
  })

  it('counts a ZWJ emoji family as one', () => {
    expect(graphemeCount('👨‍👩‍👧')).toBe(1)
  })

  it('counts combining marks with their base', () => {
    expect(graphemeCount('e\u0301')).toBe(1)
  })

  it('returns 0 for empty text', () => {
    expect(graphemeCount('')).toBe(0)
  })
})
