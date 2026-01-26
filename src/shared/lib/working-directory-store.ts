/**
 * Global store for FileSystemDirectoryHandle
 *
 * FileSystemDirectoryHandle cannot be serialized (e.g., through React Router state),
 * so we store it in both:
 * 1. An in-memory Map for quick access during the session
 * 2. IndexedDB for persistence across page navigations
 *
 * Note: When retrieving from IndexedDB, permission may need to be re-requested.
 */

const IDB_NAME = 'workany-dir-handles';
const IDB_VERSION = 1;
const STORE_NAME = 'handles';

// In-memory store for quick access
const directoryHandles = new Map<string, FileSystemDirectoryHandle>();

// IndexedDB instance
let idb: IDBDatabase | null = null;

// Initialize IndexedDB
async function getIDB(): Promise<IDBDatabase> {
  if (idb) return idb;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(IDB_NAME, IDB_VERSION);

    request.onerror = () => {
      console.error('[WorkingDirStore] Failed to open IndexedDB:', request.error);
      reject(request.error);
    };

    request.onsuccess = () => {
      idb = request.result;
      resolve(idb);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        console.log('[WorkingDirStore] Created IndexedDB store');
      }
    };
  });
}

// Helper to promisify IDB requests
function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Generate a unique key for a handle
export function storeDirectoryHandle(handle: FileSystemDirectoryHandle): string {
  const key = `dir_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  directoryHandles.set(key, handle);
  console.log('[WorkingDirStore] Stored handle with key:', key);

  // Also store in IndexedDB for persistence (async, fire-and-forget)
  persistHandleToIDB(key, handle).catch((err) => {
    console.error('[WorkingDirStore] Failed to persist handle to IDB:', err);
  });

  return key;
}

// Store handle by folder name (for restoration by name)
export async function storeHandleByName(name: string, handle: FileSystemDirectoryHandle): Promise<void> {
  const key = `name_${name}`;
  directoryHandles.set(key, handle);
  console.log('[WorkingDirStore] Stored handle by name:', name);

  await persistHandleToIDB(key, handle);
}

// Persist handle to IndexedDB
async function persistHandleToIDB(key: string, handle: FileSystemDirectoryHandle): Promise<void> {
  try {
    const db = await getIDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    await idbRequest(store.put({ key, handle }));
    console.log('[WorkingDirStore] Persisted handle to IDB:', key);
  } catch (err) {
    console.error('[WorkingDirStore] Failed to persist handle:', err);
  }
}

// Retrieve a handle by key (from memory or IndexedDB)
export function getDirectoryHandle(key: string): FileSystemDirectoryHandle | undefined {
  const handle = directoryHandles.get(key);
  console.log('[WorkingDirStore] Retrieved handle for key:', key, 'found:', !!handle);
  return handle;
}

// Retrieve a handle by folder name (from memory or IndexedDB)
export async function getHandleByName(name: string): Promise<FileSystemDirectoryHandle | undefined> {
  const key = `name_${name}`;

  // First check in-memory
  let handle = directoryHandles.get(key);
  if (handle) {
    console.log('[WorkingDirStore] Found handle in memory for name:', name);
    return handle;
  }

  // Try to retrieve from IndexedDB
  try {
    const db = await getIDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const store = tx.objectStore(STORE_NAME);
    const result = await idbRequest(store.get(key)) as { key: string; handle: FileSystemDirectoryHandle } | undefined;

    if (result?.handle) {
      handle = result.handle;
      // Cache in memory for quick access
      directoryHandles.set(key, handle);
      console.log('[WorkingDirStore] Retrieved handle from IDB for name:', name);

      // Check/request permission
      const permission = await handle.queryPermission({ mode: 'read' });
      if (permission !== 'granted') {
        console.log('[WorkingDirStore] Requesting permission for handle:', name);
        const requested = await handle.requestPermission({ mode: 'read' });
        if (requested !== 'granted') {
          console.warn('[WorkingDirStore] Permission denied for handle:', name);
          return undefined;
        }
      }

      return handle;
    }
  } catch (err) {
    console.error('[WorkingDirStore] Failed to retrieve handle from IDB:', err);
  }

  console.log('[WorkingDirStore] Handle not found for name:', name);
  return undefined;
}

// Remove a handle (cleanup)
export function removeDirectoryHandle(key: string): void {
  directoryHandles.delete(key);
  console.log('[WorkingDirStore] Removed handle with key:', key);

  // Also remove from IndexedDB (async, fire-and-forget)
  getIDB()
    .then((db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);
    })
    .catch((err) => {
      console.error('[WorkingDirStore] Failed to remove handle from IDB:', err);
    });
}

// Clear all handles
export function clearDirectoryHandles(): void {
  directoryHandles.clear();
  console.log('[WorkingDirStore] Cleared all handles');

  // Also clear IndexedDB (async, fire-and-forget)
  getIDB()
    .then((db) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.clear();
    })
    .catch((err) => {
      console.error('[WorkingDirStore] Failed to clear IDB:', err);
    });
}
