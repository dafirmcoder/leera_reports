import { supabase } from './supabase'
import type { Profile } from './types'

const VAPID_PUBLIC_KEY = (import.meta as any).env?.VITE_VAPID_PUBLIC_KEY
  || 'BIdY_x0ofg0Ani-vbOnuuIcd4Y88gTLynWJoUZzqq-ftqRCGv8Y-EkmgGHLaSiPsC5f_0X91eWfBKeg-0imMIlo'

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  if (!isNotificationSupported()) return 'unsupported'
  return Notification.permission
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied'
  const permission = await Notification.requestPermission()
  return permission
}

export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.ready
  } catch {
    return null
  }
}

export async function registerDevicePushSubscription(userId: string): Promise<boolean> {
  if (!isNotificationSupported()) return false
  const reg = await getServiceWorkerRegistration()
  if (!reg || !('pushManager' in reg)) return false

  try {
    const convertedVapidKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
    let sub = await reg.pushManager.getSubscription()

    // If an existing subscription has an outdated/mismatched key, unsubscribe first
    if (sub) {
      try {
        const rawAppKey = sub.options.applicationServerKey
        const existingKeyBytes = rawAppKey ? new Uint8Array(rawAppKey) : null
        let keysMatch = false
        if (existingKeyBytes && existingKeyBytes.length === convertedVapidKey.length) {
          keysMatch = existingKeyBytes.every((val, i) => val === convertedVapidKey[i])
        }
        if (!keysMatch) {
          await sub.unsubscribe()
          sub = null
        }
      } catch {
        if (sub) {
          await sub.unsubscribe().catch(() => {})
        }
        sub = null
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: convertedVapidKey
      })
    }

    if (!sub) return false

    const subJson = sub.toJSON()
    const endpoint = subJson.endpoint ?? sub.endpoint
    const p256dh = subJson.keys?.p256dh ?? ''
    const auth = subJson.keys?.auth ?? ''

    if (!endpoint || !p256dh || !auth) {
      console.warn('Incomplete push keys from browser PushManager')
      return false
    }

    // Save to Supabase push_subscriptions
    const { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      endpoint,
      p256dh,
      auth,
      user_agent: navigator.userAgent,
      updated_at: new Date().toISOString()
    }, { onConflict: 'endpoint' })

    if (error) {
      console.warn('Failed to save push subscription to database:', error.message)
      return false
    }
    return true
  } catch (err) {
    console.error('Push subscription failed:', err)
    return false
  }
}

export async function unregisterDevicePushSubscription(userId: string): Promise<void> {
  const reg = await getServiceWorkerRegistration()
  if (!reg || !('pushManager' in reg)) return

  try {
    const sub = await reg.pushManager.getSubscription()
    if (sub) {
      await sub.unsubscribe()
      await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', sub.endpoint)
    }
  } catch (err) {
    console.warn('Unsubscribe error:', err)
  }
}

export async function showSystemNotification(title: string, options?: NotificationOptions & { url?: string }) {
  if (!isNotificationSupported() || Notification.permission !== 'granted') return

  const defaultOptions: any = {
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    vibrate: [200, 100, 200],
    ...options
  }

  const reg = await getServiceWorkerRegistration()
  if (reg && 'showNotification' in reg) {
    await reg.showNotification(title, defaultOptions)
  } else {
    new Notification(title, defaultOptions)
  }
}

// ---------------------------------------------------------------------------
// Real-time Event Dispatcher (when attendance is marked)
// ---------------------------------------------------------------------------

export async function notifyLeadershipOnAttendance(className: string, teacherName: string, present: number, absent: number, excused: number) {
  const title = `📅 Attendance Marked: ${className}`
  const body = `${teacherName} marked attendance: ${present} Present, ${absent} Absent, ${excused} Excused.`

  // 1. Show local notification if user has permission
  showSystemNotification(title, {
    body,
    tag: `att-${className}-${new Date().toISOString().slice(0, 10)}`,
    data: { url: '/dashboard' }
  })

  // 2. Call Edge Function to broadcast to all leadership phones / devices
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const token = session?.access_token
    if (token) {
      const url = (import.meta as any).env.VITE_SUPABASE_URL as string
      fetch(`${url}/functions/v1/send-push`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          targetRoles: ['director', 'head_of_school', 'curriculum_coordinator', 'admin'],
          title,
          body,
          url: '/dashboard'
        })
      }).catch((e) => console.warn('Push broadcast error:', e))
    }
  } catch (e) {
    console.warn('Push dispatch error:', e)
  }
}

// ---------------------------------------------------------------------------
// Client-Side Repetitive Attendance Reminder Watcher for Homeroom Teachers
// Runs periodically (e.g. every 15-30 min) during school hours (08:00 - 17:00 Mon-Fri)
// until today's attendance is marked.
// ---------------------------------------------------------------------------

let watcherInterval: number | null = null

export function startAttendanceReminderWatcher(profile: Profile | null) {
  if (watcherInterval) clearInterval(watcherInterval)
  if (!profile || !profile.class_id) return
  if (profile.role !== 'homeroom_teacher' && !profile.additional_roles?.includes('homeroom_teacher')) return

  const checkAndRemind = async () => {
    const now = new Date()
    const dayOfWeek = now.getDay() // 0 = Sun, 1 = Mon, ... 5 = Fri, 6 = Sat
    const hour = now.getHours()

    // Run only Monday to Friday between 8:00 AM and 17:00 PM
    if (dayOfWeek === 0 || dayOfWeek === 6) return
    if (hour < 8 || hour >= 17) return

    const todayStr = now.toISOString().slice(0, 10)

    try {
      // Check if attendance for this homeroom class is already marked today
      const { data, error } = await supabase
        .from('attendance')
        .select('id')
        .eq('class_id', profile.class_id)
        .eq('attendance_date', todayStr)
        .limit(1)

      if (error) return

      // If no attendance records exist for today, send repetitive reminder
      if (!data || data.length === 0) {
        showSystemNotification('⏰ Homeroom Attendance Reminder', {
          body: 'Good morning! Please remember to mark attendance for your homeroom class today. (Reminders repeat until marked)',
          tag: `reminder-${todayStr}`,
          data: { url: '/attendance' }
        })
      }
    } catch {
      // Non-blocking
    }
  }

  // Check immediately, then every 30 minutes
  checkAndRemind()
  watcherInterval = window.setInterval(checkAndRemind, 30 * 60 * 1000)
}

export function stopAttendanceReminderWatcher() {
  if (watcherInterval) {
    clearInterval(watcherInterval)
    watcherInterval = null
  }
}
