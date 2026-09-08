const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export const graphemeCount = (text: string): number => {
  let count = 0
  for (const _ of segmenter.segment(text)) count += 1
  return count
}
