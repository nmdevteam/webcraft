import { beforeEach, describe, expect, it } from 'vitest'
import { getTopLevelSelectedNodes, useBuilderStore } from '../src/store/builder'
import type { BuilderNode } from '@webcraft/core/schema'

function node(id: string, children: BuilderNode[] = []): BuilderNode {
  return { id, type: 'section', props: { text: id }, style: {}, children }
}

function allIds(nodes: BuilderNode[]): string[] {
  return nodes.flatMap((item) => [item.id, ...allIds(item.children)])
}

function resetStore() {
  useBuilderStore.setState({ nodes: [], selectedId: null, selectedIds: [], past: [], future: [] })
}

beforeEach(resetStore)

describe('builder multi-selection', () => {
  it('supports primary selection, additive selection, toggling, and clear', () => {
    useBuilderStore.getState().setNodes([node('a'), node('b'), node('c')])
    const store = useBuilderStore.getState()

    store.select('a')
    store.select('b', true)
    expect(useBuilderStore.getState().selectedIds).toEqual(['a', 'b'])
    expect(useBuilderStore.getState().selectedId).toBe('b')

    useBuilderStore.getState().select('a', true)
    expect(useBuilderStore.getState().selectedIds).toEqual(['b'])
    expect(useBuilderStore.getState().selectedId).toBe('b')

    useBuilderStore.getState().select(null)
    expect(useBuilderStore.getState().selectedIds).toEqual([])
    expect(useBuilderStore.getState().selectedId).toBeNull()
  })

  it('treats a selected parent and child as one copy root', () => {
    const parent = node('parent', [node('child')])
    useBuilderStore.getState().setNodes([parent, node('sibling')])

    expect(getTopLevelSelectedNodes(useBuilderStore.getState().nodes, ['parent', 'child']).map((item) => item.id)).toEqual(['parent'])
  })

  it('duplicates selected roots in place with fresh recursive IDs as one undoable operation', () => {
    const parent = node('parent', [node('child')])
    useBuilderStore.getState().setNodes([parent, node('sibling')])
    useBuilderStore.getState().select('parent')
    useBuilderStore.getState().select('child', true)
    useBuilderStore.getState().select('sibling', true)

    expect(useBuilderStore.getState().duplicateMany(['parent', 'child', 'sibling'])).toBe(true)
    const after = useBuilderStore.getState()
    expect(after.nodes.map((item) => item.id)).toEqual(['parent', expect.any(String), 'sibling', expect.any(String)])
    expect(after.nodes[1]?.children).toHaveLength(1)
    expect(after.selectedIds).toEqual([after.nodes[1]!.id, after.nodes[3]!.id])
    expect(new Set(allIds(after.nodes)).size).toBe(allIds(after.nodes).length)
    expect(after.past).toHaveLength(1)

    after.undo()
    expect(useBuilderStore.getState().nodes).toEqual([parent, node('sibling')])
    expect(useBuilderStore.getState().selectedIds).toEqual([])
    useBuilderStore.getState().redo()
    expect(useBuilderStore.getState().nodes).toHaveLength(4)
  })

  it('deletes overlapping nested selections once and restores them in one undo', () => {
    const original = [node('parent', [node('child')]), node('keep')]
    useBuilderStore.getState().setNodes(original)
    useBuilderStore.getState().select('parent')
    useBuilderStore.getState().select('child', true)

    expect(useBuilderStore.getState().removeMany(['parent', 'child'])).toBe(true)
    expect(useBuilderStore.getState().nodes.map((item) => item.id)).toEqual(['keep'])
    expect(useBuilderStore.getState().past).toHaveLength(1)
    useBuilderStore.getState().undo()
    expect(useBuilderStore.getState().nodes).toEqual(original)
  })

  it('pastes validated clones with fresh IDs and one history checkpoint', () => {
    useBuilderStore.getState().setNodes([node('existing')])

    expect(useBuilderStore.getState().insertMany([node('copied', [node('copied-child')])])).toBe(true)
    const state = useBuilderStore.getState()
    expect(state.nodes).toHaveLength(2)
    expect(state.nodes[1]?.id).not.toBe('copied')
    expect(state.nodes[1]?.children[0]?.id).not.toBe('copied-child')
    expect(new Set(allIds(state.nodes)).size).toBe(allIds(state.nodes).length)
    expect(state.past).toHaveLength(1)
  })

  it('rejects malformed or over-limit paste and duplication without changing state', () => {
    useBuilderStore.getState().setNodes([node('existing')])
    const invalid = [{ ...node('bad id'), id: 'bad id' }]
    expect(useBuilderStore.getState().insertMany(invalid)).toBe(false)
    expect(useBuilderStore.getState().nodes.map((item) => item.id)).toEqual(['existing'])
    expect(useBuilderStore.getState().past).toHaveLength(0)

    const fullTree = Array.from({ length: 5 }, (_, parentIndex) => node(`parent-${parentIndex}`, Array.from({ length: 99 }, (_, childIndex) => node(`child-${parentIndex}-${childIndex}`))))
    useBuilderStore.getState().setNodes(fullTree)
    const before = useBuilderStore.getState().nodes
    expect(useBuilderStore.getState().insertMany([node('extra')])).toBe(false)
    useBuilderStore.getState().select('parent-0')
    expect(useBuilderStore.getState().duplicateMany(['parent-0'])).toBe(false)
    expect(useBuilderStore.getState().nodes).toEqual(before)
    expect(useBuilderStore.getState().past).toHaveLength(0)
  })

  it('rehydrates validated undo/redo history so page edits survive a reload', () => {
    const original = [node('before')]
    useBuilderStore.getState().setNodes(original)
    useBuilderStore.getState().add(node('after'))
    const edited = useBuilderStore.getState().nodes
    const persistedPast = useBuilderStore.getState().past

    resetStore()
    useBuilderStore.getState().setNodes(edited)
    useBuilderStore.getState().setHistory({ past: persistedPast, future: [] })
    useBuilderStore.getState().undo()
    expect(useBuilderStore.getState().nodes).toEqual(original)

    const persistedFuture = useBuilderStore.getState().future
    resetStore()
    useBuilderStore.getState().setNodes(original)
    useBuilderStore.getState().setHistory({ past: [], future: persistedFuture })
    useBuilderStore.getState().redo()
    expect(useBuilderStore.getState().nodes).toEqual(edited)
  })

  it('drops malformed persisted history rather than applying an unsafe tree', () => {
    useBuilderStore.getState().setHistory({ past: [[node('bad id')]], future: [] })
    expect(useBuilderStore.getState().past).toEqual([])
    expect(useBuilderStore.getState().future).toEqual([])
  })
})

describe('builder store Phase 7 history and tree updates', () => {
  it('preserves valid selection for setNodes and supports explicit clearing', () => {
    useBuilderStore.getState().setNodes([node('a'), node('b')])
    useBuilderStore.getState().select('a')
    useBuilderStore.getState().setNodes([node('a'), node('b')])
    expect(useBuilderStore.getState().selectedId).toBe('a')
    expect(useBuilderStore.getState().selectedIds).toEqual(['a'])

    useBuilderStore.getState().setNodes([node('a'), node('b')], false, true)
    expect(useBuilderStore.getState().selectedId).toBeNull()
    expect(useBuilderStore.getState().selectedIds).toEqual([])
  })

  it('path-copies only the changed branch for text and style updates', () => {
    useBuilderStore.getState().setNodes([
      node('parent', [node('child'), node('untouched-child')]),
      node('sibling'),
    ])
    const before = useBuilderStore.getState().nodes
    const parentBefore = before[0]!
    const childBefore = parentBefore.children[0]!
    const untouchedChildBefore = parentBefore.children[1]!
    const siblingBefore = before[1]!

    useBuilderStore.getState().updateText('child', 'updated')
    const afterText = useBuilderStore.getState().nodes
    expect(useBuilderStore.getState().past[0]).toBe(before)
    expect(Object.isFrozen(afterText[1])).toBe(true)
    expect(afterText[0]).not.toBe(parentBefore)
    expect(afterText[0]!.children[0]).not.toBe(childBefore)
    expect(afterText[0]!.children[1]).toBe(untouchedChildBefore)
    expect(afterText[1]).toBe(siblingBefore)

    useBuilderStore.getState().updateStyle('child', { color: '#123456' })
    const afterStyle = useBuilderStore.getState().nodes
    expect(afterStyle[0]!.children[0]).not.toBe(afterText[0]!.children[0])
    expect(afterStyle[0]!.children[1]).toBe(untouchedChildBefore)
    expect(afterStyle[1]).toBe(siblingBefore)
  })

  it('does not create history for missing or no-op text and style updates', () => {
    useBuilderStore.getState().setNodes([node('a')])
    useBuilderStore.getState().updateText('missing', 'new')
    useBuilderStore.getState().updateText('a', 'a')
    useBuilderStore.getState().updateStyle('missing', { color: '#123456' })
    useBuilderStore.getState().updateStyle('a', {})
    useBuilderStore.getState().updateStyle('a', { color: undefined })
    expect(useBuilderStore.getState().past).toHaveLength(0)
  })

  it('keeps undo and redo snapshots correct and immutable across later edits', () => {
    useBuilderStore.getState().setNodes([node('a'), node('b')])
    useBuilderStore.getState().updateText('a', 'first')
    const firstPast = useBuilderStore.getState().past[0]!
    expect(Object.isFrozen(firstPast)).toBe(true)
    expect(Object.isFrozen(firstPast[0])).toBe(true)
    expect(firstPast[0]!.props.text).toBe('a')

    useBuilderStore.getState().updateText('a', 'second')
    expect(firstPast[0]!.props.text).toBe('a')
    expect(useBuilderStore.getState().past).toHaveLength(2)

    useBuilderStore.getState().undo()
    expect(useBuilderStore.getState().nodes[0]!.props.text).toBe('first')
    useBuilderStore.getState().undo()
    expect(useBuilderStore.getState().nodes[0]!.props.text).toBe('a')
    useBuilderStore.getState().redo()
    expect(useBuilderStore.getState().nodes[0]!.props.text).toBe('first')
    useBuilderStore.getState().redo()
    expect(useBuilderStore.getState().nodes[0]!.props.text).toBe('second')
  })
})
