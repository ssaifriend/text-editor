import { describe, it, expect } from 'vitest'
import {
  addTab, closeLeaf, createLeaf, findLeaf, leafOfTab, leaves, moveTab, removeTab, resizeSplit,
  setActiveTab, siblingLeaf, splitLeaf, type PaneNode,
} from '@renderer/ui/layout/paneTree'

const single = (): PaneNode => addTab(addTab(createLeaf('p1'), 'p1', 't1'), 'p1', 't2')

describe('tabs in a leaf', () => {
  it('addTab appends and activates', () => {
    const tree = single()
    expect(findLeaf(tree, 'p1')).toEqual({ kind: 'leaf', id: 'p1', tabs: ['t1', 't2'], active: 't2' })
  })

  it('addTab at an index inserts there', () => {
    const tree = addTab(single(), 'p1', 't0', 0)
    expect(findLeaf(tree, 'p1')?.tabs).toEqual(['t0', 't1', 't2'])
  })

  it('setActiveTab switches', () => {
    expect(findLeaf(setActiveTab(single(), 'p1', 't1'), 'p1')?.active).toBe('t1')
  })

  it('removeTab activates the right neighbor, then left, then null', () => {
    const tree = addTab(single(), 'p1', 't3')
    const a = removeTab(setActiveTab(tree, 'p1', 't2'), 't2')
    expect(findLeaf(a, 'p1')).toEqual({ kind: 'leaf', id: 'p1', tabs: ['t1', 't3'], active: 't3' })
    const b = removeTab(a, 't3')
    expect(findLeaf(b, 'p1')?.active).toBe('t1')
    const c = removeTab(b, 't1')
    expect(findLeaf(c, 'p1')).toEqual({ kind: 'leaf', id: 'p1', tabs: [], active: null })
  })

  it('removing an inactive tab keeps the active one', () => {
    const tree = removeTab(single(), 't1')
    expect(findLeaf(tree, 'p1')?.active).toBe('t2')
  })
})

describe('split / close', () => {
  it('splitLeaf replaces the leaf with a split holding it and the new empty leaf', () => {
    const tree = splitLeaf(single(), 'p1', 'row', 'p2')
    expect(tree.kind).toBe('split')
    if (tree.kind !== 'split') return
    expect(tree.direction).toBe('row')
    expect(tree.children.map((c) => c.id)).toEqual(['p1', 'p2'])
    expect(tree.sizes).toEqual([0.5, 0.5])
    expect(findLeaf(tree, 'p2')).toEqual({ kind: 'leaf', id: 'p2', tabs: [], active: null })
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2'])
  })

  it('splitting in the same direction inserts a sibling instead of nesting', () => {
    const tree = splitLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2', 'row', 'p3')
    if (tree.kind !== 'split') throw new Error('expected split')
    expect(tree.children.map((c) => c.id)).toEqual(['p1', 'p2', 'p3'])
    expect(tree.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('splitting in the other direction nests', () => {
    const tree = splitLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2', 'col', 'p3')
    if (tree.kind !== 'split') throw new Error('expected split')
    expect(tree.children[1]?.kind).toBe('split')
    expect(leaves(tree).map((l) => l.id)).toEqual(['p1', 'p2', 'p3'])
  })

  it('closeLeaf removes the leaf and collapses a single-child split', () => {
    const tree = closeLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2')
    expect(tree).toEqual(single())
  })

  it('closeLeaf on the last leaf is a no-op', () => {
    const tree = single()
    expect(closeLeaf(tree, 'p1')).toBe(tree)
  })

  it('closeLeaf keeps remaining sizes normalized', () => {
    const three = splitLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2', 'row', 'p3')
    const tree = closeLeaf(three, 'p1')
    if (tree.kind !== 'split') throw new Error('expected split')
    expect(tree.children.map((c) => c.id)).toEqual(['p2', 'p3'])
    expect(tree.sizes.reduce((a, b) => a + b, 0)).toBeCloseTo(1)
  })

  it('resizeSplit replaces sizes', () => {
    const tree = resizeSplit(splitLeaf(single(), 'p1', 'row', 'p2'), 'root', [0.3, 0.7])
    if (tree.kind !== 'split') throw new Error('expected split')
    expect(tree.sizes).toEqual([0.3, 0.7])
  })
})

describe('moveTab / lookup / sibling', () => {
  it('moveTab moves and activates in the destination and fixes the source active tab', () => {
    const tree = moveTab(splitLeaf(single(), 'p1', 'row', 'p2'), 't2', 'p2', 0)
    expect(findLeaf(tree, 'p1')).toEqual({ kind: 'leaf', id: 'p1', tabs: ['t1'], active: 't1' })
    expect(findLeaf(tree, 'p2')).toEqual({ kind: 'leaf', id: 'p2', tabs: ['t2'], active: 't2' })
    expect(leafOfTab(tree, 't2')?.id).toBe('p2')
  })

  it('siblingLeaf cycles through leaves', () => {
    const tree = splitLeaf(splitLeaf(single(), 'p1', 'row', 'p2'), 'p2', 'row', 'p3')
    expect(siblingLeaf(tree, 'p1', 1).id).toBe('p2')
    expect(siblingLeaf(tree, 'p3', 1).id).toBe('p1')
    expect(siblingLeaf(tree, 'p1', -1).id).toBe('p3')
  })
})
