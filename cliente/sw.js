// ============ FIREBASE CLOUD MESSAGING (notificações com o app fechado) ============
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: "AIzaSyAaNdmniVfOhYRd8OtlKu1YDZSxrkvv1Uo",
  authDomain: "hairos-studio-jardins.firebaseapp.com",
  projectId: "hairos-studio-jardins",
  storageBucket: "hairos-studio-jardins.firebasestorage.app",
  messagingSenderId: "439932036177",
  appId: "1:439932036177:web:23061432249b40f5be0470"
});

const messaging = firebase.messaging();

// Dispara quando chega um push e o app está FECHADO ou em segundo plano.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || 'Studio Jardins';
  const options = {
    body: (payload.notification && payload.notification.body) || '',
    icon: '/cliente/icons/icon-192.png',
    badge: '/cliente/icons/icon-192.png',
    data: payload.data || {},
  };
  self.registration.showNotification(title, options);
});

// Ao tocar na notificação, abre (ou foca) o app do cliente.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.includes('/cliente/') && 'focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow('/cliente/');
    })
  );
});

const CACHE_NAME = 'hairos-cliente-v2';
const APP_SHELL = [
  '/cliente/',
  '/cliente/manifest.json',
  '/cliente/icons/icon-192.png',
  '/cliente/icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch(() => {}) // não bloqueia a instalação se algum item falhar (ex: offline no primeiro load)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estratégia: tenta a rede primeiro (conteúdo sempre atualizado); se falhar (offline), usa o cache.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const clone = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => cached || caches.match('/cliente/'))
      )
  );
});
