/* Budget - keeps the app itself on the phone, so it opens instantly and
   with no signal. Your data never passes through here: the app keeps its
   own copy and talks to the spreadsheet directly.

   Every open is served from what is kept here, and the newest version is
   fetched in the background at the same time. When the app itself has
   changed, the page is told, and it offers to switch.

   Notifications: a push from the spreadsheet carries no text at all. When
   one arrives, this asks the spreadsheet what it is about - with the link
   and key the app leaves in the 'budget-conn' store while notifications
   are on - and shows that. */
var CACHE = 'budget-v4', CONN = 'budget-conn';
/* Every file here has to exist: one missing file fails the whole install,
   and then nothing is kept at all. (The list used to name coin-*.png, which
   were never in the repository - so the app never got its offline copy.) */
var SHELL = ['./', 'index.html', 'config.js', 'manifest.webmanifest',
             'icon-180.png', 'icon-192.png', 'icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE)
    .then(function (c) { return c.addAll(SHELL.map(function (u) { return new Request(u, { cache: 'reload' }); })); })
    .then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys()
    .then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE && k !== CONN; })
        .map(function (k) { return caches.delete(k); }));
    })
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

/* ---- notifications ---------------------------------------------------- */
/* what the spreadsheet has to say - null when it cannot be asked in time */
function inbox() {
  return caches.open(CONN).then(function (c) { return c.match('conn'); })
    .then(function (r) { return r ? r.json() : null; })
    .then(function (conn) {
      if (!conn || !conn.u || !conn.k) return null;
      var ask = fetch(conn.u, { method: 'POST', body: JSON.stringify({ k: conn.k, f: 'pushInbox', a: { id: conn.dev } }) })
        .then(function (r) { return r.json(); })
        .then(function (o) { return (o && o.ok && o.r) ? o.r : null; });
      var late = new Promise(function (res) { setTimeout(function () { res(null); }, 8000); });
      return Promise.race([ask, late]);
    })
    .catch(function () { return null; });
}

/* every push has to show something - the phone stops delivering them to an
   app that stays quiet - so when the spreadsheet cannot be reached, a plain
   note says there is something to look at */
self.addEventListener('push', function (e) {
  e.waitUntil(inbox().then(function (box) {
    var list = (box && box.list && box.list.length) ? box.list : ((box && box.last) ? [box.last] : null);
    if (!list) list = [{ title: 'Budget', body: 'Something new — open the app to see it.', tag: 'budget' }];
    return Promise.all(list.map(function (m) {
      return self.registration.showNotification(m.title || 'Budget', {
        body: m.body || '', tag: m.tag || 'budget', icon: 'icon-192.png', badge: 'icon-192.png',
        data: { tab: m.tab || '' }
      });
    })).then(function () {
      if (self.navigator && self.navigator.setAppBadge) return self.navigator.setAppBadge(list.length).catch(function () {});
    });
  }));
});

/* tapped: the app comes forward on the tab the notification is about */
self.addEventListener('notificationclick', function (e) {
  var tab = (e.notification.data && e.notification.data.tab) || '';
  e.notification.close();
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (cs) {
    for (var i = 0; i < cs.length; i++) {
      if ('focus' in cs[i]) { cs[i].postMessage({ type: 'go', tab: tab }); return cs[i].focus(); }
    }
    return self.clients.openWindow('./' + (tab ? '?tab=' + encodeURIComponent(tab) : ''));
  }));
});
