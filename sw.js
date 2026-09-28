/* Budget - keeps the app itself on the phone, so it opens instantly and
   with no signal. Your data never passes through here: the app keeps its
   own copy and talks to the spreadsheet directly.

   Every open is served from what is kept here, and the newest version is
   fetched in the background at the same time. When the app itself has
   changed, the page is told, and it offers to switch. */
var CACHE = 'budget-v1';
var SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest',
             'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE)
    .then(function (c) { return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); })); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys()
    .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
    .then(function () { return self.clients.claim(); }));
});

/* fetch the newest copy and keep it; true when it differs from the kept one */
function refresh(key, source) {
  return caches.open(CACHE).then(function (c) {
    return fetch(source, { cache: 'no-cache' }).then(function (res) {
      if (!res || !res.ok) return false;
      return c.match(key, { ignoreSearch: true }).then(function (old) {
        var copy = res.clone();
        return Promise.all([old ? old.text() : Promise.resolve(null), copy.text()]).then(function (t) {
          return c.put(key, res).then(function () { return t[0] !== null && t[0] !== t[1]; });
        });
      });
    });
  }).catch(function () { return false; });
}

function tellPages() {
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    cs.forEach(function (c) { c.postMessage({ type: 'updated' }); });
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  /* the spreadsheet lives elsewhere and is never kept here */
  if (url.origin !== self.location.origin) return;
  var page = req.mode === 'navigate';
  var key = page ? new Request('index.html') : new Request(url.origin + url.pathname);
  var fresh = refresh(key, page ? 'index.html' : req);
  e.waitUntil(fresh.then(function (changed) {
    if (changed && (page || /\/(index\.html|config\.js)$/.test(url.pathname))) return tellPages();
  }));
  e.respondWith(caches.open(CACHE).then(function (c) {
    return c.match(key, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      /* not kept yet: whatever the network brings */
      return fresh.then(function () { return c.match(key, { ignoreSearch: true }); })
        .then(function (h2) { return h2 || fetch(req); });
    });
  }));
});
