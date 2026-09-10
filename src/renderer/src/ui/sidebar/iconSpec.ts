import { basenameOf, extensionOf } from '../../editor/lang'

export type FileIconSpec = { readonly kind: 'badge'; readonly label: string; readonly color: string } | { readonly kind: 'image' } | { readonly kind: 'generic' }

const badges: Record<string, { label: string; color: string }> = {
  ts: { label: 'TS', color: '#3178c6' },
  mts: { label: 'TS', color: '#3178c6' },
  cts: { label: 'TS', color: '#3178c6' },
  tsx: { label: 'TSX', color: '#3178c6' },
  js: { label: 'JS', color: '#c9a800' },
  mjs: { label: 'JS', color: '#c9a800' },
  cjs: { label: 'JS', color: '#c9a800' },
  jsx: { label: 'JSX', color: '#c9a800' },
  json: { label: '{ }', color: '#e08a1e' },
  jsonc: { label: '{ }', color: '#e08a1e' },
  md: { label: 'MD', color: '#519aba' },
  markdown: { label: 'MD', color: '#519aba' },
  py: { label: 'PY', color: '#3572a5' },
  rs: { label: 'RS', color: '#c46b39' },
  go: { label: 'GO', color: '#00add8' },
  html: { label: '<>', color: '#e34c26' },
  htm: { label: '<>', color: '#e34c26' },
  css: { label: '#', color: '#7c4dbd' },
  scss: { label: '#', color: '#c6538c' },
  yml: { label: 'YML', color: '#cb171e' },
  yaml: { label: 'YML', color: '#cb171e' },
  toml: { label: 'TML', color: '#9c4221' },
  sql: { label: 'SQL', color: '#e38c00' },
  sh: { label: '$_', color: '#4e9a3a' },
  bash: { label: '$_', color: '#4e9a3a' },
  zsh: { label: '$_', color: '#4e9a3a' },
  clj: { label: 'CLJ', color: '#63b132' },
  cljs: { label: 'CLJ', color: '#63b132' },
  cljc: { label: 'CLJ', color: '#63b132' },
  edn: { label: 'EDN', color: '#63b132' },
  res: { label: 'RE', color: '#e6484f' },
  resi: { label: 'RE', color: '#e6484f' },
  pdf: { label: 'PDF', color: '#b30b00' },
  txt: { label: 'TXT', color: '#8a8f98' },
  lock: { label: 'LCK', color: '#8a8f98' },
}

const images = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif'])

export const fileIconFor = (name: string): FileIconSpec => {
  const base = basenameOf(name)
  const ext = base.includes('.') && !base.startsWith('.') ? extensionOf(base) : base.startsWith('.') && base.slice(1).includes('.') ? extensionOf(base) : ''
  if (images.has(ext)) return { kind: 'image' }
  const badge = badges[ext]
  return badge ? { kind: 'badge', ...badge } : { kind: 'generic' }
}
