// Supabase Edge Function: invite a teacher and pre-assign their role.
//
// Deploy with:  supabase functions deploy invite-user
// Requires SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL secrets (set automatically
// by `supabase secrets set` or via the dashboard).
//
// Only a Head of School may call it. The invited user gets a profile row with
// the chosen role immediately (they still need to accept the email invitation).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const authHeader = req.headers.get('Authorization') ?? ''
    const token = authHeader.replace('Bearer ', '')
    if (!token) throw new Error('Missing auth token')

    const body = await req.json()
    const { email, full_name, role, class_id } = body

    if (!email || !full_name) throw new Error('email and full_name are required')

    // Service-role client (bypasses RLS).
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    // Identify + authorize the caller.
    const { data: caller, error: callerErr } = await admin.auth.getUser(token)
    if (callerErr || !caller.user) throw new Error('Unauthorized')

    const { data: callerProfile } = await admin
      .from('profiles').select('role, school_id').eq('id', caller.user.id).single()

    if (callerProfile?.role !== 'head_of_school' || !callerProfile.school_id) {
      throw new Error('Only the Head of School can invite teachers')
    }

    // Create the auth user (invitation email).
    const { data: invited, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name },
      redirectTo: url
    })
    if (inviteErr) throw inviteErr

    // Pre-assign the role + school on their profile (the auth trigger will
    // skip the insert because we upsert here first).
    const { error: profileErr } = await admin.from('profiles').upsert(
      {
        id: invited.user.id,
        email,
        full_name,
        role: role || 'pending',
        school_id: callerProfile.school_id,
        class_id: class_id || null
      },
      { onConflict: 'id' }
    )
    if (profileErr) throw profileErr

    return new Response(JSON.stringify({ ok: true, user_id: invited.user.id }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e.message ?? 'Invite failed' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
