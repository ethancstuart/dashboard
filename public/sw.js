/// @ts-nocheck
const CACHE_VERSION = 'dashpulse-v3';
const API_CACHE = 'dashpulse-api-v2';
const STATIC_CACHE = 'dashpulse-static-v2';

// Injected at build time by scripts/inject-sw-manifest.js
const PRECACHE_ASSETS = []; // __PRECACHE_INJECT__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => {
      if (PRECACHE_ASSETS.length > 0) {
        return cache.addAll(PRECACHE_ASSETS);
      }
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== API_CACHE && key !== CACHE_VERSION)
          .map((key) => caches.delete(key))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never cache auth or chat API routes — always network-only
  if (url.pathname.startsWith('/api/auth/') || url.pathname === '/api/chat') {
    event.respondWith(fetch(event.request));
    return;
  }

  // API routes: network-first with stale fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(event.request, API_CACHE));
    return;
  }

  // External tile/font/icon assets: cache-first
  if (
    url.hostname.includes('basemaps.cartocdn.com') ||
    url.hostname.includes('fonts.googleapis.com') ||
    url.hostname.includes('fonts.gstatic.com') ||
    url.hostname.includes('unpkg.com') ||
    url.hostname.includes('openweathermap.org') ||
    url.hostname.includes('espncdn.com')
  ) {
    event.respondWith(cacheFirstWithNetwork(event.request, STATIC_CACHE));
    return;
  }

  // Navigate requests: serve index.html for SPA routing
  if (event.request.mode === 'navigate') {
    event.respondWith(
      caches.match('/index.html').then((cached) => cached || fetch(event.request))
    );
    return;
  }

  // Static assets: cache-first
  event.respondWith(cacheFirstWithNetwork(event.request, STATIC_CACHE));
});

// Listen for notification messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_NOTIFICATION') {
    const { title, body, tag } = event.data;
    self.registration.showNotification(title, {
      body,
      tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
    });
  }
});

async function networkFirstWithCache(request, cacheName) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch (e) {
    const cached = await caches.match(request);
    if (cached) return cached;
    return new Response(JSON.stringify({ error: 'Offline' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}

async function cacheFirstWithNetwork(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') {
      const cache = await caches.open(cacheName);
      try { cache.put(request, response.clone()); } catch (_) { /* opaque may fail */ }
    }
    return response;
  } catch (e) {
    return new Response('', { status: 503 });
  }
}
