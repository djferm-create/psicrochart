// ═══════════════════════════════════════════════════════
// HVAC PsicoChart — Service Worker v1.0
// Cache-first para assets, Network-first para weather API
// ═══════════════════════════════════════════════════════
const CACHE_NAME = 'psico-v1';
const FONTS_CACHE = 'psico-fonts-v1';

const STATIC_ASSETS = [
  './index.html',
  './manifest.json'
];

// ── INSTALL: pre-cachear assets estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// ── ACTIVATE: limpiar caches viejos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys
        .filter(k => k !== CACHE_NAME && k !== FONTS_CACHE)
        .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── FETCH: estrategia por tipo de recurso
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // 1. APIs meteorológicas → Network-first con fallback a cache
  if (url.hostname.includes('open-meteo.com')) {
    e.respondWith(networkFirstWithCache(e.request, 'psico-weather-v1'));
    return;
  }

  // 2. Google Fonts → Cache-first (estables)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(e.request, FONTS_CACHE));
    return;
  }

  // 3. Assets locales → Cache-first
  if (url.origin === self.location.origin) {
    e.respondWith(cacheFirst(e.request, CACHE_NAME));
    return;
  }

  // 4. Resto → fetch normal
  e.respondWith(fetch(e.request));
});

// ── Cache-first: sirve desde cache, actualiza en background
async function cacheFirst(request, cacheName) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(cacheName);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Sin conexión', { status: 503 });
  }
}

// ── Network-first: intenta red, cae a cache si falla
async function networkFirstWithCache(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
      // Notificar a la app que hay datos frescos
      const clients = await self.clients.matchAll();
      clients.forEach(c => c.postMessage({ type: 'WEATHER_UPDATED', url: request.url }));
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) {
      // Notificar que se usan datos cacheados
      const clients = await self.clients.matchAll();
      clients.forEach(c => c.postMessage({ type: 'WEATHER_CACHED', url: request.url }));
      return cached;
    }
    return new Response(JSON.stringify({ error: 'Sin conexión y sin caché disponible' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
