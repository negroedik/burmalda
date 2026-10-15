// Client UI cache for PgmzChat 1.0_Beta6. Server API responses are never cached.
const CACHE='pgmzchat-client-1.0-beta6';
const ASSETS=['/index.html','/styles.css','/app.js','/media-utils.js','/manifest.webmanifest','/pgmz_icon.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET')return;const url=new URL(event.request.url);if(url.pathname.startsWith('/api/'))return;event.respondWith(caches.match(event.request).then(hit=>hit||fetch(event.request)));});

self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(list=>{for(const client of list){if('focus' in client)return client.focus();}if(self.clients.openWindow)return self.clients.openWindow('/');}));});
