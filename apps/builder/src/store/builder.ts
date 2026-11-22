import { create } from 'zustand'
import { validateTree, type BuilderNode, type NodeStyle } from '@webcraft/core/schema'

type BuilderState = {
  nodes: BuilderNode[]
  selectedId: string | null
  past: BuilderNode[][]
  future: BuilderNode[][]
  setNodes: (nodes: BuilderNode[], remember?: boolean) => void
  select: (id: string | null) => void
  updateText: (id: string, text: string) => void
  updateStyle: (id: string, style: Partial<NodeStyle>) => void
  add: (node: BuilderNode) => void
  remove: (id: string) => void
  duplicate: (id: string) => void
  reorder: (from: number, to: number) => void
  undo: () => void
  redo: () => void
}
const clone = (nodes: BuilderNode[]) => structuredClone(nodes)
const transform = (nodes: BuilderNode[], id: string, fn: (node: BuilderNode) => BuilderNode): BuilderNode[] => nodes.map((node) => node.id === id ? fn(node) : { ...node, children: transform(node.children, id, fn) })
export const useBuilderStore = create<BuilderState>((set, get) => ({
  nodes: [], selectedId: null, past: [], future: [],
  setNodes: (nodes, remember = false) => { const safe = validateTree(nodes); set((state) => ({ nodes: safe, selectedId: null, past: remember ? [...state.past, clone(state.nodes)].slice(-40) : state.past, future: remember ? [] : state.future })) },
  select: (id) => set({ selectedId: id }),
  updateText: (id, text) => { if (text.length > 2000) return; const state = get(); set({ nodes: transform(state.nodes, id, (node) => ({ ...node, props: { ...node.props, text } })), past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  updateStyle: (id, style) => { const state = get(); set({ nodes: transform(state.nodes, id, (node) => ({ ...node, style: { ...node.style, ...style } })), past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  add: (node) => { const state = get(); set({ nodes: validateTree([...state.nodes, node]), selectedId: node.id, past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  remove: (id) => { const state = get(); const strip = (nodes: BuilderNode[]): BuilderNode[] => nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: strip(n.children) })); set({ nodes: strip(state.nodes), selectedId: null, past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  duplicate: (id) => { const state = get(); const copyNode = (n: BuilderNode): BuilderNode => ({ ...structuredClone(n), id: crypto.randomUUID().replace(/-/g, ''), children: n.children.map(copyNode) }); const duplicateFrom = (nodes: BuilderNode[]): BuilderNode[] => { const result: BuilderNode[] = []; for (const n of nodes) { result.push(n); if (n.id === id) result.push(copyNode(n)); else result[result.length - 1] = { ...n, children: duplicateFrom(n.children) } } return result }; set({ nodes: validateTree(duplicateFrom(state.nodes)), past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  reorder: (from, to) => { const state = get(); if (from === to || from < 0 || to < 0 || from >= state.nodes.length || to >= state.nodes.length) return; const next = [...state.nodes]; const [item] = next.splice(from, 1); next.splice(to, 0, item!); set({ nodes: next, past: [...state.past, clone(state.nodes)].slice(-40), future: [] }) },
  undo: () => { const state = get(); const previous = state.past.at(-1); if (!previous) return; set({ nodes: previous, past: state.past.slice(0, -1), future: [clone(state.nodes), ...state.future] }) },
  redo: () => { const state = get(); const next = state.future[0]; if (!next) return; set({ nodes: next, past: [...state.past, clone(state.nodes)].slice(-40), future: state.future.slice(1) }) },
}))
