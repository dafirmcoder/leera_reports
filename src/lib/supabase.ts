import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const env = (import.meta as unknown as { env?: Record<string, string> }).env ?? {}
const url = env.VITE_SUPABASE_URL || env.SUPABASE_URL || ''
const anonKey = env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || ''

export const isSupabaseConfigured = Boolean(url && anonKey)

export const supabase: SupabaseClient = createClient(url || 'https://placeholder.supabase.co', anonKey || 'placeholder')

