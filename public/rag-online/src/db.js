// IndexedDB 封装：files / chunks / vectors 三个 store
const DB_NAME = 'rag-demo';
const DB_VERSION = 1;

let dbPromise = null;

function openDB() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('files')) {
          db.createObjectStore('files', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('chunks')) {
          const s = db.createObjectStore('chunks', { keyPath: 'id' });
          s.createIndex('fileId', 'fileId');
        }
        if (!db.objectStoreNames.contains('vectors')) {
          db.createObjectStore('vectors', { keyPath: 'chunkId' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function transaction(stores, mode, fn) {
  return openDB().then(
    db =>
      new Promise((resolve, reject) => {
        const t = db.transaction(stores, mode);
        const result = fn(t);
        t.oncomplete = () => resolve(result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

export async function putFile(file) {
  return transaction(['files'], 'readwrite', t => t.objectStore('files').put(file));
}

export async function getFiles() {
  return openDB().then(
    db =>
      new Promise((resolve, reject) => {
        const req = db.transaction('files').objectStore('files').getAll();
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      })
  );
}

export async function deleteFileData(fileId) {
  return transaction(['files', 'chunks', 'vectors'], 'readwrite', t => {
    t.objectStore('files').delete(fileId);
    const chunkStore = t.objectStore('chunks');
    const vecStore = t.objectStore('vectors');
    chunkStore.index('fileId').getAllKeys(fileId).onsuccess = e => {
      for (const key of e.target.result) {
        chunkStore.delete(key);
        vecStore.delete(key);
      }
    };
  });
}

export async function putChunksWithVectors(fileId, chunks, vectors) {
  return transaction(['chunks', 'vectors'], 'readwrite', t => {
    const chunkStore = t.objectStore('chunks');
    const vecStore = t.objectStore('vectors');
    chunks.forEach((c, i) => {
      chunkStore.put(c);
      vecStore.put({ chunkId: c.id, vector: vectors[i] });
    });
  });
}

export async function getAllChunksAndVectors() {
  return openDB().then(
    db =>
      new Promise((resolve, reject) => {
        const t = db.transaction(['chunks', 'vectors']);
        const chunks = [];
        const chunkReq = t.objectStore('chunks').openCursor();
        chunkReq.onsuccess = e => {
          const cursor = e.target.result;
          if (cursor) {
            chunks.push(cursor.value);
            cursor.continue();
          } else {
            const vecMap = new Map();
            const vecReq = t.objectStore('vectors').openCursor();
            vecReq.onsuccess = ev => {
              const c = ev.target.result;
              if (c) {
                vecMap.set(c.value.chunkId, c.value.vector);
                c.continue();
              } else {
                resolve(chunks.map(ch => ({ chunk: ch, vector: vecMap.get(ch.id) })));
              }
            };
            vecReq.onerror = () => reject(vecReq.error);
          }
        };
        chunkReq.onerror = () => reject(chunkReq.error);
      })
  );
}
