import { supabase } from './supabase'

export interface AuthUser {
  id: string
  email: string
}

export function isDemoMode(): boolean {
  return false
}

export async function getInitialUser(): Promise<AuthUser | null> {
  const { data } = await supabase.auth.getSession()
  const u = data.session?.user
  return u ? { id: u.id, email: u.email ?? '' } : null
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signInWithPassword({ email, password })
  return error ? { error: error.message } : {}
}

export async function signUp(email: string, password: string, fullName: string): Promise<{ error?: string; needsConfirmation?: boolean }> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } }
  })
  if (error) return { error: error.message }
  if (!data.session) return { needsConfirmation: true }
  return {}
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut()
}

export async function updatePassword(currentPassword: string, password: string): Promise<{ error?: string }> {
  const { data: sessionData } = await supabase.auth.getSession()
  const email = sessionData.session?.user.email
  if (!email) return { error: 'Your session has expired. Please sign in again.' }
  const { error: reauthError } = await supabase.auth.signInWithPassword({ email, password: currentPassword })
  if (reauthError) return { error: 'Current password is incorrect.' }
  const { error } = await supabase.auth.updateUser({ password })
  return error ? { error: error.message } : {}
}

export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  const { data } = supabase.auth.onAuthStateChange((_event, session) => {
    cb(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null)
  })
  return () => data.subscription.unsubscribe()
}

