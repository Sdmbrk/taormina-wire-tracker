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

/* Card-style notifications: each kind gets its own colour, the wire details are drawn onto the card,
   and an Open button opens the app. The server sends title, body, rows ([label, value] pairs), tag, url and kind. */
var CARD = {
  in:       { c1: '#0d9488', c2: '#10b981', image: './icons/card-in.png' },
  out:      { c1: '#ea580c', c2: '#fb923c', image: './icons/card-out.png' },
  request:  { c1: '#6d28d9', c2: '#a855f7', image: './icons/card-request.png' },
  accepted: { c1: '#15803d', c2: '#4ade80', image: './icons/card-accepted.png' },
  change:   { c1: '#be123c', c2: '#f43f5e', image: './icons/card-change.png' }
};
var CARD_LABEL = { in: 'WIRE IN', out: 'WIRE OUT', request: 'STOCK-OUT REQUEST', accepted: 'STOCK-OUT ACCEPTED', change: 'CHANGE REQUEST' };

/* Draw the card with its details. Returns a data URL, or null if drawing is not possible (the static banner is used then). */
async function drawCard(kind, title, rows) {
  try {
    if (typeof OffscreenCanvas === 'undefined') return null;
    var k = CARD[kind] || CARD.in, W = 728, H = 364;
    var cv = new OffscreenCanvas(W, H), g = cv.getContext('2d');
    var grad = g.createLinearGradient(0, 0, W, H);
    grad.addColorStop(0, k.c1); grad.addColorStop(1, k.c2);
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.arc(W - 60, 40, 150, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff';
    g.font = '600 22px sans-serif'; g.fillText('SDMBRK \u00b7 Wire Tracker', 36, 46);
    g.font = '800 46px sans-serif'; g.fillText(CARD_LABEL[kind] || (title || '').toUpperCase(), 36, 104);
    /* detail grid: two columns, up to three rows */
    var list = (rows || []).slice(0, 6), colW = (W - 72) / 2;
    list.forEach(function (r, i) {
      var x = 36 + (i % 2) * colW, y = 150 + Math.floor(i / 2) * 68;
      g.font = '600 18px sans-serif'; g.globalAlpha = 0.85; g.fillText(String(r[0]).toUpperCase(), x, y); g.globalAlpha = 1;
      g.font = '700 30px sans-serif';
      var val = String(r[1]), maxW = colW - 24;
      while (val.length > 1 && g.measureText(val).width > maxW) val = val.slice(0, -2);
      if (val !== String(r[1])) val = val.trimEnd() + '\u2026';
      g.fillText(val, x, y + 36);
    });
    var blob = await cv.convertToBlob({ type: 'image/png' });
    var buf = new Uint8Array(await blob.arrayBuffer()), bin = '';
    for (var j = 0; j < buf.length; j += 8192) bin += String.fromCharCode.apply(null, buf.subarray(j, j + 8192));
    return 'data:image/png;base64,' + btoa(bin);
  } catch (err) { return null; }
}

self.addEventListener('push', function (e) {
  var data = {};
  try { data = e.data ? e.data.json() : {}; } catch (err) { data = { title: 'Wire Tracker', body: e.data ? e.data.text() : '' }; }
  var card = CARD[data.kind] || { c1: '#0f766e', image: undefined };
  e.waitUntil((async function () {
    var picture = await drawCard(data.kind, data.title, data.rows) || card.image;
    await self.registration.showNotification(data.title || 'Wire Tracker', {
      body: data.body || '',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      color: card.c1,
      image: picture,
      vibrate: [120, 60, 120],
      actions: [{ action: 'open', title: 'Open' }],
      data: { url: data.url || './' }
    });
  })());
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
