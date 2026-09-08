import { A, O, pipe } from '@mobily/ts-belt'

export type PaneId = string
export type TabId = string
export type SplitDirection = 'row' | 'col'

export type PaneLeaf = {
  readonly kind: 'leaf'
  readonly id: PaneId
  readonly tabs: readonly TabId[]
  readonly active: TabId | null
}
export type PaneSplit = {
  readonly kind: 'split'
  readonly id: PaneId
  readonly direction: SplitDirection
  readonly children: readonly PaneNode[]
  readonly sizes: readonly number[]
}
export type PaneNode = PaneLeaf | PaneSplit

export const createLeaf = (id: PaneId): PaneLeaf => ({ kind: 'leaf', id, tabs: [], active: null })

export const leaves = (tree: PaneNode): PaneLeaf[] => (tree.kind === 'leaf' ? [tree] : tree.children.flatMap(leaves))

export const findLeaf = (tree: PaneNode, paneId: PaneId): PaneLeaf | null =>
  pipe(
    leaves(tree),
    A.find((l) => l.id === paneId),
    O.toNullable,
  )

export const leafOfTab = (tree: PaneNode, tabId: TabId): PaneLeaf | null =>
  pipe(
    leaves(tree),
    A.find((l) => l.tabs.includes(tabId)),
    O.toNullable,
  )

const mapNode = (tree: PaneNode, f: (node: PaneNode) => PaneNode): PaneNode => {
  const mapped = f(tree)
  if (mapped !== tree) return mapped
  if (mapped.kind !== 'split') return mapped

  const children = mapped.children.map((c) => mapNode(c, f))
  return children.every((c, i) => c === mapped.children[i]) ? mapped : { ...mapped, children }
}

const updateLeaf = (tree: PaneNode, paneId: PaneId, f: (leaf: PaneLeaf) => PaneLeaf): PaneNode =>
  mapNode(tree, (node) => (node.kind === 'leaf' && node.id === paneId ? f(node) : node))

const insertAt = <T>(xs: readonly T[], index: number, x: T): readonly T[] => [...xs.slice(0, index), x, ...xs.slice(index)]

export const addTab = (tree: PaneNode, paneId: PaneId, tabId: TabId, index?: number): PaneNode =>
  updateLeaf(tree, paneId, (leaf) => ({
    ...leaf,
    tabs: insertAt(leaf.tabs, index ?? leaf.tabs.length, tabId),
    active: tabId,
  }))

const nextActive = (tabs: readonly TabId[], removedIndex: number): TabId | null =>
  tabs[removedIndex] ?? tabs[removedIndex - 1] ?? null

export const removeTab = (tree: PaneNode, tabId: TabId): PaneNode =>
  mapNode(tree, (node) => {
    if (node.kind !== 'leaf' || !node.tabs.includes(tabId)) return node
    const index = node.tabs.indexOf(tabId)
    const tabs = node.tabs.filter((t) => t !== tabId)
    const active = node.active === tabId ? nextActive(tabs, index) : node.active
    return { ...node, tabs, active }
  })

export const setActiveTab = (tree: PaneNode, paneId: PaneId, tabId: TabId): PaneNode =>
  updateLeaf(tree, paneId, (leaf) => (leaf.tabs.includes(tabId) && leaf.active !== tabId ? { ...leaf, active: tabId } : leaf))

export const moveTab = (tree: PaneNode, tabId: TabId, toPaneId: PaneId, index: number): PaneNode =>
  addTab(removeTab(tree, tabId), toPaneId, tabId, index)

const evenSizes = (n: number): readonly number[] => Array.from({ length: n }, () => 1 / n)

const normalize = (sizes: readonly number[]): readonly number[] => {
  const total = sizes.reduce((a, b) => a + b, 0)
  return total === 0 ? evenSizes(sizes.length) : sizes.map((s) => s / total)
}

const splitContaining = (tree: PaneNode, paneId: PaneId): PaneSplit | null => {
  if (tree.kind !== 'split') return null
  if (tree.children.some((c) => c.id === paneId)) return tree
  return pipe(
    tree.children,
    A.map((c) => splitContaining(c, paneId)),
    A.find((s) => s !== null),
    O.toNullable,
  )
}

export const splitLeaf = (tree: PaneNode, paneId: PaneId, direction: SplitDirection, newLeafId: PaneId): PaneNode => {
  const parent = splitContaining(tree, paneId)
  const fresh = createLeaf(newLeafId)

  if (parent && parent.direction === direction) {
    const index = parent.children.findIndex((c) => c.id === paneId)
    const share = parent.sizes[index] ?? 1 / parent.children.length
    const sizes = insertAt(
      parent.sizes.map((s, i) => (i === index ? share / 2 : s)),
      index + 1,
      share / 2,
    )
    return mapNode(tree, (node) =>
      node.kind === 'split' && node.id === parent.id
        ? { ...node, children: insertAt(node.children, index + 1, fresh), sizes: normalize(sizes) }
        : node,
    )
  }

  const splitId = tree.id === paneId ? 'root' : `split:${newLeafId}`
  return mapNode(tree, (node) =>
    node.kind === 'leaf' && node.id === paneId
      ? { kind: 'split', id: splitId, direction, children: [node, fresh], sizes: [0.5, 0.5] }
      : node,
  )
}

const collapse = (node: PaneNode): PaneNode =>
  node.kind === 'split' && node.children.length === 1 ? (node.children[0] as PaneNode) : node

export const closeLeaf = (tree: PaneNode, paneId: PaneId): PaneNode => {
  const parent = splitContaining(tree, paneId)
  if (!parent) return tree

  const index = parent.children.findIndex((c) => c.id === paneId)
  const without: PaneSplit = {
    ...parent,
    children: parent.children.filter((_, i) => i !== index),
    sizes: normalize(parent.sizes.filter((_, i) => i !== index)),
  }

  return mapNode(tree, (node) => (node.kind === 'split' && node.id === parent.id ? collapse(without) : node))
}

export const resizeSplit = (tree: PaneNode, splitId: PaneId, sizes: readonly number[]): PaneNode =>
  mapNode(tree, (node) => (node.kind === 'split' && node.id === splitId ? { ...node, sizes: normalize(sizes) } : node))

export const siblingLeaf = (tree: PaneNode, paneId: PaneId, delta: 1 | -1): PaneLeaf => {
  const all = leaves(tree)
  const index = all.findIndex((l) => l.id === paneId)
  const next = (index + delta + all.length) % all.length
  return all[next] as PaneLeaf
}
