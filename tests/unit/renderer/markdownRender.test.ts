// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { createRenderer, toAppFileUrl } from '@renderer/markdown/render'

const r = createRenderer()
const opts = { basePath: '/proj/docs/a.md', projectRoot: '/proj', allowRemoteImages: false, katex: null }

describe('render', () => {
  it('injects data-line on blocks and renders GFM tables, task lists and strikethrough', () => {
    const html = r.render('# T\n\ntext\n\n- [x] done\n- [ ] todo\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n~~gone~~', opts)
    expect(html).toContain('<h1 data-line="1"')
    expect(html).toContain('<p data-line="3"')
    expect(html).toMatch(/role="checkbox"[^>]*data-checked="1"/)
    expect((html.match(/role="checkbox"/g) ?? []).length).toBe(2)
    expect(html).toContain('<table')
    expect(html).toContain('<s>gone</s>')
    expect(html).toContain('data-line="8"')
  })

  it('strips scripts and handlers but keeps data-line', () => {
    const html = r.render('<p onclick="x()" data-line="9">hi</p>\n\n<script>alert(1)</script>\n\n<a href="javascript:alert(1)">j</a>', opts)
    expect(html).not.toContain('script')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('javascript:')
    expect(html).toContain('data-line="9"')
  })

  it('rewrites local images under the project root and blocks the rest', () => {
    expect(toAppFileUrl('./img/x.png', '/proj/docs/a.md', '/proj')).toBe('app-file://local/%2Fproj%2Fdocs%2Fimg%2Fx.png')
    expect(toAppFileUrl('../../etc/passwd', '/proj/docs/a.md', '/proj')).toBeNull()
    expect(toAppFileUrl('x.png', null, '/proj')).toBeNull()
    const html = r.render('![alt](./x.png) ![r](https://h/i.png) ![bad](../../o.png)', opts)
    expect(html).toContain('src="app-file://local/%2Fproj%2Fdocs%2Fx.png"')
    expect(html).not.toContain('https://h/i.png')
    expect((html.match(/data-blocked/g) ?? []).length).toBe(2)
    expect(r.render('![r](https://h/i.png)', { ...opts, allowRemoteImages: true })).toContain('src="https://h/i.png"')
  })

  it('renders footnotes and heading anchors', () => {
    const html = r.render('# 제목 하나\n\ntext[^1]\n\n[^1]: note', opts)
    expect(html).toMatch(/<h1[^>]*id="/)
    expect(html).toContain('footnote')
  })

  it('renders 10k lines under budget', () => {
    const source = Array.from({ length: 10_000 }, (_, i) => (i % 7 === 0 ? `## H${i}` : `line ${i} with **bold** and \`code\``)).join('\n')
    const started = performance.now()
    r.render(source, opts)
    const elapsed = performance.now() - started
    console.log(`markdown render 10k lines: ${elapsed.toFixed(0)} ms`)
    expect(elapsed).toBeLessThan(process.env['CI'] ? 1500 : 600)
  })
})
