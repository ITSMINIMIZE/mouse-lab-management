// Service worker ของ iLAMP
//
// กลยุทธ์: network-first แล้วค่อย fallback ไป cache
// เลือกแบบนี้เพราะไฟล์แอปอ้างด้วย ?v=NNN ที่ขยับทุกรอบที่แก้ — ถ้าใช้ cache-first
// ผู้ใช้จะติดเวอร์ชันเก่าจนกว่าจะล้าง cache เอง ซึ่งเป็นปัญหาที่เสียเวลาตามหามาก
// ส่วนห้องเลี้ยงสัตว์ที่สัญญาณไม่ดีก็ยังเปิดใช้ได้ เพราะมี cache รองไว้
const CACHE = 'ilamp-v1';
const SHELL = [
  './', './index.html',
  './css/styles.css', './css/fonts.css',
  './js/data.js', './js/app.js',
  './icons/icon-192.png', './icons/icon-512.png',
  './assets/logo/ilamp-mark.png', './assets/logo/ilamp-logo.png',
];

self.addEventListener('install', e => {
  // addAll ล้มทั้งชุดถ้าไฟล์ใดไฟล์หนึ่งพลาด — ใส่ทีละไฟล์เพื่อให้ที่เหลือยังถูกเก็บ
  e.waitUntil(caches.open(CACHE).then(c =>
    Promise.all(SHELL.map(u => c.add(u).catch(() => null)))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      })
      .catch(async () => {
        // ignoreSearch: ไฟล์ถูกขอด้วย ?v=NNN แต่เก็บไว้โดยไม่มี query
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return hit;
        // เปิดแอปตอนออฟไลน์ — ส่งหน้าหลักกลับไปให้ router ทำงานต่อ
        if (req.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      })
  );
});
