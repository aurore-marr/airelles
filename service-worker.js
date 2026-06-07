/* ============================================================
   HORIZON PLANNING — Service Worker
   - Manifest dynamique par agent (iOS PWA fix)
   - Cache offline de base
   - Notifications push
   ============================================================ */

const SW_VERSION = 'horizon-v3';

// ── Manifest agent en mémoire (mis à jour via postMessage) ──
let _agentManifest = null;

// ============================================================
// INSTALL
// ============================================================
self.addEventListener('install', function(event) {
  console.log('[SW] Install v' + SW_VERSION);
  self.skipWaiting();
});

// ============================================================
// ACTIVATE
// ============================================================
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate v' + SW_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(k) { return k !== SW_VERSION; })
            .map(function(k) { return caches.delete(k); })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ============================================================
// MESSAGES depuis la page
// ============================================================
self.addEventListener('message', function(event) {
  const msg = event.data;
  if (!msg) return;

  // ── Réception des données du manifest agent ──
  if (msg.type === 'SET_AGENT_MANIFEST') {
    _agentManifest = msg.manifest;
    console.log('[SW] Manifest agent reçu pour:', _agentManifest && _agentManifest.short_name);
    // Confirmer la réception à la page
    if (event.source) {
      event.source.postMessage({ type: 'MANIFEST_READY', ok: true });
    }
  }

  // ── Reset (déconnexion agent) ──
  if (msg.type === 'CLEAR_AGENT_MANIFEST') {
    _agentManifest = null;
    console.log('[SW] Manifest agent effacé');
  }

  // ── Navigation après clic sur notification ──
  if (msg.type === 'NOTIF_CLICK') {
    _broadcastToClients({ type: 'NOTIF_CLICK', notifType: msg.notifType });
  }
});

// ============================================================
// FETCH — interception des requêtes
// ============================================================
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // ── Intercepter /manifest.json ──
  // iOS Safari lit cette URL au moment de "Ajouter à l'écran d'accueil"
  if (url.pathname === '/manifest.json') {
    event.respondWith(_serveManifest());
    return;
  }

  // ── Stratégie network-first pour les autres requêtes ──
  // (laisser passer normalement, pas de cache agressif pour l'app dynamique)
  // Pas de event.respondWith → comportement navigateur par défaut
});

// ============================================================
// MANIFEST dynamique
// ============================================================
function _serveManifest() {
  // Si un manifest agent est en mémoire, le servir
  if (_agentManifest) {
    console.log('[SW] Serving dynamic agent manifest for:', _agentManifest.short_name);
    return new Response(JSON.stringify(_agentManifest), {
      status: 200,
      headers: {
        'Content-Type': 'application/manifest+json',
        'Cache-Control': 'no-store',
      }
    });
  }

  // Sinon, tenter de récupérer le manifest réel depuis le réseau
  return fetch('/manifest.json', { cache: 'no-store' })
    .catch(function() {
      // Fallback manifest générique si hors ligne
      return new Response(JSON.stringify(_defaultManifest()), {
        status: 200,
        headers: { 'Content-Type': 'application/manifest+json' }
      });
    });
}

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
  try {
    payload = event.data.json();
  } catch(e) {
    payload = { title: 'Horizon Planning', body: event.data.text() };
  }

  const title   = payload.title   || 'Horizon Planning';
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

// ── Clic sur notification ──
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const notifType = (event.notification.data && event.notification.data.type) || 'general';
  const url       = (event.notification.data && event.notification.data.url)  || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clients) {
        // Si une fenêtre est déjà ouverte, lui envoyer le message de navigation
        if (clients.length > 0) {
          clients[0].focus();
          clients[0].postMessage({ type: 'NOTIF_CLICK', notifType: notifType });
          return;
        }
        // Sinon ouvrir une nouvelle fenêtre
        return self.clients.openWindow(url);
      })
  );
});

// ============================================================
// HELPERS
// ============================================================
function _broadcastToClients(msg) {
  self.clients.matchAll({ includeUncontrolled: true }).then(function(clients) {
    clients.forEach(function(c) { c.postMessage(msg); });
  });
}
