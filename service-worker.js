/* ============================================================
   HORIZON PLANNING — Service Worker PWA
   Cache statique + fallback hors-ligne
   ============================================================ */

const CACHE_NAME = 'horizon-v1';
const OFFLINE_URL = '/';

// Ressources à mettre en cache immédiatement à l'installation
const PRECACHE_ASSETS = [
  '/',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── Installation : pré-cache des assets statiques ──
self.addEventListener('install', function(event) {
  console.log('[SW] Install');
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(PRECACHE_ASSETS).catch(function(err) {
        console.warn('[SW] Pré-cache partiel:', err);
      });
    }).then(function() {
      return self.skipWaiting();
    })
  );
});

// ── Activation : suppression des anciens caches ──
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate');
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== CACHE_NAME; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch : stratégie Network-first avec fallback cache ──
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // Ignorer les requêtes non-GET et les API externes (Supabase, fonts, CDN)
  if (event.request.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return; // ignorer chrome-extension://, data:, etc.
  if (url.origin !== self.location.origin) return;

  // Stratégie Network-first : essaie le réseau, fallback sur le cache
  event.respondWith(
    fetch(event.request).then(function(response) {
      // Mettre en cache les réponses valides
      if (response && response.status === 200 && response.type === 'basic') {
        const toCache = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, toCache);
        });
      }
      return response;
    }).catch(function() {
      // Hors-ligne : retourner depuis le cache
      return caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        // Fallback vers la page principale pour les navigations HTML
        if (event.request.headers.get('accept') && event.request.headers.get('accept').includes('text/html')) {
          return caches.match(OFFLINE_URL);
        }
      });
    })
  );
});

// ── Messages depuis l'application ──
self.addEventListener('message', function(event) {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
  // Notification push locale déclenchée depuis l'app
  if (event.data && event.data.type === 'NOTIF_SHOW') {
    const data = event.data;
    self.registration.showNotification(data.title || 'Horizon Planning', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'horizon-notif',
      data: { notifType: data.notifType || '', url: data.url || '/' },
      requireInteraction: false,
    });
  }
});

// ── Clic sur une notification → naviguer vers l'app ──
self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      // Fenêtre déjà ouverte → focus + message
      for (var i = 0; i < clients.length; i++) {
        var c = clients[i];
        if (c.url.includes(self.location.origin)) {
          c.focus();
          c.postMessage({ type: 'NOTIF_CLICK', notifType: notifData.notifType });
          return;
        }
      }
      // Pas de fenêtre ouverte → ouvrir l'app
      return self.clients.openWindow(targetUrl);
    })
  );
});

// ── Push depuis serveur (optionnel, pour usage futur) ──
self.addEventListener('push', function(event) {
  if (!event.data) return;
  let data = {};
  try { data = event.data.json(); } catch(e) { data = { title: 'Horizon Planning', body: event.data.text() }; }

  event.waitUntil(
    self.registration.showNotification(data.title || 'Horizon Planning', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      tag: data.tag || 'horizon-push',
      data: data,
    })
  );
});
