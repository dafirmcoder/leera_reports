// Service Worker Push & Notification Click Event Handler for Leera Reports PWA / APK

self.addEventListener('push', function (event) {
  let data = {}
  try {
    data = event.data ? event.data.json() : {}
  } catch (_e) {
    data = { body: event.data ? event.data.text() : 'You have a new update from Leera Reports.' }
  }

  const title = data.title || 'Leera Reports'
  const options = {
    body: data.body || 'You have a new notification.',
    icon: data.icon || '/icons/icon-192.png',
    badge: data.badge || '/icons/icon-192.png',
    vibrate: data.vibrate || [250, 100, 250, 100, 250],
    tag: data.tag || 'leera-notification',
    renotify: true,
    requireInteraction: !!data.requireInteraction,
    data: {
      url: (data.data && data.data.url) || data.url || '/',
      timestamp: Date.now()
    }
  }

  event.waitUntil(
    self.registration.showNotification(title, options)
  )
})

self.addEventListener('notificationclick', function (event) {
  event.notification.close()
  const rawUrl = event.notification.data?.url || '/'
  const targetUrl = new URL(rawUrl, self.location.origin).href

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (clientList) {
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i]
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.navigate(targetUrl)
          return client.focus()
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl)
      }
    })
  )
})

