import { create } from 'zustand'
import { SESSION_CHANGED_EVENT, type User } from '../api'

type AuthState = { user: User | null; token: string | null; setSession: (token: string, user: User) => void; clear: () => void }
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: sessionStorage.getItem('webcraft-session'),
  setSession: (token, user) => { sessionStorage.setItem('webcraft-session', token); set({ token, user }); window.dispatchEvent(new Event(SESSION_CHANGED_EVENT)) },
  clear: () => { sessionStorage.removeItem('webcraft-session'); set({ token: null, user: null }); window.dispatchEvent(new Event(SESSION_CHANGED_EVENT)) },
}))
