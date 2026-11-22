import { create } from 'zustand'
import { validateTree, type BuilderNode, type NodeStyle } from '@webcraft/core/schema'

type BuilderState = {
  nodes: BuilderNode[]
  selectedId: string | null
  selectedIds: string[]
  past: BuilderNode[][]
  future: BuilderNode[][]
  setNodes: (nodes: BuilderNode[], remember?: boolean) => void
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

const clone = (nodes: BuilderNode[]) => structuredClone(nodes)
const transform = (nodes: BuilderNode[], id: string, fn: (node: BuilderNode) => BuilderNode): BuilderNode[] => nodes.map((node) => node.id === id ? fn(node) : { ...node, children: transform(node.children, id, fn) })

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

export const useBuilderStore = create<BuilderState>((set, get) => ({
  nodes: [], selectedId: null, selectedIds: [], past: [], future: [],
  setNodes: (nodes, remember = false) => {
    const safe = validateTree(nodes)
    set((state) => ({ nodes: safe, selectedId: null, selectedIds: [], past: remember ? [...state.past, clone(state.nodes)].slice(-40) : state.past, future: remember ? [] : state.future }))
  },
  select: (id, additive = false) => {
    if (!id) { set({ selectedId: null, selectedIds: [] }); return }
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
  updateText: (id, text) => { if (text.length > 2000) return; const state = get(); set({ nodes: transform(state.nodes, id, (node) => ({ ...node, props: { ...node.props, text } })), past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  updateStyle: (id, style) => { const state = get(); set({ nodes: transform(state.nodes, id, (node) => ({ ...node, style: { ...node.style, ...style } })), past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  add: (node) => { const state = get(); set({ nodes: validateTree([...state.nodes, node]), selectedId: node.id, selectedIds: [node.id], past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  insertMany: (nodes) => {
    const state = get()
    if (!nodes.length) return false
    try {
      const safeInput = validateTree(nodes)
      const copies = safeInput.map(cloneWithNewIds)
      const next = validateTree([...state.nodes, ...copies])
      set({ nodes: next, selectedIds: copies.map((node) => node.id), selectedId: copies.at(-1)?.id ?? null, past: [...state.past, clone(state.nodes)].slice(-40), future: [] })
      return true
    } catch { return false }
  },
  remove: (id) => { get().removeMany([id]) },
  removeMany: (ids) => {
    const state = get()
    const roots = getTopLevelSelectedNodes(state.nodes, ids)
    if (!roots.length) return false
    const removeIds = new Set(roots.map((node) => node.id))
    const strip = (nodes: BuilderNode[]): BuilderNode[] => nodes.filter((node) => !removeIds.has(node.id)).map((node) => ({ ...node, children: strip(node.children) }))
    set({ nodes: strip(state.nodes), selectedId: null, selectedIds: [], past: [...state.past, clone(state.nodes)].slice(-40), future: [] })
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
      set({ nodes: next, selectedIds: duplicateIds, selectedId: duplicateIds.at(-1) ?? null, past: [...state.past, clone(state.nodes)].slice(-40), future: [] })
      return true
    } catch { return false }
  },
  reorder: (from, to) => { const state = get(); if (from === to || from < 0 || to < 0 || from >= state.nodes.length || to >= state.nodes.length) return; const next = [...state.nodes]; const [item] = next.splice(from, 1); next.splice(to, 0, item!); set({ nodes: next, past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  undo: () => { const state = get(); const previous = state.past.at(-1); if (!previous) return; set({ nodes: previous, ...selectionFor(previous, state.selectedIds, state.selectedId), past: state.past.slice(0, -1), future: [clone(state.nodes), ...state.future] }) },
  redo: () => { const state = get(); const next = state.future[0]; if (!next) return; set({ nodes: next, ...selectionFor(next, state.selectedIds, state.selectedId), past: [...state.past, clone(state.nodes)].slice(-40), future: state.future.slice(1) }) },
}))
