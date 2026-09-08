import { EditorView } from '@codemirror/view'
import morphdom from 'morphdom'
import { createEffect, createSignal, on, onCleanup, onMount } from 'solid-js'
import type { Workspace } from '../../app/workspace'
import type { BufferId } from '../../editor/buffers'
import { type KatexLike, createRenderer } from '../../markdown/render'
import { elementForLine, lineForScrollTop, topLineOf } from '../../markdown/scrollSync'

type Props = { readonly ws: Workspace; readonly bufferId: BufferId }

const debounceMs = 150

export const PreviewHost = (props: Props) => {
  let article!: HTMLElement
  const renderer = createRenderer()
  const [katex, setKatex] = createSignal<KatexLike | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let guard: 'editor' | 'preview' | null = null

  const meta = () => props.ws.state.buffers[props.bufferId]

  const render = (): void => {
    const buffer = props.ws.getBuffer(props.bufferId)
    if (!buffer) return
    const settings = props.ws.settings()
    const html = renderer.render(buffer.state.doc.toString(), {
      basePath: buffer.meta?.path ?? null,
      projectRoot: props.ws.state.projectRoot,
      allowRemoteImages: settings.preview.allowRemoteImages,
      katex: katex(),
    })
    morphdom(article, `<article>${html}</article>`, { childrenOnly: true })
  }

  const schedule = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(render, debounceMs)
  }

  createEffect(
    on(
      [() => meta()?.docVersion, () => props.ws.settings().preview.allowRemoteImages, () => props.ws.state.projectRoot, katex],
      schedule,
      { defer: true },
    ),
  )

  createEffect(() => {
    if (!props.ws.settings().markdown.katex || katex()) return
    void import('katex').then((mod) => {
      void import('katex/dist/katex.min.css')
      setKatex(mod.default as KatexLike)
    })
  })

  const release = (): void => {
    requestAnimationFrame(() => {
      guard = null
    })
  }

  const onEditorScroll = (event: Event): void => {
    const view = props.ws.viewForBuffer(props.bufferId)
    if (!view || event.target !== view.scrollDOM || guard === 'preview') return
    const target = elementForLine(article, topLineOf(view))
    if (!target) return
    guard = 'editor'
    article.scrollTop = target.offsetTop
    release()
  }

  const onPreviewScroll = (): void => {
    if (guard === 'editor') return
    const view = props.ws.viewForBuffer(props.bufferId)
    const line = lineForScrollTop(article, article.scrollTop)
    if (!view || line === null) return
    guard = 'preview'
    const target = view.state.doc.line(Math.min(Math.max(1, line), view.state.doc.lines))
    view.dispatch({ effects: EditorView.scrollIntoView(target.from, { y: 'start' }) })
    release()
  }

  onMount(() => {
    render()
    document.addEventListener('scroll', onEditorScroll, true)
    article.addEventListener('scroll', onPreviewScroll)
    onCleanup(() => {
      if (timer) clearTimeout(timer)
      document.removeEventListener('scroll', onEditorScroll, true)
      article.removeEventListener('scroll', onPreviewScroll)
    })
  })

  return (
    <div class="preview-host" data-testid="preview-host">
      <div class="preview-toolbar">
        <span class="preview-title">{meta()?.title ?? ''}</span>
        <button data-testid="preview-copy-html" onClick={() => void props.ws.copyMarkdownHtml(props.bufferId)}>
          Copy HTML
        </button>
        <button data-testid="preview-export-html" onClick={() => void props.ws.exportMarkdown(props.bufferId, 'html')}>
          Export HTML…
        </button>
        <button data-testid="preview-export-pdf" onClick={() => void props.ws.exportMarkdown(props.bufferId, 'pdf')}>
          Export PDF…
        </button>
      </div>
      <article class="md-body preview-body" data-testid="preview-body" lang="ko" ref={article} />
    </div>
  )
}
