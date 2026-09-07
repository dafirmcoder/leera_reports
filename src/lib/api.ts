import { isSupabaseConfigured } from './supabase'
import { supabaseApi } from './api.supabase'
import { demoApi } from './api.demo'
import type { Api } from './types'

/**
 * The active data-access layer.
 *  - Supabase configured  -> real backend
 *  - otherwise             -> demo mode (localStorage, seeded sample data)
 */
export const api: Api = isSupabaseConfigured ? supabaseApi : demoApi

export const isDemo = api.mode === 'demo'
