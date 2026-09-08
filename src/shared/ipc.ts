import { z } from 'zod'
import { encodingNames, eolNames } from './encoding'

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

export const Bootstrap = z.object({ path: z.string().nullable(), test: z.boolean() })
export type Bootstrap = z.infer<typeof Bootstrap>

export const contracts = {
  'app.bootstrap': { request: z.undefined(), response: ipcResult(Bootstrap, UnexpectedError) },
  'fs.open': { request: OpenRequest, response: ipcResult(OpenedFile, OpenError) },
  'fs.save': { request: SaveRequest, response: ipcResult(SavedMeta, SaveError) },
  'dialog.openFile': { request: z.undefined(), response: ipcResult(DialogResult, UnexpectedError) },
  'dialog.saveFile': { request: z.string().nullable(), response: ipcResult(DialogResult, UnexpectedError) },
  'config.get': { request: z.undefined(), response: ipcResult(z.unknown(), UnexpectedError) },
  'dirty.write': { request: z.unknown(), response: ipcResult(z.null(), UnexpectedError) },
  'dirty.clear': { request: z.string(), response: ipcResult(z.null(), UnexpectedError) },
  'dirty.list': { request: z.undefined(), response: ipcResult(z.unknown(), UnexpectedError) },
} as const

export type Contracts = typeof contracts
export type InvokeChannel = keyof Contracts
export type RequestOf<C extends InvokeChannel> = z.infer<Contracts[C]['request']>
export type ResponseOf<C extends InvokeChannel> = z.infer<Contracts[C]['response']>
export type ValueOf<C extends InvokeChannel> = Extract<ResponseOf<C>, { ok: true }>['value']
export type ErrorOf<C extends InvokeChannel> = Extract<ResponseOf<C>, { ok: false }>['error']

export const pushContracts = {
  'config.changed': z.unknown(),
} as const
export type PushChannel = keyof typeof pushContracts
export type PushPayload<C extends PushChannel> = z.infer<(typeof pushContracts)[C]>
