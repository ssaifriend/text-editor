import { z } from 'zod'
import { ConfigSnapshot } from './config'
import { encodingNames, eolNames } from './encoding'
import { KeymapSnapshot } from './keymapFile'
import { SessionFile, WindowSnapshot } from './session'

const ipcResult = <T extends z.ZodType, E extends z.ZodType>(value: T, error: E) =>
  z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value }),
    z.object({ ok: z.literal(false), error }),
  ])

export const IoError = z.object({ kind: z.literal('io'), message: z.string() })
export const UnexpectedError = z.object({ kind: z.literal('unexpected'), message: z.string() })

export const EncodingName = z.enum(encodingNames)
export const Eol = z.enum(eolNames)
export const Confidence = z.enum(['high', 'low'])

export const BinaryError = z.object({ kind: z.literal('binary'), message: z.string() })

export const OpenError = z.discriminatedUnion('kind', [IoError, BinaryError, UnexpectedError])
export type OpenError = z.infer<typeof OpenError>

export const OpenedFile = z.object({
  path: z.string(),
  text: z.string(),
  encoding: EncodingName,
  bom: z.boolean(),
  eol: Eol,
  mixedEol: z.boolean(),
  confidence: Confidence,
  hash: z.string(),
  mtimeMs: z.number(),
  readonly: z.boolean(),
  largeFile: z.boolean(),
})
export type OpenedFile = z.infer<typeof OpenedFile>

export const OpenRequest = z.object({ path: z.string(), encoding: EncodingName.optional() })
export type OpenRequest = z.infer<typeof OpenRequest>

export const SaveRequest = z.object({
  path: z.string(),
  text: z.string(),
  encoding: EncodingName,
  bom: z.boolean(),
  eol: Eol,
  expectedHash: z.string().nullable(),
  mode: z.enum(['normal', 'overwrite']),
})
export type SaveRequest = z.infer<typeof SaveRequest>

export const SavedMeta = z.object({
  path: z.string(),
  bytes: z.number().int().nonnegative(),
  hash: z.string(),
  mtimeMs: z.number(),
})
export type SavedMeta = z.infer<typeof SavedMeta>

export const ReadonlyError = z.object({ kind: z.literal('readonly'), message: z.string() })
export const ConflictError = z.object({ kind: z.literal('conflict'), message: z.string(), diskHash: z.string() })
export const EncodingLossyError = z.object({
  kind: z.literal('encodingLossy'),
  message: z.string(),
  positions: z.array(z.number().int().nonnegative()),
})

export const SaveError = z.discriminatedUnion('kind', [
  IoError,
  ReadonlyError,
  ConflictError,
  EncodingLossyError,
  UnexpectedError,
])
export type SaveError = z.infer<typeof SaveError>

export const DialogResult = z.object({ path: z.string().nullable() })
export type DialogResult = z.infer<typeof DialogResult>

export const DirtyEntry = z.object({
  id: z.string().min(1),
  path: z.string().nullable(),
  text: z.string(),
  selection: z.object({ anchor: z.number().int().nonnegative(), head: z.number().int().nonnegative() }),
})
export type DirtyEntry = z.infer<typeof DirtyEntry>

export const CloseChoice = z.enum(['save', 'dontSave', 'cancel'])
export type CloseChoice = z.infer<typeof CloseChoice>

export const CommandRun = z.object({ id: z.string(), args: z.unknown().optional() })
export type CommandRun = z.infer<typeof CommandRun>

export const TreeEntry = z.object({ name: z.string(), path: z.string(), kind: z.enum(['file', 'dir']) })
export type TreeEntry = z.infer<typeof TreeEntry>

export const Bootstrap = z.object({
  paths: z.array(z.string()),
  projectRoot: z.string().nullable(),
  windowId: z.string(),
  session: WindowSnapshot.nullable(),
  test: z.boolean(),
})
export type Bootstrap = z.infer<typeof Bootstrap>

export const contracts = {
  'app.bootstrap': { request: z.undefined(), response: ipcResult(Bootstrap, UnexpectedError) },
  'fs.open': { request: OpenRequest, response: ipcResult(OpenedFile, OpenError) },
  'fs.save': { request: SaveRequest, response: ipcResult(SavedMeta, SaveError) },
  'fs.watch': { request: z.object({ path: z.string() }), response: ipcResult(z.literal(true), UnexpectedError) },
  'fs.unwatch': { request: z.object({ path: z.string() }), response: ipcResult(z.literal(true), UnexpectedError) },
  'fs.tree': { request: z.object({ dir: z.string() }), response: ipcResult(z.array(TreeEntry), OpenError) },
  'fs.create': { request: z.object({ path: z.string() }), response: ipcResult(z.literal(true), OpenError) },
  'fs.rename': { request: z.object({ from: z.string(), to: z.string() }), response: ipcResult(z.literal(true), OpenError) },
  'fs.delete': { request: z.object({ path: z.string() }), response: ipcResult(z.literal(true), OpenError) },
  'dialog.openFolder': { request: z.undefined(), response: ipcResult(DialogResult, UnexpectedError) },
  'window.new': { request: z.undefined(), response: ipcResult(z.literal(true), UnexpectedError) },
  'session.load': {
    request: z.undefined(),
    response: ipcResult(z.object({ session: SessionFile.nullable() }), UnexpectedError),
  },
  'dialog.openFile': { request: z.undefined(), response: ipcResult(DialogResult, UnexpectedError) },
  'dialog.saveFile': { request: z.string().nullable(), response: ipcResult(DialogResult, UnexpectedError) },
  'dialog.confirmClose': {
    request: z.object({ title: z.string() }),
    response: ipcResult(z.object({ choice: CloseChoice }), UnexpectedError),
  },
  'config.get': { request: z.undefined(), response: ipcResult(ConfigSnapshot, UnexpectedError) },
  'keymap.get': { request: z.undefined(), response: ipcResult(KeymapSnapshot, UnexpectedError) },
  'pty.spawn': {
    request: z.object({ cwd: z.string().nullable(), cols: z.number().int().positive(), rows: z.number().int().positive() }),
    response: ipcResult(z.object({ id: z.string(), pid: z.number(), cwd: z.string() }), UnexpectedError),
  },
  'pty.write': { request: z.object({ id: z.string(), data: z.string() }), response: ipcResult(z.literal(true), UnexpectedError) },
  'pty.resize': {
    request: z.object({ id: z.string(), cols: z.number().int().positive(), rows: z.number().int().positive() }),
    response: ipcResult(z.literal(true), UnexpectedError),
  },
  'pty.kill': { request: z.object({ id: z.string() }), response: ipcResult(z.literal(true), UnexpectedError) },
  'pty.isAlive': { request: z.object({ id: z.string() }), response: ipcResult(z.boolean(), UnexpectedError) },
  'dirty.write': { request: DirtyEntry, response: ipcResult(z.literal(true), UnexpectedError) },
  'dirty.clear': { request: z.string(), response: ipcResult(z.literal(true), UnexpectedError) },
  'dirty.list': { request: z.undefined(), response: ipcResult(z.array(DirtyEntry), UnexpectedError) },
} as const

export type Contracts = typeof contracts
export type InvokeChannel = keyof Contracts
export type RequestOf<C extends InvokeChannel> = z.infer<Contracts[C]['request']>
export type ResponseOf<C extends InvokeChannel> = z.infer<Contracts[C]['response']>
export type ValueOf<C extends InvokeChannel> = Extract<ResponseOf<C>, { ok: true }>['value']
export type ErrorOf<C extends InvokeChannel> = Extract<ResponseOf<C>, { ok: false }>['error']

export const pushContracts = {
  'config.changed': ConfigSnapshot,
  'keymap.changed': KeymapSnapshot,
  'command.run': CommandRun,
  'pty.data': z.object({ id: z.string(), data: z.string() }),
  'pty.exit': z.object({ id: z.string(), exitCode: z.number() }),
  'fs.changed': z.object({ path: z.string(), hash: z.string(), mtimeMs: z.number() }),
  'fs.deleted': z.object({ path: z.string() }),
} as const
export type PushChannel = keyof typeof pushContracts
export type PushPayload<C extends PushChannel> = z.infer<(typeof pushContracts)[C]>

export const PtyAck = z.object({ id: z.string(), bytes: z.number().int().nonnegative() })
export type PtyAck = z.infer<typeof PtyAck>
