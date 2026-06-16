const CACHE_NAME = "fitness-tracker-v1";

const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./config.js",
  "./manifest.json",
  "./js/supabaseClient.js",
  "./js/auth.js",
  "./js/exercises.js",
  "./js/strength.js",
  "./js/runs.js",
  "./js/analytics.js",
  "./js/recommendations.js",
  "./js/main.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Only handle same-origin GET requests for the app shell.
  // Supabase API calls and other cross-origin requests pass through to the network untouched.
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) {
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
