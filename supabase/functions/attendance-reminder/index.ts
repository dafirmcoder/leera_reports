// Supabase Edge Function: Morning & Repetitive Attendance Reminder for Homeroom Teachers.
// Can be scheduled with pg_cron or Supabase Cron (e.g. at 05:00 UTC = 08:00 AM EAT Mon-Fri).
// Deploy with: supabase functions deploy attendance-reminder

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type'
}

const VAPID_PUBLIC_KEY = Deno.env.get('VAPID_PUBLIC_KEY') || 'BIdY_x0ofg0Ani-vbOnuuIcd4Y88gTLynWJoUZzqq-ftqRCGv8Y-EkmgGHLaSiPsC5f_0X91eWfBKeg-0imMIlo'
const VAPID_PRIVATE_KEY = Deno.env.get('VAPID_PRIVATE_KEY') || '-ftJPnNMuKix3fP-ugq4kQm2HdZqYigsDp9hBJpne8g'
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') || 'mailto:admin@leeraschool.ac.tz'

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
        vibrate: [300, 100, 300, 100, 300],
        tag: 'attendance-reminder',
        requireInteraction: true,
        data: { url: '/attendance' }
      })

      for (const sub of teacherSubs) {
        try {
          await webpush.sendNotification({
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          }, payload)
          sentCount++
        } catch (e: any) {
          if (e.statusCode === 404 || e.statusCode === 410) {
            await admin.from('push_subscriptions').delete().eq('endpoint', sub.endpoint)
          }
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
