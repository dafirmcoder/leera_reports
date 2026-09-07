import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  getInitialUser, signIn as apiSignIn, signUp as apiSignUp, signOut as apiSignOut,
  onAuthChange, emitDemoAuthChange, type AuthUser
} from '../lib/auth'
import { api } from '../lib/api'
import type { Profile } from '../lib/types'

interface AuthState {
  user: AuthUser | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signIn: (email: string, password: string) => Promise<{ error?: string }>
  signUp: (email: string, password: string, fullName: string) => Promise<{ error?: string; needsConfirmation?: boolean }>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  const loadProfile = async () => {
    try {
      setProfile(await api.getProfile())
    } catch {
      setProfile(null)
    }
  }

  useEffect(() => {
    let active = true
    getInitialUser().then(async (u) => {
      if (!active) return
      setUser(u)
      if (u) {
        const p = await api.getProfile().catch(() => null)
        if (active) setProfile(p)
      } else {
        setProfile(null)
      }
      if (active) setLoading(false)
    })
    const unsub = onAuthChange(async (u) => {
      if (!active) return
      setUser(u)
      setProfile(u ? await api.getProfile().catch(() => null) : null)
    })
    return () => {
      active = false
      unsub()
    }
  }, [])

  const signIn = async (email: string, password: string) => {
    const res = await apiSignIn(email, password)
    if (!res.error) {
      if (api.mode === 'demo') emitDemoAuthChange()
      await loadProfile()
    }
    return res
  }

  const signUp = async (email: string, password: string, fullName: string) => {
    const res = await apiSignUp(email, password, fullName)
    if (!res.error && api.mode === 'demo') {
      emitDemoAuthChange()
      await loadProfile()
    }
    return res
  }

  const signOut = async () => {
    await apiSignOut()
    if (api.mode === 'demo') emitDemoAuthChange()
    setUser(null)
    setProfile(null)
  }

  return (
    <AuthContext.Provider
      value={{ user, profile, loading, refreshProfile: loadProfile, signIn, signUp, signOut }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
