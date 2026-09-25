/**
 * IndexedDB persistence with per-record schema versions and migrations.
 * Stores: profile (meta progress), settings, run (current adventure, incl. combat replay log).
 */
const DB = 'mingque';
const STORE = 'kv';
export const SAVE_VERSION = { profile: 1, settings: 1, run: 1 } as const;
type Kind = keyof typeof SAVE_VERSION;

interface Envelope<T> { kind: Kind; v: number; t: number; data: T }

/** migrations[kind][fromVersion] upgrades data from v → v+1 */
const migrations: Record<Kind, Record<number, (d: unknown) => unknown>> = {
  profile: {},
  settings: {},
  run: {},
};

let dbp: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('no indexedDB')); return; }
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function rawGet<T>(key: string): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(key);
      r.onsuccess = () => resolve(r.result as T | undefined);
      r.onerror = () => reject(r.error);
    });
  } catch {
    const s = localStorage.getItem(`mq:${key}`);
    return s ? (JSON.parse(s) as T) : undefined;
  }
}

async function rawPut(key: string, value: unknown): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    try { localStorage.setItem(`mq:${key}`, JSON.stringify(value)); } catch { /* storage full or blocked */ }
  }
}

export async function load<T>(kind: Kind): Promise<T | null> {
  const env = await rawGet<Envelope<unknown>>(kind);
  if (!env || env.kind !== kind) return null;
  let data = env.data;
  let v = env.v;
  const target = SAVE_VERSION[kind];
  while (v < target) {
    const m = migrations[kind][v];
    if (!m) return null; // cannot migrate: treat as absent
    data = m(data);
    v++;
  }
  if (v > target) return null; // saved by a newer build
  return data as T;
}

export async function save<T>(kind: Kind, data: T): Promise<void> {
  const env: Envelope<T> = { kind, v: SAVE_VERSION[kind], t: Date.now(), data };
  await rawPut(kind, JSON.parse(JSON.stringify(env)));
}

export async function clear(kind: Kind): Promise<void> {
  await rawPut(kind, null);
}
