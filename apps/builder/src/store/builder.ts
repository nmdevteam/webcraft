import { create } from 'zustand'
import { PageUndoHistorySchema, validateTree, type BuilderNode, type NodeStyle } from '@webcraft/core/schema'

type BuilderState = {
  nodes: BuilderNode[]
  selectedId: string | null
  selectedIds: string[]
  past: BuilderNode[][]
  future: BuilderNode[][]
  /** The optional third argument clears selection for an explicit page-load/page-switch reset. */
  setNodes: (nodes: BuilderNode[], remember?: boolean, clearSelection?: boolean) => void
  setHistory: (history: unknown) => void
  select: (id: string | null, additive?: boolean) => void
  updateText: (id: string, text: string) => void
  updateStyle: (id: string, style: Partial<NodeStyle>) => void
  add: (node: BuilderNode) => void
  insertMany: (nodes: BuilderNode[]) => boolean
  remove: (id: string) => void
  removeMany: (ids: string[]) => boolean
  duplicate: (id: string) => void
  duplicateMany: (ids: string[]) => boolean
  reorder: (from: number, to: number) => void
  undo: () => void
  redo: () => void
}

function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child)
  }
  return value
}

/** Validation creates a detached tree; freezing makes history snapshots immutable. */
const snapshot = (nodes: BuilderNode[]) => freeze(validateTree(nodes))

function transform(nodes: BuilderNode[], id: string, fn: (node: BuilderNode) => BuilderNode): { nodes: BuilderNode[]; changed: boolean } {
  let changed = false
  const next = nodes.map((node) => {
    if (node.id === id) {
      const replacement = fn(node)
      changed ||= replacement !== node
      return replacement
    }
    const children = transform(node.children, id, fn)
    if (!children.changed) return node
    changed = true
    return { ...node, children: children.nodes }
  })
  return { nodes: changed ? next : nodes, changed }
}

export function getTopLevelSelectedNodes(nodes: BuilderNode[], ids: string[]): BuilderNode[] {
  const selected = new Set(ids)
  const result: BuilderNode[] = []
  const visit = (items: BuilderNode[]) => {
    for (const node of items) {
      if (selected.has(node.id)) result.push(node)
      else visit(node.children)
    }
  }
  visit(nodes)
  return result
}

function cloneWithNewIds(node: BuilderNode): BuilderNode {
  return { ...structuredClone(node), id: crypto.randomUUID().replace(/-/g, ''), children: node.children.map(cloneWithNewIds) }
}

function selectionFor(nodes: BuilderNode[], selectedIds: string[], selectedId: string | null) {
  const available = new Set<string>()
  const visit = (items: BuilderNode[]) => items.forEach((node) => { available.add(node.id); visit(node.children) })
  visit(nodes)
  const nextIds = selectedIds.filter((id) => available.has(id))
  return { selectedIds: nextIds, selectedId: selectedId && nextIds.includes(selectedId) ? selectedId : nextIds.at(-1) ?? null }
}

const clearSelection = { selectedId: null, selectedIds: [] }
// Snapshots share frozen subtrees with the live tree; every store update path-copies and never mutates nodes.
const historyPast = (past: BuilderNode[][], nodes: BuilderNode[]) => [...past, freeze(nodes)].slice(-40)

export const useBuilderStore = create<BuilderState>((set, get) => ({
  nodes: [], selectedId: null, selectedIds: [], past: [], future: [],
  setNodes: (nodes, remember = false, shouldClearSelection = false) => {
    const safe = validateTree(nodes)
    set((state) => ({
      nodes: safe,
      ...(shouldClearSelection ? clearSelection : selectionFor(safe, state.selectedIds, state.selectedId)),
      past: remember ? historyPast(state.past, state.nodes) : state.past,
      future: remember ? [] : state.future,
    }))
  },
  setHistory: (history) => {
    const parsed = PageUndoHistorySchema.safeParse(history ?? {})
    set({
      past: parsed.success ? parsed.data.past.map((nodes) => snapshot(nodes)) : [],
      future: parsed.success ? parsed.data.future.map((nodes) => snapshot(nodes)) : [],
    })
  },
  select: (id, additive = false) => {
    if (!id) { set(clearSelection); return }
    const state = get()
    if (!additive) { set({ selectedId: id, selectedIds: [id] }); return }
    const selectedIds = state.selectedIds
    if (selectedIds.includes(id)) {
      const nextIds = selectedIds.filter((selected) => selected !== id)
      set({ selectedIds: nextIds, selectedId: state.selectedId === id ? nextIds.at(-1) ?? null : state.selectedId })
    } else {
      set({ selectedIds: [...selectedIds, id], selectedId: id })
    }
  },
  updateText: (id, text) => {
    if (text.length > 2000) return
    const state = get()
    const result = transform(state.nodes, id, (node) => node.props.text === text ? node : { ...node, props: { ...node.props, text } })
    if (!result.changed) return
    set({ nodes: result.nodes, past: historyPast(state.past, state.nodes), future: [] })
  },
  updateStyle: (id, style) => {
    const state = get()
    const result = transform(state.nodes, id, (node) => {
      const changed = Object.keys(style).some((key) => node.style[key as keyof NodeStyle] !== style[key as keyof NodeStyle])
      return changed ? { ...node, style: { ...node.style, ...style } } : node
    })
    if (!result.changed) return
    set({ nodes: result.nodes, past: historyPast(state.past, state.nodes), future: [] })
  },
  add: (node) => { const state = get(); set({ nodes: validateTree([...state.nodes, node]), selectedId: node.id, selectedIds: [node.id], past: historyPast(state.past, state.nodes), future: [] }) },
  insertMany: (nodes) => {
    const state = get()
    if (!nodes.length) return false
    try {
      const safeInput = validateTree(nodes)
      const copies = safeInput.map(cloneWithNewIds)
      const next = validateTree([...state.nodes, ...copies])
      set({ nodes: next, selectedIds: copies.map((node) => node.id), selectedId: copies.at(-1)?.id ?? null, past: historyPast(state.past, state.nodes), future: [] })
      return true
    } catch { return false }
  },
  remove: (id) => { get().removeMany([id]) },
  removeMany: (ids) => {
    const state = get()
    const roots = getTopLevelSelectedNodes(state.nodes, ids)
    if (!roots.length) return false
    const removeIds = new Set(roots.map((node) => node.id))
    const strip = (nodes: BuilderNode[]): BuilderNode[] => {
      let changed = false
      const next = nodes.filter((node) => { const keep = !removeIds.has(node.id); changed ||= !keep; return keep }).map((node) => {
        const children = strip(node.children)
        if (children === node.children) return node
        changed = true
        return { ...node, children }
      })
      return changed ? next : nodes
    }
    set({ nodes: strip(state.nodes), ...clearSelection, past: historyPast(state.past, state.nodes), future: [] })
    return true
  },
  duplicate: (id) => { get().duplicateMany([id]) },
  duplicateMany: (ids) => {
    const state = get()
    const roots = getTopLevelSelectedNodes(state.nodes, ids)
    if (!roots.length) return false
    const rootIds = new Set(roots.map((node) => node.id))
    const duplicateIds: string[] = []
    const insertAfterSelected = (items: BuilderNode[]): BuilderNode[] => {
      const next: BuilderNode[] = []
      for (const node of items) {
        next.push({ ...node, children: insertAfterSelected(node.children) })
        if (rootIds.has(node.id)) {
          const copy = cloneWithNewIds(node)
          duplicateIds.push(copy.id)
          next.push(copy)
        }
      }
      return next
    }
    try {
      const next = validateTree(insertAfterSelected(state.nodes))
      set({ nodes: next, selectedIds: duplicateIds, selectedId: duplicateIds.at(-1) ?? null, past: historyPast(state.past, state.nodes), future: [] })
      return true
    } catch { return false }
  },
  reorder: (from, to) => { const state = get(); if (from === to || from < 0 || to < 0 || from >= state.nodes.length || to >= state.nodes.length) return; const next = [...state.nodes]; const [item] = next.splice(from, 1); next.splice(to, 0, item!); set({ nodes: next, past: historyPast(state.past, state.nodes), future: [] }) },
  undo: () => { const state = get(); const previous = state.past.at(-1); if (!previous) return; set({ nodes: previous, ...selectionFor(previous, state.selectedIds, state.selectedId), past: state.past.slice(0, -1), future: [freeze(state.nodes), ...state.future] }) },
  redo: () => { const state = get(); const next = state.future[0]; if (!next) return; set({ nodes: next, ...selectionFor(next, state.selectedIds, state.selectedId), past: [...state.past, freeze(state.nodes)].slice(-40), future: state.future.slice(1) }) },
}))
