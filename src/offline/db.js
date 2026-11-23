// User-scoped IndexedDB persistence with automatic in-memory fallback (for Node/Vitest).

const DB_NAME = 'vastraledger_offline_v1';
const DB_VERSION = 1;
const SNAPSHOTS_STORE = 'snapshots';
const QUEUE_STORE = 'sync_queue';

// In-memory fallback when running outside a browser (e.g., automated tests)
const memorySnapshots = new Map();
const memoryQueue = new Map();

function hasIndexedDB() {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

let dbPromise = null;

function openDb() {
  if (!hasIndexedDB()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
        const store = db.createObjectStore(SNAPSHOTS_STORE, { keyPath: 'key' });
        store.createIndex('by_user', 'userId', { unique: false });
      }
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const qStore = db.createObjectStore(QUEUE_STORE, { keyPath: 'id' });
        qStore.createIndex('by_user', 'userId', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  return dbPromise;
}

function txPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function reqPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getSnapshot(userId, name) {
  const key = `${userId}:${name}`;
  if (!hasIndexedDB()) {
    return memorySnapshots.get(key)?.data ?? null;
  }
  const db = await openDb();
  const tx = db.transaction(SNAPSHOTS_STORE, 'readonly');
  const record = await reqPromise(tx.objectStore(SNAPSHOTS_STORE).get(key));
  return record ? record.data : null;
}

export async function setSnapshot(userId, name, data) {
  const key = `${userId}:${name}`;
  const record = {
    key,
    userId,
    name,
    data,
    updatedAt: new Date().toISOString()
  };

  if (!hasIndexedDB()) {
    memorySnapshots.set(key, record);
    return;
  }

  const db = await openDb();
  const tx = db.transaction(SNAPSHOTS_STORE, 'readwrite');
  tx.objectStore(SNAPSHOTS_STORE).put(record);
  await txPromise(tx);
}

export async function enqueueMutation(userId, mutation) {
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    userId,
    createdAt: Date.now(),
    ...mutation
  };

  if (!hasIndexedDB()) {
    memoryQueue.set(entry.id, entry);
    return entry;
  }

  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  tx.objectStore(QUEUE_STORE).put(entry);
  await txPromise(tx);
  return entry;
}

export async function getQueuedMutations(userId) {
  if (!hasIndexedDB()) {
    return Array.from(memoryQueue.values())
      .filter((e) => e.userId === userId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }

  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readonly');
  const idx = tx.objectStore(QUEUE_STORE).index('by_user');
  const rows = await reqPromise(idx.getAll(IDBKeyRange.only(userId)));
  return (rows || []).sort((a, b) => a.createdAt - b.createdAt);
}

export async function removeQueuedMutation(id) {
  if (!hasIndexedDB()) {
    memoryQueue.delete(id);
    return;
  }

  const db = await openDb();
  const tx = db.transaction(QUEUE_STORE, 'readwrite');
  tx.objectStore(QUEUE_STORE).delete(id);
  await txPromise(tx);
}

export async function clearUserStore(userId) {
  if (!hasIndexedDB()) {
    for (const [k, v] of memorySnapshots.entries()) {
      if (v.userId === userId) memorySnapshots.delete(k);
    }
    for (const [k, v] of memoryQueue.entries()) {
      if (v.userId === userId) memoryQueue.delete(k);
    }
    return;
  }

  const db = await openDb();
  const tx = db.transaction([SNAPSHOTS_STORE, QUEUE_STORE], 'readwrite');

  for (const storeName of [SNAPSHOTS_STORE, QUEUE_STORE]) {
    const store = tx.objectStore(storeName);
    const idx = store.index('by_user');
    const keys = await reqPromise(idx.getAllKeys(IDBKeyRange.only(userId)));
    for (const k of keys || []) {
      store.delete(k);
    }
  }

  await txPromise(tx);
}
