/**
 * Horizon Planning — Service Worker
 * Version : 1.0.0
 *
 * Responsabilités :
 *  1. Cache statique de l'index.html (stratégie network-first avec fallback cache)
 *  2. Interception de GET /manifest.json pour retourner le manifest agent personnalisé
 *     (fix iOS Safari : relit /manifest.json au moment de "Ajouter à l'écran d'accueil")
 *  3. Réception et affichage des notifications push
 *  4. Gestion des clics sur notification (navigation vers l'app)
 */

const CACHE_NAME = 'horizon-planning-v6-dev-real-accueil-20260830';
const URLS_TO_CACHE = ['./', './index.html', './manifest.json'];

// Manifest agent courant (injecté par la page via postMessage)
let _agentManifest = null;

// ══════════════════════════════════════════════
//  INSTALL — pré-cache l'app shell
// ══════════════════════════════════════════════
self.addEventListener('install', function(event) {
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(URLS_TO_CACHE);
    })
  );
  self.skipWaiting();
});

// ══════════════════════════════════════════════
//  ACTIVATE — nettoyage des anciens caches
// ══════════════════════════════════════════════
self.addEventListener('activate', function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys
          .filter(function(key) { return key !== CACHE_NAME; })
          .map(function(key) { return caches.delete(key); })
      );
    })
  );
  self.clients.claim();
});

// ══════════════════════════════════════════════
//  FETCH — network-first + interception manifest
// ══════════════════════════════════════════════
self.addEventListener('fetch', function(event) {
  const url = new URL(event.request.url);

  // ── Interception /manifest.json : retourner le manifest agent si disponible ──
  if (url.pathname.endsWith('/manifest.json')) {
    if (_agentManifest) {
      event.respondWith(
        new Response(JSON.stringify(_agentManifest), {
          headers: { 'Content-Type': 'application/json' }
        })
      );
      return;
    }
    // Sinon laisser passer la requête normale
    return;
  }

  // ── Stratégie network-first pour l'app shell ──
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          // Mettre en cache la réponse fraîche
          const clone = response.clone();
          caches.open(CACHE_NAME).then(function(cache) {
            cache.put(event.request, clone);
          });
          return response;
        })
        .catch(function() {
          // Offline : retourner le cache
          return caches.match('./') || caches.match('./index.html') || caches.match(event.request);
        })
    );
    return;
  }
});

// ══════════════════════════════════════════════
//  MESSAGE — communication avec la page
// ══════════════════════════════════════════════
self.addEventListener('message', function(event) {
  if (!event.data) return;

  switch (event.data.type) {

    // La page injecte le manifest personnalisé de l'agent
    case 'SET_AGENT_MANIFEST':
      _agentManifest = event.data.manifest || null;
      break;

    // L'agent se déconnecte : revenir au manifest générique
    case 'CLEAR_AGENT_MANIFEST':
      _agentManifest = null;
      break;

    // Demande de mise à jour du SW
    case 'SKIP_WAITING':
      self.skipWaiting();
      break;
  }
});

// ══════════════════════════════════════════════
//  PUSH — réception et affichage notification
// ══════════════════════════════════════════════
self.addEventListener('push', function(event) {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch(e) {
    data = { title: 'Horizon Planning', body: event.data ? event.data.text() : '' };
  }

  const title   = data.title || 'Horizon Planning';
  const options = {
    body:    data.body    || '',
    icon:    data.icon    || '/icons/web-app-manifest-192x192.png',
    badge:   data.badge   || '/icons/web-app-manifest-192x192.png',
    tag:     data.tag     || 'horizon-notif',
    data:    data.data    || {},
    vibrate: [200, 100, 200],
    requireInteraction: !!data.requireInteraction
  };

  event.waitUntil(
    self.registration.showNotification(title, options)
  );
});

// ══════════════════════════════════════════════
//  NOTIFICATIONCLICK — navigation au clic
// ══════════════════════════════════════════════
self.addEventListener('notificationclick', function(event) {
  event.notification.close();

  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || './';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true })
      .then(function(clients) {
        // Chercher une fenêtre déjà ouverte sur l'app
        for (var i = 0; i < clients.length; i++) {
          var client = clients[i];
          try {
            client.postMessage({
              type: 'NOTIF_CLICK',
              notifType: notifData.type || 'general',
              url: targetUrl
            });
          } catch(e) {}
          if (client.url.includes(self.location.origin) && 'focus' in client) {
            client.focus();
            if (client.navigate) client.navigate(targetUrl);
            return;
          }
        }
        // Sinon ouvrir un nouvel onglet
        if (self.clients.openWindow) {
          return self.clients.openWindow(targetUrl);
        }
      })
  );
});
