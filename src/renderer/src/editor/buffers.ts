import { EditorSelection, type EditorState, type Text } from '@codemirror/state'
import type { OpenedFile } from '@shared/ipc'
import { basenameOf, languageFor } from './lang'

export type BufferId = string
export type FileMeta = Omit<OpenedFile, 'text'>
export type MakeState = (doc: string, languageId: string) => EditorState

export type Buffer = {
  readonly id: BufferId
  readonly meta: FileMeta | null
  readonly languageId: string
  readonly state: EditorState
  readonly savedDoc: Text
}

const stripText = ({ text: _text, ...meta }: OpenedFile): FileMeta => meta

export const createBuffer = (id: BufferId, file: OpenedFile | null, makeState: MakeState): Buffer => {
  const languageId = file ? languageFor(file.path).id : 'plain'
  const state = makeState(file?.text ?? '', languageId)
  const meta = file ? stripText(file) : null

  return { id, meta, languageId, state, savedDoc: state.doc }
}

export const isDirty = (buffer: Buffer): boolean => !buffer.state.doc.eq(buffer.savedDoc)

export const titleOf = (buffer: Buffer): string => (buffer.meta ? basenameOf(buffer.meta.path) : 'untitled')

export const withState = (buffer: Buffer, state: EditorState): Buffer => ({ ...buffer, state })

export const markSaved = (buffer: Buffer, meta: FileMeta): Buffer => ({ ...buffer, meta, savedDoc: buffer.state.doc })

export const withLanguage = (buffer: Buffer, languageId: string, makeState: MakeState): Buffer => {
  const fresh = makeState(buffer.state.doc.toString(), languageId)
  const ranges = buffer.state.selection.ranges.map((r) => EditorSelection.range(r.anchor, r.head))
  const state = fresh.update({ selection: EditorSelection.create(ranges, buffer.state.selection.mainIndex) }).state

  return { ...buffer, languageId, state }
}
