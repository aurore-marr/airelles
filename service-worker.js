/**
 * ============================================================
 * Horizon Planning — Service Worker PWA
 * ============================================================
 * Fonctionnalités :
 *   - Cache des ressources statiques (offline partiel)
 *   - Réception des notifications push
 *   - Gestion des clics sur notification (ouverture planning)
 * ============================================================
 */

const SW_VERSION = 'v1.0.0';
const CACHE_NAME = 'horizon-planning-' + SW_VERSION;

// Ressources à mettre en cache au premier chargement
const STATIC_ASSETS = [
  '/',
  '/index.html',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap',
];

// ── Installation : mise en cache des ressources statiques ──
self.addEventListener('install', function(event) {
  console.log('[SW] Install', SW_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache) {
      return cache.addAll(STATIC_ASSETS).catch(function(err) {
        console.warn('[SW] Cache partiel (certaines ressources CDN ignorées):', err);
      });
    }).then(function() {
      // Activer immédiatement sans attendre la fermeture des anciens onglets
      return self.skipWaiting();
    })
  );
});

// ── Activation : nettoyage des anciens caches ──
self.addEventListener('activate', function(event) {
  console.log('[SW] Activate', SW_VERSION);
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.filter(function(key) {
          return key.startsWith('horizon-planning-') && key !== CACHE_NAME;
        }).map(function(key) {
          console.log('[SW] Suppression ancien cache:', key);
          return caches.delete(key);
        })
      );
    }).then(function() {
      return self.clients.claim();
    })
  );
});

// ── Fetch : stratégie Network First, fallback cache ──
self.addEventListener('fetch', function(event) {
  // Ignorer les requêtes non-GET et les appels Supabase (toujours réseau)
  if (event.request.method !== 'GET') return;
  if (event.request.url.includes('supabase.co')) return;

  event.respondWith(
    fetch(event.request).then(function(response) {
      // Mettre en cache les ressources statiques récupérées avec succès
      if (response && response.status === 200 && response.type === 'basic') {
        const responseClone = response.clone();
        caches.open(CACHE_NAME).then(function(cache) {
          cache.put(event.request, responseClone);
        });
      }
      return response;
    }).catch(function() {
      // Hors ligne : chercher dans le cache
      return caches.match(event.request).then(function(cached) {
        if (cached) return cached;
        // Page de fallback hors ligne pour les navigations
        if (event.request.mode === 'navigate') {
          return caches.match('/index.html');
        }
      });
    })
  );
});

// ============================================================
// NOTIFICATIONS PUSH
// ============================================================

/**
 * Réception d'une notification push depuis Supabase / serveur
 *
 * Payload JSON attendu :
 * {
 *   "title": "Planning mis à jour",
 *   "body":  "Votre planning de juin a été modifié.",
 *   "type":  "planning" | "conge" | "alerte" | "shift",
 *   "url":   "https://monapp.vercel.app/?agent=XXX&etab=YYY",
 *   "agentId": "AGT001",
 *   "etabId":  "ETAB01"
 * }
 */
self.addEventListener('push', function(event) {
  console.log('[SW] Push reçu');

  let data = {
    title: 'Horizon Planning',
    body: 'Vous avez une nouvelle notification.',
    type: 'general',
    url: '/',
  };

  try {
    if (event.data) {
      data = Object.assign(data, event.data.json());
    }
  } catch(e) {
    if (event.data) data.body = event.data.text();
  }

  // Icône et badge selon le type
  const icons = {
    planning: '📅',
    conge:    '🌴',
    alerte:   '🚨',
    shift:    '🔄',
    general:  'ℹ️',
  };
  const icon  = '/icons/icon-192.png';
  const badge = '/icons/icon-96.png';

  const notifTitle = (icons[data.type] || '') + ' ' + data.title;

  const notifOptions = {
    body:    data.body,
    icon:    icon,
    badge:   badge,
    tag:     data.type + '-' + (data.agentId || 'global'),  // regroupe les notifs du même type
    renotify: true,
    vibrate: [200, 100, 200],
    data: {
      url:     data.url || '/',
      type:    data.type,
      agentId: data.agentId || null,
      etabId:  data.etabId  || null,
    },
    actions: _getNotifActions(data.type),
  };

  event.waitUntil(
    self.registration.showNotification(notifTitle, notifOptions)
  );
});

function _getNotifActions(type) {
  if (type === 'conge') {
    return [{ action: 'voir', title: '📋 Voir ma demande' }];
  }
  if (type === 'alerte') {
    return [
      { action: 'voir',    title: '✅ Je suis disponible' },
      { action: 'ignorer', title: '❌ Ignorer' },
    ];
  }
  if (type === 'planning' || type === 'shift') {
    return [{ action: 'voir', title: '📅 Voir mon planning' }];
  }
  return [];
}

// ── Clic sur une notification ──
self.addEventListener('notificationclick', function(event) {
  console.log('[SW] Clic notification:', event.action, event.notification.data);
  event.notification.close();

  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || '/';

  if (event.action === 'ignorer') return;

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function(clientList) {
      // Si l'app est déjà ouverte, la ramener au premier plan
      for (let i = 0; i < clientList.length; i++) {
        const client = clientList[i];
        if (client.url.includes(self.location.origin) && 'focus' in client) {
          client.focus();
          // Envoyer un message à l'app pour naviguer vers le bon onglet
          client.postMessage({
            type: 'NOTIF_CLICK',
            notifType: notifData.type,
            agentId: notifData.agentId,
            etabId: notifData.etabId,
          });
          return;
        }
      }
      // Sinon ouvrir un nouvel onglet
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});

// ── Fermeture de notification (analytics optionnel) ──
self.addEventListener('notificationclose', function(event) {
  console.log('[SW] Notification fermée sans clic:', event.notification.tag);
});
