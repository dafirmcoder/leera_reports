import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = (
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
  ?? import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
)

/** True when the app was built with Supabase credentials. */
export const isSupabaseConfigured = Boolean(url && anonKey)

/** The shared Supabase client, or null when not configured (demo mode). */
export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(url as string, anonKey as string)
  : null
