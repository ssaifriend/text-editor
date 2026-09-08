import { describe, it, expect } from 'vitest'
import { formatTable, isTableLine } from '@renderer/markdown/table'

describe('formatTable', () => {
  it('pads columns using display width so Korean cells line up', () => {
    const out = formatTable(['| 이름 | Age |', '|---|:-:|', '| 김철수 | 3 |', '| Bob | 42 |'])
    expect(out).toEqual(['| 이름   | Age |', '|--------|:---:|', '| 김철수 |  3  |', '| Bob    | 42  |'])
  })

  it('right-aligns numeric columns declared with ---:', () => {
    expect(formatTable(['|a|b|', '|--|--:|', '|x|1|', '|yy|22|'])).toEqual(['| a   |   b |', '|-----|----:|', '| x   |   1 |', '| yy  |  22 |'])
  })

  it('detects table lines', () => {
    expect(isTableLine('| a | b |')).toBe(true)
    expect(isTableLine('|---|---|')).toBe(true)
    expect(isTableLine('not a table')).toBe(false)
  })
})
