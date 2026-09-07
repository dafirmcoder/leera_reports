import { supabase, isSupabaseConfigured } from './supabase'

export interface AuthUser {
  id: string
  email: string
}

const DEMO_KEY = 'leera_demo_user'

export function isDemoMode(): boolean {
  return !isSupabaseConfigured
}

export async function getInitialUser(): Promise<AuthUser | null> {
  if (isSupabaseConfigured) {
    const { data } = await supabase!.auth.getSession()
    const u = data.session?.user
    return u ? { id: u.id, email: u.email ?? '' } : null
  }
  const raw = localStorage.getItem(DEMO_KEY)
  return raw ? (JSON.parse(raw) as AuthUser) : null
}

export async function signIn(email: string, password: string): Promise<{ error?: string }> {
  if (isSupabaseConfigured) {
    const { error } = await supabase!.auth.signInWithPassword({ email, password })
    return error ? { error: error.message } : {}
  }
  // Demo: sign in as a persona by email.
  const ok = demoSignInAs(email)
  if (!ok) return { error: 'Unknown demo account. Use one of the quick sign-in buttons.' }
  return {}
}

export async function signUp(email: string, password: string, fullName: string): Promise<{ error?: string; needsConfirmation?: boolean }> {
  if (isSupabaseConfigured) {
    const { data, error } = await supabase!.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } }
    })
    if (error) return { error: error.message }
    if (!data.session) return { needsConfirmation: true }
    return {}
  }
  if (!email || !password) return { error: 'Enter an email and password.' }
  demoSignInAs(email)
  return {}
}

export async function signOut(): Promise<void> {
  if (isSupabaseConfigured) {
    await supabase!.auth.signOut()
  } else {
    localStorage.removeItem(DEMO_KEY)
  }
}

export function onAuthChange(cb: (user: AuthUser | null) => void): () => void {
  if (isSupabaseConfigured) {
    const { data } = supabase!.auth.onAuthStateChange((_event, session) => {
      cb(session?.user ? { id: session.user.id, email: session.user.email ?? '' } : null)
    })
    return () => data.subscription.unsubscribe()
  }
  const listener = () => {
    const raw = localStorage.getItem(DEMO_KEY)
    cb(raw ? (JSON.parse(raw) as AuthUser) : null)
  }
  window.addEventListener('leera-demo-auth', listener)
  return () => window.removeEventListener('leera-demo-auth', listener)
}

export function emitDemoAuthChange(): void {
  window.dispatchEvent(new Event('leera-demo-auth'))
}

// ---- demo personas ---------------------------------------------------------
export const DEMO_PERSONAS = [
  { email: 'director@leera.school', label: 'Director', hint: 'Read-only, whole school' },
  { email: 'hos@leera.school', label: 'Head of School', hint: 'Users, roles, settings' },
  { email: 'coordinator@leera.school', label: 'Curriculum Coordinator', hint: 'Assign roles' },
  { email: 'homeroom@leera.school', label: 'Homeroom Teacher', hint: 'Year 8 — own class' },
  { email: 'teacher@leera.school', label: 'Subject Teacher', hint: 'Maths (Y8) & Science (Y9)' }
]

function demoSignInAs(email: string): boolean {
  const known = DEMO_PERSONAS.some((p) => p.email === email)
  if (!known) return false
  localStorage.setItem(DEMO_KEY, JSON.stringify({ id: email, email }))
  return true
}
