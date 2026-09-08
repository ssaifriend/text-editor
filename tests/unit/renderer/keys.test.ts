import { describe, it, expect } from 'vitest'
import { formatKeys, parseKeys, strokeEquals, strokeFromEvent } from '@renderer/keymap/keys'

const ev = (partial: Partial<KeyboardEvent> & { code: string; key: string }) => ({
  ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...partial,
})

describe('parseKeys', () => {
  it('resolves mod per platform', () => {
    expect(parseKeys('mod+shift+p', 'mac')).toEqual([{ key: 'p', ctrl: false, alt: false, shift: true, meta: true }])
    expect(parseKeys('mod+shift+p', 'win')).toEqual([{ key: 'p', ctrl: true, alt: false, shift: true, meta: false }])
  })

  it('parses chords and aliases', () => {
    expect(parseKeys('cmd+k cmd+d', 'mac')).toHaveLength(2)
    expect(parseKeys('ctrl+/', 'win')[0]?.key).toBe('/')
    expect(parseKeys('Esc', 'mac')[0]?.key).toBe('escape')
    expect(parseKeys('ctrl+up', 'mac')[0]?.key).toBe('arrowup')
    expect(parseKeys('option+space', 'mac')[0]).toEqual({ key: 'space', ctrl: false, alt: true, shift: false, meta: false })
  })
})

describe('strokeFromEvent', () => {
  it('uses code for letters, digits and punctuation', () => {
    expect(strokeFromEvent(ev({ code: 'KeyP', key: 'P', shiftKey: true, metaKey: true }))).toEqual({ key: 'p', ctrl: false, alt: false, shift: true, meta: true })
    expect(strokeFromEvent(ev({ code: 'Slash', key: '?', shiftKey: true }))?.key).toBe('/')
    expect(strokeFromEvent(ev({ code: 'BracketLeft', key: '[' }))?.key).toBe('[')
    expect(strokeFromEvent(ev({ code: 'Digit2', key: '@', shiftKey: true }))?.key).toBe('2')
  })

  it('uses key for named keys', () => {
    expect(strokeFromEvent(ev({ code: 'ArrowUp', key: 'ArrowUp' }))?.key).toBe('arrowup')
    expect(strokeFromEvent(ev({ code: 'Enter', key: 'Enter' }))?.key).toBe('enter')
    expect(strokeFromEvent(ev({ code: 'Space', key: ' ' }))?.key).toBe('space')
    expect(strokeFromEvent(ev({ code: 'F3', key: 'F3' }))?.key).toBe('f3')
  })

  it('ignores pure modifier presses', () => {
    expect(strokeFromEvent(ev({ code: 'ShiftLeft', key: 'Shift', shiftKey: true }))).toBeNull()
    expect(strokeFromEvent(ev({ code: 'MetaLeft', key: 'Meta', metaKey: true }))).toBeNull()
  })

  it('matches parsed strokes', () => {
    const parsed = parseKeys('mod+/', 'mac')[0]!
    expect(strokeEquals(parsed, strokeFromEvent(ev({ code: 'Slash', key: '/', metaKey: true }))!)).toBe(true)
  })
})

describe('formatKeys', () => {
  it('renders platform-specific labels', () => {
    expect(formatKeys(parseKeys('mod+shift+p', 'mac'), 'mac')).toBe('⇧⌘P')
    expect(formatKeys(parseKeys('mod+shift+p', 'win'), 'win')).toBe('Ctrl+Shift+P')
    expect(formatKeys(parseKeys('cmd+k cmd+d', 'mac'), 'mac')).toBe('⌘K ⌘D')
  })
})
