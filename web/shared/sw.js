var CACHE_PREFIX = "webcode-v2-emscripten";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());
});

function cacheNameForUrl(url) {
  var path = new URL(url).pathname;
  var parts = path.split("/").filter(Boolean);
  if (parts.length >= 1 && parts[0] !== "shared" && parts[0] !== "flush") {
    return CACHE_PREFIX + "-" + parts[0];
  }
  return CACHE_PREFIX + "-global";
}

function shouldCache(request) {
  if (request.method !== "GET") return false;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (url.pathname === "/sw.js") return false;
  return true;
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (!shouldCache(request)) return;

  event.respondWith(
    caches.open(cacheNameForUrl(request.url)).then(function (cache) {
      return cache.match(request).then(function (cached) {
        if (cached) return cached;
        return fetch(request).then(function (response) {
          if (response && response.status === 200) {
            cache.put(request, response.clone());
          }
          return response;
        });
      });
    })
  );
});

function deleteCachesMatching(scope) {
  return caches.keys().then(function (keys) {
    var toDelete;
    if (scope === "all") {
      toDelete = keys.filter(function (k) {
        return k.indexOf("webcode-v") === 0;
      });
    } else {
      toDelete = [
        CACHE_PREFIX + "-" + scope,
        CACHE_PREFIX + "-global",
        "webcode-v1-" + scope,
        "webcode-v1-global",
      ];
    }
    return Promise.all(
      toDelete.map(function (key) {
        return caches.delete(key);
      })
    );
  });
}

self.addEventListener("message", function (event) {
  var data = event.data;
  if (!data || data.type !== "FLUSH") return;
  event.waitUntil(
    deleteCachesMatching(data.scope || "all").then(function () {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ ok: true });
      }
    })
  );
});
