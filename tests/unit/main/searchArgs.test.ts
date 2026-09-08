import { describe, it, expect } from 'vitest'
import { rgArgs } from '../../../src/main/search/args'

const spec = { pattern: 'foo', regexp: false, caseSensitive: false, wholeWord: false, include: '', exclude: '' }
const opts = { encoding: 'auto', maxFileSizeMb: 10, exclude: ['**/dist/**'] }

describe('rgArgs', () => {
  it('builds literal, smart flags and globs', () => {
    expect(rgArgs(spec, ['/r'], opts)).toEqual([
      '--json', '--hidden', '--no-require-git', '--glob', '!.git/**', '--glob', '!**/dist/**', '--max-filesize', '10M', '-i', '-F', '-e', 'foo', '--', '/r',
    ])
  })

  it('passes regex, case, word, include/exclude globs and encoding', () => {
    expect(
      rgArgs(
        { ...spec, regexp: true, caseSensitive: true, wholeWord: true, include: '*.ts, src/**', exclude: '*.md' },
        ['/a', '/b'],
        { ...opts, encoding: 'cp949', exclude: [] },
      ),
    ).toEqual([
      '--json', '--hidden', '--no-require-git', '--glob', '!.git/**', '--max-filesize', '10M', '-E', 'cp949', '-w', '--glob', '*.ts', '--glob', 'src/**', '--glob', '!*.md', '-e', 'foo', '--', '/a', '/b',
    ])
  })
})
