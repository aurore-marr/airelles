/* ============================================================
   HORIZON PLANNING — Service Worker
   - Manifest dynamique persisté (iOS PWA start_url fix)
   - Notifications push
   ============================================================ */

const SW_VERSION   = 'horizon-v4';
const MANIFEST_KEY = 'horizon-agent-manifest'; // clé dans le Cache API

// ── Cache dédié au manifest dynamique ──
// On utilise le Cache API (pas une variable JS) pour que le manifest
// survive aux redémarrages du SW (fermeture de l'app, veille iOS, etc.)
const MANIFEST_CACHE = 'horizon-manifest-v1';

// ============================================================
// INSTALL
// ============================================================
self.addEventListener('install', function(event) {
  console.log('[SW] Install ' + SW_VERSION);
  self.skipWaiting();
});

// ============================================================
// ACTIVATE
// ============================================================
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate ' + SW_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) {
          // Garder le cache manifest, supprimer les vieux caches SW
          return k !== MANIFEST_CACHE && k !== SW_VERSION;
        }).map(function(k) { return caches.delete(k); })
      );
    }).then(function() { return self.clients.claim(); })
  );
});

// ============================================================
// MESSAGES depuis la page
// ============================================================
self.addEventListener('message', function(event) {
  const msg = event.data;
  if (!msg) return;

  // ── Sauvegarder le manifest agent dans le Cache API ──
  if (msg.type === 'SET_AGENT_MANIFEST') {
    event.waitUntil(
      _saveManifestToCache(msg.manifest).then(function() {
        console.log('[SW] Manifest persisté pour:', msg.manifest && msg.manifest.short_name);
        if (event.source) {
          event.source.postMessage({ type: 'MANIFEST_READY', ok: true });
        }
      })
    );
  }

  // ── Effacer le manifest (déconnexion agent) ──
  if (msg.type === 'CLEAR_AGENT_MANIFEST') {
    event.waitUntil(
      caches.open(MANIFEST_CACHE).then(function(cache) {
        return cache.delete('/' + MANIFEST_KEY);
      }).then(function() {
        console.log('[SW] Manifest agent effacé');
      })
    );
  }
});

// ============================================================
// FETCH — interception des requêtes
// ============================================================
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // ── Intercepter /manifest.json ──
  // iOS Safari relit cette URL au moment de "Ajouter à l'écran d'accueil"
  // On sert le manifest agent persisté s'il existe, sinon le manifest réseau
  if (url.pathname === '/manifest.json') {
    event.respondWith(_serveManifest());
    return;
  }

  // Tout le reste : comportement navigateur par défaut (network-first)
});

// ============================================================
// MANIFEST — lecture depuis le Cache API
// ============================================================
function _serveManifest() {
  return caches.open(MANIFEST_CACHE).then(function(cache) {
    return cache.match('/' + MANIFEST_KEY);
  }).then(function(cached) {
    if (cached) {
      // Manifest agent trouvé dans le cache → le servir
      // On ajoute no-store pour que iOS ne le re-cache pas de son côté
      return cached.json().then(function(manifest) {
        console.log('[SW] Manifest dynamique servi pour:', manifest.short_name);
        return new Response(JSON.stringify(manifest), {
          status: 200,
          headers: {
            'Content-Type': 'application/manifest+json',
            'Cache-Control': 'no-store, no-cache',
          }
        });
      });
    }

    // Pas de manifest agent → récupérer le manifest réseau
    console.log('[SW] Pas de manifest agent — réseau');
    return fetch('/manifest.json', { cache: 'no-store' }).catch(function() {
      return new Response(JSON.stringify(_defaultManifest()), {
        status: 200,
        headers: { 'Content-Type': 'application/manifest+json' }
      });
    });
  });
}

// ── Sauvegarder le manifest dans le Cache API ──
function _saveManifestToCache(manifest) {
  return caches.open(MANIFEST_CACHE).then(function(cache) {
    const response = new Response(JSON.stringify(manifest), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'no-store',
      }
    });
    return cache.put('/' + MANIFEST_KEY, response);
  });
}

// ── Manifest générique (fallback si aucun agent et hors ligne) ──
function _defaultManifest() {
  return {
    name: 'Horizon Planning',
    short_name: 'Horizon',
    description: 'Planning Établissements de Santé',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: '#0f1117',
    theme_color: '#4f8ef7',
    lang: 'fr',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }
    ]
  };
}

// ============================================================
// NOTIFICATIONS PUSH
// ============================================================
self.addEventListener('push', function(event) {
  if (!event.data) return;
  let payload;
  try { payload = event.data.json(); }
  catch(e) { payload = { title: 'Horizon Planning', body: event.data.text() }; }

  const title = payload.title || 'Horizon Planning';
  const options = {
    body:    payload.body    || '',
    icon:    payload.icon    || '/icons/icon-192.png',
    badge:   payload.badge   || '/icons/icon-192.png',
    tag:     payload.tag     || 'horizon-notif',
    data:    payload.data    || {},
    vibrate: [200, 100, 200],
    requireInteraction: !!payload.requireInteraction,
  };
  if (payload.actions) options.actions = payload.actions;
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', function(event) {
  event.notification.close();
  const notifType = (event.notification.data && event.notification.data.type) || 'general';
  const url       = (event.notification.data && event.notification.data.url)  || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clients) {
      if (clients.length > 0) {
        clients[0].focus();
        clients[0].postMessage({ type: 'NOTIF_CLICK', notifType: notifType });
        return;
      }
      return self.clients.openWindow(url);
    })
  );
});
