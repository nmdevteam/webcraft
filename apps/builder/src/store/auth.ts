import { create } from 'zustand'
import type { User } from '../api'

type AuthState = { user: User | null; token: string | null; setSession: (token: string, user: User) => void; clear: () => void }
export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  token: sessionStorage.getItem('webcraft-session'),
  setSession: (token, user) => { sessionStorage.setItem('webcraft-session', token); set({ token, user }) },
  clear: () => { sessionStorage.removeItem('webcraft-session'); set({ token: null, user: null }) },
}))
