'use strict';
importScripts('./offline-assets.js');
const config = self.OFFLINE_ASSETS;
const cacheRoot = `converter:${self.registration.scope}:`;
const prefix = `${cacheRoot}${config.version}:`;
const absolute = path => new URL(path, self.registration.scope).href;
const groups = Object.fromEntries(Object.entries(config.groups).map(([name, paths]) => [name, paths.map(absolute)]));
const hashes = Object.fromEntries(Object.entries(config.hashes).map(([path, hash]) => [absolute(path), hash]));
let mutations = Promise.resolve();

async function verifiedResponse(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { cache: 'no-store', credentials: 'omit', signal: controller.signal });
    if (!response.ok || response.type === 'opaque') throw new Error('资源下载失败，请检查网络后重试');
    const bytes = await response.clone().arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hash !== hashes[url]) throw new Error('资源校验失败，可能正在更新，请稍后重试');
    return response;
  } catch (error) {
    if (controller.signal.aborted) throw new Error('资源下载超时，请检查网络后重试');
    throw error;
  } finally { clearTimeout(timer); }
}

async function prepare(group) {
  if (!groups[group]) throw new Error('未知离线功能');
  const cache = await caches.open(prefix + group);
  for (const url of groups[group]) {
    if (!(await cache.match(url))) await cache.put(url, await verifiedResponse(url));
  }
}

async function status() {
  const ready = {};
  for (const [group, urls] of Object.entries(groups)) {
    const cache = await caches.open(prefix + group);
    ready[group] = (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
  }
  return { version: config.version, ready };
}

async function notifyCacheChange() {
  for (const client of await self.clients.matchAll({ type: 'window' })) {
    client.postMessage({ type: 'OFFLINE_CACHE_CHANGED' });
  }
}

self.addEventListener('install', event => {
  // Do not skipWaiting: an update must not replace code beneath a running conversion.
  event.waitUntil(prepare('shell'));
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(cacheRoot) && !name.startsWith(prefix)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => {
  const port = event.ports[0];
  if (!port) return;
  const request = event.data || {};
  const work = async () => {
    if (request.type === 'PREPARE' && request.group !== 'shell') await prepare(request.group);
    else if (request.type === 'CLEAR') {
      for (const group of Object.keys(groups)) if (group !== 'shell') await caches.delete(prefix + group);
    } else if (request.type !== 'STATUS') throw new Error('不支持的离线操作');
    return status();
  };
  // Serialize writes across tabs, including clearing during an ongoing download.
  const pending = mutations.then(work);
  mutations = pending.catch(() => {});
  event.waitUntil(pending.then(
    value => port.postMessage({ value }),
    error => port.postMessage({ error: error.message || String(error) })
  ).then(() => {
    // Refresh every controlled tab after success or a partial write failure.
    if (request.type === 'PREPARE' || request.type === 'CLEAR') return notifyCacheChange();
  }));
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  const scope = new URL(self.registration.scope);
  if (url.origin === scope.origin) {
    url.search = '';
    if (url.pathname === scope.pathname) url.pathname += 'index.html';
  }
  const key = url.href;
  if (!hashes[key]) return;
  event.respondWith((async () => {
    for (const [group, urls] of Object.entries(groups)) {
      if (!urls.includes(key)) continue;
      const cached = await (await caches.open(prefix + group)).match(key);
      if (cached) return cached;
    }
    return fetch(event.request);
  })());
});
