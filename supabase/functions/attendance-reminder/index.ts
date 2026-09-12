// Supabase Edge Function: Morning & Repetitive Attendance Reminder for Homeroom Teachers.
// Can be scheduled with pg_cron or Supabase Cron (e.g. at 05:00 UTC = 08:00 AM EAT Mon-Fri).
// Deploy with: supabase functions deploy attendance-reminder

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

    // Find homeroom teachers whose classes have NOT marked attendance today
    const { data: unmarked, error: rpcErr } = await admin.rpc('get_unmarked_homeroom_teachers')
    if (rpcErr) throw rpcErr

    const teachers = unmarked ?? []
    if (teachers.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0, message: 'All homerooms have marked attendance today.' }), {
        headers: { ...cors, 'Content-Type': 'application/json' }
      })
    }

    const userIds = teachers.map((t: any) => t.user_id)
    const { data: subs, error: sErr } = await admin
      .from('push_subscriptions')
      .select('*')
      .in('user_id', userIds)

    if (sErr) throw sErr

    let sentCount = 0
    for (const teacher of teachers) {
      const teacherSubs = (subs ?? []).filter((s: any) => s.user_id === teacher.user_id)
      const payload = JSON.stringify({
        title: '⏰ Homeroom Attendance Reminder',
        body: `Good morning ${teacher.teacher_name}! Attendance for ${teacher.class_name} is pending. Please remember to submit it today.`,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        data: { url: '/attendance' }
      })

      for (const sub of teacherSubs) {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          }, payload)
          sentCount++
        } catch (e) {
          console.warn('Failed to send push to teacher:', sub.endpoint, e)
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: sentCount, unmarkedCount: teachers.length }), {
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Reminder dispatch failed' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' }
    })
  }
})
