// ── IDB STORAGE ───────────────────────────────────────────────────────────────
// Async wrapper around IndexedDB for storing large study JSON objects,
// cover images, and per-chapter user answers.
//
// Object stores
//   'studies'  – study content JSON (keyed by study_content_{studyId})
//   'images'   – cover/inline image Blobs (keyed by {studyId}_{imageId})
//   'answers'  – per-chapter answer objects (keyed by {studyId}_ch{N})
//                Each value is a plain object whose fields are produced by
//                answerFieldKey() / likertFieldKey() in state.js, e.g.:
//                  { q_el_01: "my answer", r_el_02: "reflection",
//                    notes_0: "chapter notes", likert_el_03_0: "3",
//                    star_el_01: "1" }
//                Additional per-study (non-chapter) keys also live here:
//                  {studyId}_global_notes          – study-level notes string
//                  {studyId}_lastPosition          – JSON-stringified scroll position
//                  {studyId}_celebrated_ch{N}      – chapter-completion flag ('1')
//                    Stored separately (not in the chapter object) so it is
//                    never overwritten by saveAnswers() read-modify-write cycles.
//
// Values are stored as parsed objects (no JSON.stringify/parse needed)
// except for lastPosition, which is stored as a JSON string to match the
// existing saveLastPosition / loadLastPosition contract.

const StudyIDB = (() => {
  const DB_NAME    = 'BibleStudyReader';
  const DB_VER     = 3;                  // bumped 2 → 3 to add answers store
  const STORE      = 'studies';
  const IMG_STORE  = 'images';
  const ANS_STORE  = 'answers';

  // Set to a DOMException-like object if IDB is unavailable (e.g. Firefox private
  // browsing, restricted Android WebViews). All public methods check this first
  // and reject immediately with a consistent error rather than throwing.
  let _unavailableError = null;

  // Cached connection promise. Set on first successful open(); reused by all
  // subsequent calls to avoid issuing a new indexedDB.open() on every API call.
  // Reset to null on transient open failure so the next call retries. Not reset
  // on _unavailableError (permanent IDB unavailability) — those should fast-fail.
  let _dbPromise = null;

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
    if (_dbPromise) return _dbPromise;

    _dbPromise = new Promise((resolve, reject) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VER);
      } catch (e) {
        // indexedDB.open() itself can throw synchronously in some WebViews.
        _unavailableError = e;
        _unavailableError.name = 'IDBUnavailable';
        _dbPromise = null;
        return reject(_unavailableError);
      }
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE))     db.createObjectStore(STORE);
        if (!db.objectStoreNames.contains(IMG_STORE)) db.createObjectStore(IMG_STORE);
        if (!db.objectStoreNames.contains(ANS_STORE)) db.createObjectStore(ANS_STORE);
      };
      req.onsuccess = e => {
        const db = e.target.result;
        // If another tab opens a newer DB version, close this connection so the
        // upgrade can proceed. Clearing _dbPromise lets the next call re-open.
        db.onversionchange = () => {
          db.close();
          _dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = e => {
        // Firefox private browsing rejects the open request (not throws).
        // Treat as permanent IDB unavailability.
        _unavailableError = e.target.error;
        _unavailableError.name = 'IDBUnavailable';
        _dbPromise = null;
        reject(_unavailableError);
      };
      req.onblocked = () => {
        // A previous connection is blocking this version upgrade. Log and let
        // the open request remain pending — don't reset _dbPromise here since
        // the open may still succeed once the blocker closes.
        console.warn('[StudyIDB] open blocked — another tab may be holding an older connection.');
      };
    });

    return _dbPromise;
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

  // ── answers store (per-chapter answer objects) ────────────────────────────
  //
  // Chapter answers key:  `${studyId}_ch${chapterNum}`
  // Global notes key:     `${studyId}_global_notes`
  // Last position key:    `${studyId}_lastPosition`

  // Returns the answer object for a single chapter, or {} if none exists yet.
  async function getChapterAnswers(studyId, chapterNum) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const key = `${studyId}_ch${chapterNum}`;
      const req = db.transaction(ANS_STORE, 'readonly').objectStore(ANS_STORE).get(key);
      req.onsuccess = e => resolve(e.target.result ?? {});
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Writes the full answer object for a single chapter (overwrites existing).
  async function setChapterAnswers(studyId, chapterNum, obj) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const key = `${studyId}_ch${chapterNum}`;
      const req = db.transaction(ANS_STORE, 'readwrite').objectStore(ANS_STORE).put(obj, key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Returns a raw IDB value by key from the answers store.
  // Used for per-study keys (global_notes, lastPosition) that are not
  // chapter-scoped.
  async function getAnswerRaw(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(ANS_STORE, 'readonly').objectStore(ANS_STORE).get(key);
      req.onsuccess = e => resolve(e.target.result ?? null);
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Writes a raw value by key into the answers store.
  async function setAnswerRaw(key, value) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(ANS_STORE, 'readwrite').objectStore(ANS_STORE).put(value, key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Deletes a raw key from the answers store.
  async function deleteAnswerRaw(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const req = db.transaction(ANS_STORE, 'readwrite').objectStore(ANS_STORE).delete(key);
      req.onsuccess = () => resolve();
      req.onerror   = e => reject(e.target.error);
    });
  }

  // Deletes all answer records for a study: chapter objects, global_notes,
  // and lastPosition. Used by confirmClearAnswers() and deleteStudy().
  // Returns the list of deleted keys (useful for logging/debugging).
  async function deleteStudyAnswers(studyId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(ANS_STORE, 'readwrite');
      const store = tx.objectStore(ANS_STORE);
      const deleted = [];
      const req   = store.openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) return; // iteration complete
        if (cursor.key.startsWith(`${studyId}_`)) {
          deleted.push(cursor.key);
          cursor.delete();
        }
        cursor.continue();
      };
      req.onerror   = e => reject(e.target.error);
      tx.oncomplete = () => resolve(deleted);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // Returns all answer-store keys that start with the given studyId prefix.
  // Used by the progress scanner and the export path to enumerate chapter keys
  // without loading their values.
  async function getAllStudyAnswerKeys(studyId) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx    = db.transaction(ANS_STORE, 'readonly');
      const store = tx.objectStore(ANS_STORE);
      const keys  = [];
      const req   = store.openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) return;
        if (cursor.key.startsWith(`${studyId}_`)) keys.push(cursor.key);
        cursor.continue();
      };
      req.onerror   = e => reject(e.target.error);
      tx.oncomplete = () => resolve(keys);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // Returns every record in the answers store as { key, value } pairs.
  // Used by the migration script to bulk-read all existing IDB answer data.
  async function getAllAnswerEntries() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx      = db.transaction(ANS_STORE, 'readonly');
      const store   = tx.objectStore(ANS_STORE);
      const entries = [];
      const req     = store.openCursor();
      req.onsuccess = e => {
        const cursor = e.target.result;
        if (!cursor) return;
        entries.push({ key: cursor.key, value: cursor.value });
        cursor.continue();
      };
      req.onerror   = e => reject(e.target.error);
      tx.oncomplete = () => resolve(entries);
      tx.onerror    = e => reject(e.target.error);
    });
  }

  // Wipes all records from all three object stores. Used by resetAllData().
  async function clearAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE, IMG_STORE, ANS_STORE], 'readwrite');
      tx.objectStore(STORE).clear();
      tx.objectStore(IMG_STORE).clear();
      tx.objectStore(ANS_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror    = e => reject(e.target.error);
    });
  }

  return {
    // studies store
    get, set, remove,
    // images store
    getImage, setImage, removeImage, removeImagesByPrefix,
    // answers store
    getChapterAnswers, setChapterAnswers,
    getAnswerRaw, setAnswerRaw, deleteAnswerRaw,
    deleteStudyAnswers, getAllStudyAnswerKeys, getAllAnswerEntries,
    // global
    clearAll,
  };
})();
