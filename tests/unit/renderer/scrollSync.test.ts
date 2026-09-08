// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { elementForLine, lineForScrollTop } from '@renderer/markdown/scrollSync'

const build = () => {
  const root = document.createElement('article')
  for (const [line, top] of [[1, 0], [10, 300], [20, 900]] as const) {
    const el = document.createElement('p')
    el.dataset['line'] = String(line)
    Object.defineProperty(el, 'offsetTop', { value: top })
    root.appendChild(el)
  }
  return root
}

describe('scroll sync helpers', () => {
  it('finds the element for a line (greatest data-line ≤ line)', () => {
    const root = build()
    expect(elementForLine(root, 15)?.dataset['line']).toBe('10')
    expect(elementForLine(root, 1)?.dataset['line']).toBe('1')
    expect(elementForLine(root, 99)?.dataset['line']).toBe('20')
  })

  it('finds the first element at or below a scroll offset', () => {
    const root = build()
    expect(lineForScrollTop(root, 0)).toBe(1)
    expect(lineForScrollTop(root, 301)).toBe(20)
    expect(lineForScrollTop(root, 900)).toBe(20)
    expect(lineForScrollTop(root, 5000)).toBeNull()
  })
})
