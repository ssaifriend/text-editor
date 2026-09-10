import { z } from 'zod'
import { SearchSpec } from './search'
import { encodingNames, eolNames } from './encoding'

export const BufferTabSnapshot = z.object({
  kind: z.literal('buffer'),
  path: z.string().nullable(),
  dirtyId: z.string(),
  format: z.object({ encoding: z.enum(encodingNames), bom: z.boolean(), eol: z.enum(eolNames) }),
  hash: z.string().nullable(),
  docHash: z.string(),
  selection: z.object({ anchor: z.number().int().nonnegative(), head: z.number().int().nonnegative() }),
  scrollTop: z.number().nonnegative(),
  history: z.unknown().nullable(),
  languageId: z.string(),
})
export type BufferTabSnapshot = z.infer<typeof BufferTabSnapshot>

export const TerminalTabSnapshot = z.object({ kind: z.literal('terminal'), cwd: z.string(), title: z.string() })
export type TerminalTabSnapshot = z.infer<typeof TerminalTabSnapshot>

export const SearchTabSnapshot = z.object({ kind: z.literal('search'), spec: SearchSpec, replacement: z.string() })
export type SearchTabSnapshot = z.infer<typeof SearchTabSnapshot>

export const PreviewTabSnapshot = z.object({ kind: z.literal('preview'), path: z.string() })
export type PreviewTabSnapshot = z.infer<typeof PreviewTabSnapshot>

export const TabSnapshot = z.discriminatedUnion('kind', [BufferTabSnapshot, TerminalTabSnapshot, SearchTabSnapshot, PreviewTabSnapshot])
export type TabSnapshot = z.infer<typeof TabSnapshot>

export type LeafSnapshot = { kind: 'leaf'; tabs: TabSnapshot[]; active: number | null }
export type SplitSnapshot = { kind: 'split'; direction: 'row' | 'col'; sizes: number[]; children: PaneSnapshot[] }
export type PaneSnapshot = LeafSnapshot | SplitSnapshot

const LeafSnapshotSchema = z.object({
  kind: z.literal('leaf'),
  tabs: z.array(TabSnapshot),
  active: z.number().int().nonnegative().nullable(),
})

export const PaneSnapshot: z.ZodType<PaneSnapshot> = z.lazy(() =>
  z.union([
    LeafSnapshotSchema,
    z.object({
      kind: z.literal('split'),
      direction: z.enum(['row', 'col']),
      sizes: z.array(z.number()),
      children: z.array(PaneSnapshot),
    }),
  ]),
)

export const WindowSnapshot = z.object({
  windowId: z.string(),
  projectRoot: z.string().nullable(),
  sidebar: z.object({ open: z.boolean(), expanded: z.array(z.string()), width: z.number().int().positive().optional() }),
  layout: PaneSnapshot,
  activePath: z.array(z.number().int().nonnegative()),
  findHistory: z.array(z.string()).optional(),
  recentFiles: z.array(z.string()).optional(),
})
export type WindowSnapshot = z.infer<typeof WindowSnapshot>

export const Bounds = z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() })
export type Bounds = z.infer<typeof Bounds>

export const SessionFile = z.object({
  version: z.literal(1),
  cleanExit: z.boolean(),
  windows: z.array(z.object({ snapshot: WindowSnapshot, bounds: Bounds.nullable() })),
})
export type SessionFile = z.infer<typeof SessionFile>
