import { EditorSelection, type EditorState, type Text } from '@codemirror/state'
import type { EncodingName, Eol } from '@shared/encoding'
import type { OpenedFile } from '@shared/ipc'
import { basenameOf, languageFor } from './lang'

export type BufferId = string
export type FileMeta = Omit<OpenedFile, 'text'>
export type MakeState = (doc: string, languageId: string) => EditorState
export type Format = { readonly encoding: EncodingName; readonly bom: boolean; readonly eol: Eol }
export type Saved = Format & { readonly doc: Text }

export type Buffer = {
  readonly id: BufferId
  readonly meta: FileMeta | null
  readonly languageId: string
  readonly state: EditorState
  readonly format: Format
  readonly saved: Saved
}

export const metaOfFile = ({ text: _text, ...meta }: OpenedFile): FileMeta => meta

const stripText = metaOfFile

const formatOf = (source: Format): Format => ({ encoding: source.encoding, bom: source.bom, eol: source.eol })

export const createBuffer = (
  id: BufferId,
  file: OpenedFile | null,
  makeState: MakeState,
  untitledFormat: Format,
): Buffer => {
  const languageId = file ? languageFor(file.path).id : 'plain'
  const state = makeState(file?.text ?? '', languageId)
  const format = file ? formatOf(file) : untitledFormat

  return { id, meta: file ? stripText(file) : null, languageId, state, format, saved: { ...format, doc: state.doc } }
}

const sameFormat = (a: Format, b: Format): boolean => a.encoding === b.encoding && a.bom === b.bom && a.eol === b.eol

export const isDirty = (buffer: Buffer): boolean =>
  !buffer.state.doc.eq(buffer.saved.doc) || !sameFormat(buffer.format, buffer.saved)

export const titleOf = (buffer: Buffer): string => (buffer.meta ? basenameOf(buffer.meta.path) : 'untitled')

export const withState = (buffer: Buffer, state: EditorState): Buffer => ({ ...buffer, state })

export const withFormat = (buffer: Buffer, patch: Partial<Format>): Buffer => ({
  ...buffer,
  format: { ...buffer.format, ...patch },
})

export const markSaved = (buffer: Buffer, meta: FileMeta): Buffer => ({
  ...buffer,
  meta,
  format: formatOf(meta),
  saved: { ...formatOf(meta), doc: buffer.state.doc },
})

export const replaceContents = (buffer: Buffer, file: OpenedFile, makeState: MakeState): Buffer => {
  const state = makeState(file.text, buffer.languageId)
  return { ...buffer, meta: stripText(file), state, format: formatOf(file), saved: { ...formatOf(file), doc: state.doc } }
}

export const withLanguage = (buffer: Buffer, languageId: string, makeState: MakeState): Buffer => {
  const fresh = makeState(buffer.state.doc.toString(), languageId)
  const ranges = buffer.state.selection.ranges.map((r) => EditorSelection.range(r.anchor, r.head))
  const state = fresh.update({ selection: EditorSelection.create(ranges, buffer.state.selection.mainIndex) }).state

  return { ...buffer, languageId, state }
}
