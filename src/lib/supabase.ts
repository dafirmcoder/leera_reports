import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Vite always defines import.meta.env; fall back to {} when running in plain
// Node (e.g. tests) so this module can be imported outside the bundler.
const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {}
const url = env.VITE_SUPABASE_URL
const anonKey = env.VITE_SUPABASE_ANON_KEY

/** True when the app was built with Supabase credentials. */
export const isSupabaseConfigured = Boolean(url && anonKey)

/** The shared Supabase client, or null when not configured (demo mode). */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null
