import type { BuilderNode } from '@webcraft/core/schema'

type Draft = { pageId: string; nodes: BuilderNode[]; revision: number; savedAt: number }
const DB_NAME = 'webcraft-recovery-v1'
const STORE_NAME = 'drafts'
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'pageId' }) }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
export async function saveDraft(draft: Draft) {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).put(draft); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
  db.close()
}
export async function getDraft(pageId: string): Promise<Draft | undefined> {
  const db = await openDB()
  const value = await new Promise<Draft | undefined>((resolve, reject) => { const request = db.transaction(STORE_NAME).objectStore(STORE_NAME).get(pageId); request.onsuccess = () => resolve(request.result as Draft | undefined); request.onerror = () => reject(request.error) })
  db.close(); return value
}
export async function deleteDraft(pageId: string) {
  const db = await openDB()
  await new Promise<void>((resolve, reject) => { const tx = db.transaction(STORE_NAME, 'readwrite'); tx.objectStore(STORE_NAME).delete(pageId); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
  db.close()
}
