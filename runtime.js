(function (root) {
  'use strict';

  function withTimeout(promise, milliseconds, message, onTimeout = () => {}) {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(message));
        onTimeout();
      }, milliseconds);
    });
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }

  async function fetchBytes(url, milliseconds = 60000, expectedHash, signal) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(() => controller.abort(), milliseconds);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`资源下载失败（HTTP ${response.status}）`);
      const bytes = await response.arrayBuffer();
      if (expectedHash) {
        const digest = await crypto.subtle.digest('SHA-256', bytes);
        const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        if (hash !== expectedHash) throw new Error('资源完整性校验失败，请联系站点维护者');
      }
      return bytes;
    } catch (error) {
      if (signal?.aborted) throw new Error('任务已取消');
      if (controller.signal.aborted) throw new Error('资源下载超时，请检查网络后重试');
      throw error;
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }

  // Cancellation keeps the execution slot occupied until its owner has cleaned up.
  function createTask() {
    const controller = new AbortController();
    return {
      signal: controller.signal,
      cancel: () => controller.abort(),
      check() { if (controller.signal.aborted) throw new Error('任务已取消'); },
      async checkpoint() {
        await new Promise(resolve => setTimeout(resolve, 0));
        this.check();
      }
    };
  }

  function checkBudget(bytes, retained = 0, limit = 256 * 1024 * 1024) {
    if (!Number.isFinite(bytes) || bytes < 0 || bytes + retained > limit) {
      throw new Error('预计资源占用超过安全预算，请缩小尺寸、减少页数或清空结果后重试');
    }
  }

  function loadScript(src, milliseconds = 15000) {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let timer;
      const finish = error => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) { script.remove(); reject(error); }
        else resolve();
      };
      script.src = src;
      script.onload = () => finish();
      script.onerror = () => finish(new Error('依赖文件无法加载，请检查部署文件后重试'));
      timer = setTimeout(() => finish(new Error('依赖加载超时，请重试')), milliseconds);
      document.head.appendChild(script);
    });
  }

  // One in-flight load per dependency; failed loads are removed so retry can work.
  function createLoader(libraries, options = {}) {
    const pending = new Map();
    const moduleAttempts = new Map();
    const globals = options.globals || root;
    const load = options.load || loadScript;
    const onState = options.onState || (() => {});
    const moduleImport = options.moduleImport || (url => import(url));
    const timeout = options.timeout || 15000;
    async function ensure(name) {
      const library = libraries[name];
      if (!library) throw new Error(`未知依赖：${name}`);
      if (globals[library.var]) return true;
      if (pending.has(name)) return pending.get(name);
      onState(name, 'loading');
      const promise = Promise.resolve().then(async () => {
        if (library.module) {
          const attempt = moduleAttempts.get(name) || 0;
          moduleAttempts.set(name, attempt + 1);
          // Browsers can cache failed imports. A retry must make a fresh request.
          const url = library.urls[0] + (attempt ? `?retry=${attempt}` : '');
          const value = await withTimeout(moduleImport(url), timeout, '依赖模块加载超时');
          globals[library.var] = value;
        } else {
          await withTimeout(load(library.urls[0]), timeout, '依赖加载超时');
        }
        if (!globals[library.var]) throw new Error('依赖加载后未提供预期接口');
        if (library.init) library.init();
        onState(name, 'success');
        return true;
      }).catch(error => {
        onState(name, 'error');
        throw new Error(`${name} 加载失败：${error.message || error}`);
      }).finally(() => pending.delete(name));
      pending.set(name, promise);
      return promise;
    }
    return { ensure };
  }

  const api = { withTimeout, fetchBytes, loadScript, createLoader, createTask, checkBudget };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConversionRuntime = api;
})(globalThis);
