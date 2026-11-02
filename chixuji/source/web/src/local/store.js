// 纯前端版的数据仓库：所有数据放在内存里，改动后自动存进浏览器（IndexedDB）。
// 图片和头像以 dataURL 文字的形式单独存放，不随表格一起读写。
export const TABLES = ['characters', 'branches', 'events', 'settingVersions', 'memories', 'worlds', 'drafts', 'images', 'avatars', 'modelCalls', 'meta', 'phones', 'tracks'];

export class Store {
  constructor(adapter) {
    this.adapter = adapter;
    this.t = Object.fromEntries(TABLES.map((n) => [n, []]));
    this.seq = 0;
    this.dirty = new Set();
    this.eventIndex = new Map();
    this.timer = null;
    this.saving = Promise.resolve();
    this.frozen = false; // 导入备份 / 清空数据后设为 true：内存里的旧数据不再写回去
    this.onSaveError = null; // 保存失败时通知界面
  }

  async load() {
    const data = await this.adapter.loadAll();
    for (const n of TABLES) this.t[n] = Array.isArray(data.tables?.[n]) ? data.tables[n] : [];
    this.seq = data.seq || this.t.events.reduce((m, e) => Math.max(m, e.seq), 0);
    this.reindex();
  }

  reindex() {
    this.t.events.sort((a, b) => a.seq - b.seq);
    this.eventIndex = new Map(this.t.events.map((e) => [e.seq, e]));
  }

  nextSeq() { return ++this.seq; }

  insert(table, row) {
    this.t[table].push(row);
    if (table === 'events') this.eventIndex.set(row.seq, row);
    this.touch(table);
    return row;
  }

  remove(table, pred) {
    const before = this.t[table].length;
    this.t[table] = this.t[table].filter((r) => !pred(r));
    if (this.t[table].length !== before) {
      if (table === 'events') this.reindex();
      this.touch(table);
    }
    return before - this.t[table].length;
  }

  touch(table) {
    if (this.frozen) return;
    this.dirty.add(table);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 150);
  }

  // 停止往存储里写（导入备份、清空数据之前调用，之后会刷新页面）
  freeze() {
    this.frozen = true;
    clearTimeout(this.timer);
    this.dirty.clear();
  }

  async flush() {
    clearTimeout(this.timer);
    if (this.frozen || !this.dirty.size) return this.saving;
    const names = [...this.dirty];
    this.dirty.clear();
    // 某一次保存失败不能卡住以后的保存：失败的表重新标记为“待保存”，下次再试，并通知界面
    this.saving = this.saving.then(async () => {
      if (this.frozen) return;
      try {
        await this.adapter.saveTables(names.map((n) => [n, this.t[n]]), this.seq);
      } catch (err) {
        if (this.frozen) return;
        for (const n of names) this.dirty.add(n);
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.flush(), 5000);
        try { this.onSaveError?.(err); } catch { /* 忽略 */ }
      }
    });
    return this.saving;
  }

  // 图片 / 头像
  putBlob(id, dataUrl) { return this.adapter.putBlob(id, dataUrl); }
  getBlob(id) { return this.adapter.getBlob(id); }
  deleteBlob(id) { return this.adapter.deleteBlob(id); }
  allBlobIds() { return this.adapter.allBlobIds(); }
}

// —— 存储方式一：浏览器的 IndexedDB ——
export function idbAdapter(name = 'xiaoshouji') {
  let dbp = null;
  const open = () => (dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(name, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('tables')) db.createObjectStore('tables');
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
  const run = async (store, mode, fn) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(store, mode);
      const os = tx.objectStore(store);
      let result;
      Promise.resolve(fn(os)).then((r) => { result = r; });
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('存储失败'));
    });
  };
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  return {
    async loadAll() {
      const db = await open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('tables', 'readonly');
        const os = tx.objectStore('tables');
        const out = { tables: {} };
        const keysReq = os.getAllKeys();
        const valsReq = os.getAll();
        tx.oncomplete = () => {
          keysReq.result.forEach((k, i) => { if (k === '__seq') out.seq = valsReq.result[i]; else out.tables[k] = valsReq.result[i]; });
          resolve(out);
        };
        tx.onerror = () => reject(tx.error);
      });
    },
    saveTables(pairs, seq) {
      return run('tables', 'readwrite', (os) => { for (const [n, rows] of pairs) os.put(rows, n); os.put(seq, '__seq'); });
    },
    putBlob: (id, v) => run('blobs', 'readwrite', (os) => { os.put(v, id); }),
    getBlob: async (id) => { const db = await open(); return reqP(db.transaction('blobs').objectStore('blobs').get(id)); },
    deleteBlob: (id) => run('blobs', 'readwrite', (os) => { os.delete(id); }),
    allBlobIds: async () => { const db = await open(); return reqP(db.transaction('blobs').objectStore('blobs').getAllKeys()); },
    async clearAll() {
      await run('tables', 'readwrite', (os) => { os.clear(); });
      await run('blobs', 'readwrite', (os) => { os.clear(); });
    },
  };
}

// —— 存储方式二：只放内存（自动测试用） ——
export function memoryAdapter() {
  let tables = {};
  let seq = 0;
  const blobs = new Map();
  return {
    async loadAll() { return { tables: JSON.parse(JSON.stringify(tables)), seq }; },
    async saveTables(pairs, s) { for (const [n, rows] of pairs) tables[n] = JSON.parse(JSON.stringify(rows)); seq = s; },
    async putBlob(id, v) { blobs.set(id, v); },
    async getBlob(id) { return blobs.get(id); },
    async deleteBlob(id) { blobs.delete(id); },
    async allBlobIds() { return [...blobs.keys()]; },
    async clearAll() { tables = {}; seq = 0; blobs.clear(); },
  };
}
