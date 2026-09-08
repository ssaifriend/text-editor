import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import anchor from 'markdown-it-anchor'
import footnote from 'markdown-it-footnote'
import { appFileUrl, dirnameOf, isUnder, resolveFrom } from '@shared/appFile'

export type KatexLike = { renderToString: (tex: string, opts: { displayMode: boolean; throwOnError: boolean }) => string }

export type RenderOptions = {
  readonly basePath: string | null
  readonly projectRoot: string | null
  readonly allowRemoteImages: boolean
  readonly katex: KatexLike | null
}

type Env = RenderOptions
type Md = InstanceType<typeof MarkdownIt>
type CoreRule = Parameters<Md['core']['ruler']['push']>[1]
type InlineRule = Parameters<Md['inline']['ruler']['push']>[1]
type BlockRule = Parameters<Md['block']['ruler']['push']>[1]
type StateCore = Parameters<CoreRule>[0]
type StateInline = Parameters<InlineRule>[0]
type StateBlock = Parameters<BlockRule>[0]
type Token = StateCore['tokens'][number]

export const toAppFileUrl = (src: string, basePath: string | null, projectRoot: string | null): string | null => {
  if (!basePath || !projectRoot) return null
  const clean = decodeURIComponent(src.split(/[?#]/)[0] ?? '')
  if (clean === '') return null
  const absolute = resolveFrom(dirnameOf(basePath), clean)
  return isUnder(absolute, projectRoot) ? appFileUrl(absolute) : null
}

const resolveImage = (src: string, env: Env): string | null => {
  if (/^https?:/i.test(src)) return env.allowRemoteImages ? src : null
  if (/^app-file:/i.test(src)) return src
  if (/^[a-z][a-z0-9+.-]*:/i.test(src)) return null
  return toAppFileUrl(src, env.basePath, env.projectRoot)
}

const escapeHtml = (text: string): string =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c)

const lineAttr: CoreRule = (state: StateCore): void => {
  for (const token of state.tokens) {
    const isBlockOpen = token.nesting === 1 || token.type === 'fence' || token.type === 'code_block' || token.type === 'hr'
    if (token.block && token.map && isBlockOpen) token.attrSet('data-line', String(token.map[0] + 1))
  }
}

const taskLists: CoreRule = (state: StateCore): void => {
  const tokens = state.tokens
  for (let i = 2; i < tokens.length; i++) {
    const inline = tokens[i]!
    if (inline.type !== 'inline' || tokens[i - 1]?.type !== 'paragraph_open' || tokens[i - 2]?.type !== 'list_item_open') continue
    const m = /^\[( |x|X)\]\s+/.exec(inline.content)
    if (!m) continue
    const box = new state.Token('html_inline', '', 0)
    const checked = m[1] !== ' '
    box.content = `<span class="task-checkbox" role="checkbox" aria-checked="${checked}" data-checked="${checked ? '1' : '0'}"></span> `
    const first = inline.children?.[0]
    if (first?.type === 'text') first.content = first.content.slice(m[0].length)
    inline.children = [box, ...(inline.children ?? [])]
    tokens[i - 2]!.attrJoin('class', 'task-list-item')
  }
}

const mathInline: InlineRule = (state: StateInline, silent: boolean): boolean => {
  if (state.src.charCodeAt(state.pos) !== 0x24 || state.src.charCodeAt(state.pos + 1) === 0x24) return false
  const end = state.src.indexOf('$', state.pos + 1)
  if (end < 0 || end === state.pos + 1) return false
  const content = state.src.slice(state.pos + 1, end)
  if (/^\s|\s$/.test(content) || content.includes('\n')) return false
  if (!silent) {
    const token = state.push('math_inline', 'math', 0)
    token.content = content
  }
  state.pos = end + 1
  return true
}

const mathBlock: BlockRule = (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
  const start = state.bMarks[startLine]! + state.tShift[startLine]!
  if (state.src.slice(start, start + 2) !== '$$') return false
  let next = startLine
  let found = false
  for (next = startLine + 1; next < endLine; next++) {
    const s = state.bMarks[next]! + state.tShift[next]!
    if (state.src.slice(s, state.eMarks[next]!).trim() === '$$') {
      found = true
      break
    }
  }
  if (!found) return false
  if (silent) return true
  const token = state.push('math_block', 'math', 0)
  token.block = true
  token.map = [startLine, next + 1]
  token.content = state.getLines(startLine + 1, next, state.tShift[startLine]!, false)
  state.line = next + 1
  return true
}

const purifyOptions = {
  ADD_ATTR: ['data-line', 'data-blocked', 'data-checked', 'align', 'start', 'role', 'aria-checked'],
  ALLOWED_URI_REGEXP: /^(?:app-file:|https?:|mailto:|#)/i,
  FORBID_TAGS: ['style', 'iframe', 'object', 'embed', 'form', 'button', 'textarea', 'select', 'link', 'meta', 'base'],
  FORBID_ATTR: ['style'],
}

export const createRenderer = (): { render: (source: string, opts: RenderOptions) => string } => {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false })
  md.core.ruler.push('data_line', lineAttr)
  md.core.ruler.push('task_lists', taskLists)
  md.use(footnote)
  md.use(anchor, { tabIndex: false })
  md.inline.ruler.after('escape', 'math_inline', mathInline)
  md.block.ruler.after('fence', 'math_block', mathBlock, { alt: ['paragraph', 'reference', 'blockquote', 'list'] })

  const defaultImage = md.renderer.rules['image']!
  md.renderer.rules['image'] = (tokens: Token[], idx: number, options, env: Env, self) => {
    const token = tokens[idx]!
    const src = token.attrGet('src') ?? ''
    const resolved = resolveImage(src, env)
    if (!resolved) {
      const alt = self.renderInlineAsText(token.children ?? [], options, env)
      return `<span class="md-blocked" data-blocked="1">${escapeHtml(alt || 'image')}</span>`
    }
    token.attrSet('src', resolved)
    return defaultImage(tokens, idx, options, env, self)
  }
  const math = (display: boolean) => (tokens: Token[], idx: number, _options: unknown, env: Env) => {
    const content = tokens[idx]!.content
    if (!env.katex) return display ? `<pre class="math">${escapeHtml(content)}</pre>` : `<code class="math">${escapeHtml(content)}</code>`
    const rendered = env.katex.renderToString(content, { displayMode: display, throwOnError: false })
    return display ? `<div class="math-block" data-line="${tokens[idx]!.map ? tokens[idx]!.map![0] + 1 : ''}">${rendered}</div>` : rendered
  }
  md.renderer.rules['math_inline'] = math(false)
  md.renderer.rules['math_block'] = math(true)

  return {
    render: (source, opts) => DOMPurify.sanitize(md.render(source, opts), purifyOptions),
  }
}
