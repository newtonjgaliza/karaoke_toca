const CACHE_NAME = 'toca-karaoke-v4';
const ASSETS = [
  './',
  './index.html',
  './admin.html',
  './static/css/public.css',
  './static/css/admin.css',
  './static/js/supabase-config.js',
  './static/js/public.js',
  './static/js/admin.js',
  './static/images/toca.jpg',
  './static/images/logo.png'
];

// Instalação do Service Worker e cacheamento dos arquivos estáticos
self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll(ASSETS);
    })
  );
  self.skipWaiting();
});

// Ativação do Service Worker e limpeza de caches antigos
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.map(key => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Intercepção de requisições
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);

  // Não cacheia requisições do Supabase ou requisições que não sejam GET
  if (url.origin.includes('supabase') || e.request.method !== 'GET') {
    return;
  }

  // Estratégia Network-First para arquivos HTML, JS e CSS (garante que atualizações do app apareçam logo)
  if (e.request.destination === 'document' || e.request.destination === 'script' || e.request.destination === 'style') {
    e.respondWith(
      fetch(e.request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return response;
        })
        .catch(() => caches.match(e.request))
    );
  } else {
    // Estratégia Cache-First para imagens, fontes e outros recursos estáticos pesados
    e.respondWith(
      caches.match(e.request).then(cachedResponse => {
        return cachedResponse || fetch(e.request).then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(e.request, clone));
          return response;
        });
      })
    );
  }
});
