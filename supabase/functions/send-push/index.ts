// Supabase Edge Function: Send Web Push notifications to specific roles or users.
// Deploy with: supabase functions deploy send-push

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || 'BKd_9F-f3qZ_p2d6s5U5Q0Wp_0s9M4Y6A1v7H2X3k8N9L4P7q2R5t8V1w4Z7C0b3E6g9J2m5P8s1V4y7B0d3'
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || 'd_5F-x8Z_q2r6s5U5Q0Wp_0s9M4Y6A1v7H2X3k8N9L4'
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:info@leeraschool.ac.tz'

try {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY)
} catch (e) {
  console.warn('VAPID init:', e)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }

  try {
    const url = Deno.env.get('SUPABASE_URL')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })

    const { targetRoles, targetUserIds, title, body, url: targetUrl, icon } = await req.json()

    let userIds: string[] = targetUserIds || []

    if (targetRoles && targetRoles.length > 0) {
      // Find users having role or in additional_roles
      const { data: profiles, error: pErr } = await admin
        .from('profiles')
        .select('id, role, additional_roles')
      if (pErr) throw pErr

      const roleSet = new Set(targetRoles)
      const matching = (profiles ?? []).filter((p: any) =>
        roleSet.has(p.role) || (p.additional_roles && p.additional_roles.some((r: string) => roleSet.has(r)))
      )
      userIds = Array.from(new Set([...userIds, ...matching.map((p: any) => p.id)]))
    }

    if (userIds.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: 'No target users found' }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    // Fetch active push subscriptions for these users
    const { data: subs, error: sErr } = await admin
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds)

    if (sErr) throw sErr

    const payload = JSON.stringify({
      title: title || 'Leera Reports',
      body: body || 'You have an update from Leera Reports.',
      icon: icon || '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url: targetUrl || '/' }
    })

    const results = await Promise.allSettled(
      (subs ?? []).map(async (sub: any) => {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        }
        return webpush.sendNotification(pushSubscription, payload)
      })
    )

    const sentCount = results.filter((r) => r.status === 'fulfilled').length
    const failedCount = results.filter((r) => r.status === 'rejected').length

    return new Response(JSON.stringify({ ok: true, sent: sentCount, failed: failedCount }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Push dispatch failed' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
