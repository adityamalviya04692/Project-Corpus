/* Tiny IndexedDB wrapper. The workspace (documents) and every embedding computed so far
   are kept locally, so a refresh restores everything without re-parsing or re-embedding.
   Nothing here leaves the device. */

const DB = 'corpus';
const VERSION = 1;
let db: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  return (db ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('vectors')) d.createObjectStore('vectors');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }));
}

const done = (tx: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });

export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    const d = await open();
    return await new Promise((resolve, reject) => {
      const req = d.transaction('kv').objectStore('kv').get(key);
      req.onsuccess = () => resolve(req.result as T | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined; // private mode / blocked storage: the app still works, just without persistence
  }
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  try {
    const d = await open();
    const tx = d.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    await done(tx);
  } catch {
    /* ignore */
  }
}

/** Looks up many cached vectors in one transaction. */
export async function vecGetMany(keys: string[]): Promise<(Float32Array | undefined)[]> {
  if (!keys.length) return [];
  try {
    const d = await open();
    const store = d.transaction('vectors').objectStore('vectors');
    return await Promise.all(
      keys.map(
        (k) =>
          new Promise<Float32Array | undefined>((resolve) => {
            const req = store.get(k);
            req.onsuccess = () => resolve(req.result as Float32Array | undefined);
            req.onerror = () => resolve(undefined);
          }),
      ),
    );
  } catch {
    return keys.map(() => undefined);
  }
}

export async function vecSetMany(entries: [string, Float32Array][]): Promise<void> {
  if (!entries.length) return;
  try {
    const d = await open();
    const tx = d.transaction('vectors', 'readwrite');
    const store = tx.objectStore('vectors');
    for (const [k, v] of entries) store.put(v, k);
    await done(tx);
  } catch {
    /* ignore */
  }
}

/** Fast 64-bit FNV-1a (as two 32-bit halves) for cache keys: text → stable short id. */
export function textKey(text: string): string {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}:${text.length}`;
}

/** SHA-256 of a file's bytes, used to skip duplicate uploads. */
export async function fileHash(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
