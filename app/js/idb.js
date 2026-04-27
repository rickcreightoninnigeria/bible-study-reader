// ── IDB STORAGE ───────────────────────────────────────────────────────────────
// Async wrapper around IndexedDB for storing large study JSON objects.
// Only study_content_ keys live here; all other app data stays in localStorage.
// Values are stored as parsed objects (no JSON.stringify/parse needed).
const StudyIDB = (() => {
  const DB_NAME  = 'BibleStudyReader';
  const DB_VER   = 2;                  // bumped from 1 → 2 to add images store
  const STORE    = 'studies';
  const IMG_STORE = 'images';

  // Set to a DOMException-like object if IDB is unavailable (e.g. Firefox private
  // browsing, restricted Android WebViews). All public methods check this first
  // and reject immediately with a consistent error rather than throwing.
  let _unavailableError = null;

  // Warm up on first load — if IDB itself is inaccessible this will set
  // _unavailableError so that the first real call fails fast and cleanly.
  (() => {
    try {
      if (typeof indexedDB === 'undefined' || indexedDB === null) {
        _unavailableError = new Error('IndexedDB is not available in this environment.');
        _unavailableError.name = 'IDBUnavailable';
      }
    } catch (e) {
      // Accessing indexedDB itself throws in some private-browsing contexts.
      _unavailableError = e;
      _unavailableError.name = 'IDBUnavailable';
    }
  })();

  function open() {
    if (_unavailableError) return Promise.reject(_unavailableError);
    return new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        // indexedDB.open() itself can throw synchronously in some WebViews.
        _unavailableError = e;
        _unavailableError.name = 'IDBUnavailable';
        return reject(_unavailableError);
      }
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE))     db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE);
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror   = e => {
        // Firefox private browsing rejects the open request (not throws).
        _unavailableError = e.target.error;
        _unavailableError.name = 'IDBUnavailable';
        reject(_unavailableError);
      };
    });
  }

  // ── studies store (JSON objects) ───────────────────────────────────────────

  async function get(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function set(key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function remove(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // ── images store (Blob objects) ────────────────────────────────────────────
  // Keys follow the pattern:  `${studyId}_cover`
  //                           `${studyId}_publisher`
  //                           `${studyId}_author`

  async function getImage(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IMG_STORE, 'readonly').objectStore(IMG_STORE).get(key);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function setImage(key, blob) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IMG_STORE, 'readwrite').objectStore(IMG_STORE).put(blob, key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  async function removeImage(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(IMG_STORE, 'readwrite').objectStore(IMG_STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Removes all images whose key starts with the given prefix.
  // Used by deleteStudy to sweep up inline chapter images ({studyId}_{elementId})
  // that are not individually tracked at install time.
  async function removeImagesByPrefix(prefix) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(IMG_STORE, 'readwrite');
      const store = tx.objectStore(IMG_STORE);
      const req   = store.openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) return; // iteration complete; tx will commit
        if (cursor.key.startsWith(prefix)) cursor.delete();
        cursor.continue();
      };
      req.onerror  = e => reject(e.target.error);
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // Wipes all records from both object stores. Used by resetAllData().
  async function clearAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, IMG_STORE], 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore(IMG_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  return { get, set, remove, getImage, setImage, removeImage, removeImagesByPrefix, clearAll };
})();