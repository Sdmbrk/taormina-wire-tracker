/* Wire Tracker service worker: makes the app installable and keeps the page shell usable offline.
   Live data (Supabase calls) are never cached; they go straight to the network. */
var CACHE = 'wire-tracker-shell-v2.1.0';
var SHELL = ['./', './index.html', './manifest.json', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return; /* Supabase and others: network only */
  e.respondWith(
    fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () { return caches.match(req).then(function (m) { return m || caches.match('./index.html'); }); })
  );
});

/* Card-style notifications: each kind gets its own colour banner, accent colour and an Open button.
   The server sends title, body (lines separated by \n), tag, url and kind. */
var CARD = {
  in:       { color: '#0d9488', image: './icons/card-in.png' },
  out:      { color: '#ea580c', image: './icons/card-out.png' },
  request:  { color: '#6d28d9', image: './icons/card-request.png' },
  accepted: { color: '#15803d', image: './icons/card-accepted.png' },
  change:   { color: '#be123c', image: './icons/card-change.png' }
};
self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Wire Tracker', body: e.data ? e.data.text() : '' }; }
  var card = CARD[data.kind] || { color: '#0f766e', image: undefined };
  var opts = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: !!data.tag,
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    color: card.color,
    image: card.image,
    vibrate: [120, 60, 120],
    actions: [{ action: 'open', title: 'Open' }],
    data: { url: data.url || './' }
  };
  e.waitUntil(self.registration.showNotification(data.title || 'Wire Tracker', opts));
});
self.addEventListener('notificationclick', function (e) {
  /* Tapping the card or its Open button both come here. Open the app (or focus its open tab) at the link in the notification. */
  var n = e.notification;
  var target = new URL((n.data && n.data.url) || './', self.registration.scope).href;
  n.close();
  e.waitUntil((async function () {
    try {
      var list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (var i = 0; i < list.length; i++) {
        if (list[i].url.indexOf(self.registration.scope) === 0) {
          await list[i].focus();
          if (list[i].navigate && list[i].url !== target) { try { await list[i].navigate(target); } catch (err) {} }
          return;
        }
      }
      await self.clients.openWindow(target);
    } catch (err) {
      await self.clients.openWindow(target);
    }
  })());
});
