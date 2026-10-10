(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const labels = { image: '图片与 ZIP', doc: '文档', pdf: 'PDF', media: '音视频（约 30 MB）' };
  let registration, busy = false, latestStatus;
  const converting = () => !$('task-progress').classList.contains('hidden');
  const network = () => { $('network-state').textContent = navigator.onLine ? '浏览器显示已联网' : '当前离线'; };
  network();
  window.addEventListener('online', () => { network(); void refresh(); });
  window.addEventListener('offline', () => { network(); void refresh(); });

  async function message(type, group) {
    const worker = navigator.serviceWorker.controller || registration?.active;
    if (!worker) throw new Error('离线服务尚未就绪，请联网刷新后重试');
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timer = setTimeout(() => { channel.port1.close(); reject(new Error('离线准备等待超时，请稍后检查状态')); }, 240000);
      channel.port1.onmessage = event => {
        clearTimeout(timer); channel.port1.close();
        if (event.data.error) reject(new Error(event.data.error)); else resolve(event.data.value);
      };
      try { worker.postMessage({ type, group }, [channel.port2]); }
      catch (error) { clearTimeout(timer); channel.port1.close(); reject(error); }
    });
  }
  function render(value) {
    latestStatus = value;
    for (const [group, label] of Object.entries(labels)) {
      const ready = value.ready.shell && value.ready[group];
      $(`offline-${group}-state`).textContent = ready ? '已缓存，可离线使用' : '未完整缓存，需联网准备';
      $(`offline-${group}`).disabled = busy || ready || !navigator.onLine;
      $(`offline-${group}`).textContent = ready ? `${label}已准备` : `准备${label}`;
    }
    $('offline-clear').disabled = busy || converting();
    $('offline-refresh').disabled = busy;
  }
  async function refresh() {
    if (!registration) return;
    try { render(await message('STATUS')); }
    catch (error) { $('offline-status').textContent = error.message; }
  }
  async function operate(type, group) {
    if (busy) return;
    if (type === 'CLEAR' && converting()) return;
    busy = true;
    document.querySelectorAll('#offline-panel button').forEach(button => { button.disabled = true; });
    $('offline-status').textContent = type === 'CLEAR' ? '正在清除功能缓存…' : `正在准备${labels[group]}，请保持页面打开…`;
    try {
      const value = await message(type, group);
      $('offline-status').textContent = type === 'CLEAR' ? '功能缓存已清除，页面资源仍保留；文件与结果不受影响。' : '准备完成。浏览器可能清理缓存，断网前可检查状态。';
      busy = false; render(value);
    } catch (error) {
      busy = false; $('offline-status').textContent = error.message;
      await refresh();
    }
  }
  for (const group of Object.keys(labels)) $(`offline-${group}`).addEventListener('click', () => void operate('PREPARE', group));
  $('offline-clear').addEventListener('click', () => void operate('CLEAR'));
  $('offline-refresh').addEventListener('click', () => void refresh());
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
  new MutationObserver(() => { if (latestStatus) render(latestStatus); }).observe($('task-progress'), { attributes: true, attributeFilter: ['class'] });

  async function init() {
    if (!('serviceWorker' in navigator) || !window.isSecureContext) {
      $('offline-status').textContent = '当前环境不支持离线准备，请使用 HTTPS 或本机 localhost。'; return;
    }
    try {
      registration = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
      const updateNotice = () => {
        if (registration.waiting) $('offline-update').textContent = '发现新版本。保存下载结果后，关闭本站所有标签页再重新打开。更新后需要重新准备离线功能。';
      };
      registration.addEventListener('updatefound', () => registration.installing?.addEventListener('statechange', updateNotice));
      navigator.serviceWorker.addEventListener('controllerchange', () => void refresh());
      navigator.serviceWorker.addEventListener('message', event => {
        if (event.data?.type === 'OFFLINE_CACHE_CHANGED') void refresh();
      });
      updateNotice();
      await ConversionRuntime.withTimeout(navigator.serviceWorker.ready, 30000, '离线初始化超时，请检查网络或浏览器存储空间后刷新');
      $('offline-status').textContent = '仅缓存程序资源，输入文件与转换结果不会写入离线缓存。';
      await refresh();
    } catch (error) { $('offline-status').textContent = `离线准备不可用，请使用构建后的站点并检查网络：${error.message}`; }
  }
  void init();
})();
