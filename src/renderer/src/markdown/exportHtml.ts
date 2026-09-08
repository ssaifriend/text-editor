export const previewCss = `
.md-body { max-width: 80ch; margin: 0 auto; padding: 16px 24px 48px; line-height: 1.65; word-break: keep-all; overflow-wrap: anywhere; font-family: -apple-system, "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", system-ui, sans-serif; font-size: 15px; }
.md-body h1, .md-body h2, .md-body h3 { line-height: 1.3; margin: 1.4em 0 0.6em; }
.md-body h1 { font-size: 1.9em; border-bottom: 1px solid rgba(128,128,128,0.35); padding-bottom: 0.3em; }
.md-body h2 { font-size: 1.5em; border-bottom: 1px solid rgba(128,128,128,0.25); padding-bottom: 0.2em; }
.md-body pre { padding: 12px 14px; border-radius: 6px; overflow: auto; background: rgba(128,128,128,0.12); }
.md-body code { font-family: ui-monospace, Menlo, Consolas, "D2Coding", monospace; font-size: 0.92em; }
.md-body :not(pre) > code { padding: 0.1em 0.35em; border-radius: 4px; background: rgba(128,128,128,0.16); }
.md-body table { border-collapse: collapse; margin: 1em 0; display: block; overflow-x: auto; }
.md-body th, .md-body td { border: 1px solid rgba(128,128,128,0.35); padding: 6px 12px; }
.md-body th { background: rgba(128,128,128,0.12); }
.md-body blockquote { margin: 1em 0; padding: 0.2em 1em; border-left: 4px solid rgba(128,128,128,0.4); opacity: 0.9; }
.md-body img { max-width: 100%; }
.md-body .md-blocked { display: inline-block; padding: 2px 8px; border: 1px dashed rgba(128,128,128,0.5); border-radius: 4px; font-size: 0.85em; opacity: 0.7; }
.md-body .task-list-item { list-style: none; margin-left: -1.4em; }
.md-body .task-checkbox { display: inline-block; width: 1em; height: 1em; border: 1px solid currentColor; border-radius: 3px; vertical-align: -0.15em; margin-right: 0.4em; position: relative; }
.md-body .task-checkbox[data-checked="1"]::after { content: ""; position: absolute; left: 0.28em; top: 0.05em; width: 0.3em; height: 0.6em; border: solid currentColor; border-width: 0 2px 2px 0; transform: rotate(45deg); }
.md-body .footnotes { font-size: 0.9em; opacity: 0.85; }
.md-body hr { border: 0; border-top: 1px solid rgba(128,128,128,0.35); }
`

export const wrapDocument = (bodyHtml: string, title: string): string =>
  `<!doctype html>\n<html lang="ko">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>${title.replace(/[<>&]/g, '')}</title>\n<style>${previewCss}</style>\n</head>\n<body>\n<article class="md-body">\n${bodyHtml}\n</article>\n</body>\n</html>\n`

export const exportName = (path: string | null, ext: 'html' | 'pdf'): string => {
  const base = path ? path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1) : 'untitled.md'
  return `${base.replace(/\.[^.]+$/, '')}.${ext}`
}
