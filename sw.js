// Lưu giao diện để mở nhanh và mở được khi mất mạng. Dữ liệu và ảnh luôn lấy mới từ Google.
const CACHE = 'zippo-v2';
const SHELL = ['./', 'index.html', 'styles.css', 'app.js', 'config.js', 'manifest.webmanifest', 'icons/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// Mạng trước, mất mạng thì dùng bản đã lưu — nên sửa giao diện xong là máy nào cũng thấy ngay
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    // no-cache: luôn hỏi GitHub xem file có mới không (bỏ qua bộ nhớ đệm 10 phút của trình duyệt)
    fetch(e.request, { cache: 'no-cache' }).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request).then((r) => r || caches.match('index.html')))
  );
});
