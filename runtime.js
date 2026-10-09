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

  // Keep only metadata in history; completed/removed jobs release their input closure.
  function createQueue({ onChange = () => {}, maxPending = 8, maxBytes = 200 * 1024 * 1024 } = {}) {
    const jobs = [];
    let active = null, nextId = 1, draining = false;
    const entries = () => jobs.map(({ id, label, bytes, status, message }) => ({ id, label, bytes, status, message }));
    const notify = () => {
      while (jobs.length > 20) {
        const index = jobs.findIndex(job => !['waiting', 'running'].includes(job.status));
        if (index < 0) break;
        jobs.splice(index, 1);
      }
      onChange(entries());
    };
    const finish = (job, status) => {
      job.status = status;
      job.run = null;
      job.resolve(status);
      job.resolve = null;
    };
    async function drain() {
      if (draining) return;
      draining = true;
      try {
        while ((active = jobs.find(job => job.status === 'waiting'))) {
          const job = active;
          job.status = 'running'; notify();
          try {
            const result = await job.run();
            const status = typeof result === 'object' && result ? result.status : result;
            if (result?.message) job.message = String(result.message);
            finish(job, status === 'cancelled' ? 'cancelled' : status === 'failed' ? 'failed' : 'done');
          } catch (error) { job.message = String(error?.message || error); finish(job, 'failed'); }
          active = null;
          notify();
        }
      } finally { draining = false; }
    }
    return {
      entries,
      add({ label, bytes }, run) {
        const pending = jobs.filter(job => ['waiting', 'running'].includes(job.status));
        if (pending.filter(job => job.status === 'waiting').length >= maxPending) throw new Error(`等待队列最多 ${maxPending} 个任务，请先处理或移除部分任务`);
        checkBudget(bytes, pending.reduce((sum, job) => sum + job.bytes, 0), maxBytes);
        let resolve;
        const done = new Promise(r => { resolve = r; });
        const job = { id: nextId++, label, bytes, run, resolve, status: 'waiting' };
        jobs.push(job); notify();
        void drain();
        return { id: job.id, done };
      },
      remove(id) {
        const job = jobs.find(item => item.id === id && item.status === 'waiting');
        if (!job) return false;
        finish(job, 'cancelled'); notify();
        return true;
      },
      clearPending() {
        for (const job of jobs) if (job.status === 'waiting') finish(job, 'cancelled');
        notify();
      }
    };
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

  const api = { withTimeout, fetchBytes, loadScript, createLoader, createTask, checkBudget, createQueue };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.ConversionRuntime = api;
})(globalThis);
