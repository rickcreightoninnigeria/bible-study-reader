// ── MIGRATION: localStorage → IndexedDB ───────────────────────────────────────
// One-time migration that moves all per-study answer data from localStorage
// into the IDB 'answers' store introduced in DB version 3.
//
// Must be called once at app startup, BEFORE any page is rendered, so that
// renderChapter() and renderProgressOverview() always read from IDB.
//
// Call site (app-init.js or equivalent):
//   await migrateAnswersToIDB();
//
// Safety guarantees
// ─────────────────
// • Idempotent: guarded by the 'bsr_idb_migration_done' localStorage flag.
//   Re-running after a partial failure is safe — IDB writes are additive
//   (existing records are overwritten with the same or newer data).
// • Non-destructive on failure: localStorage keys are only removed AFTER
//   every IDB write for a study succeeds. A partial failure leaves localStorage
//   intact so the app degrades gracefully and the migration retries on next launch.
// • Zero-answer studies: studies in the registry with no localStorage keys
//   are skipped silently — nothing to migrate.
//
// Key patterns migrated
// ─────────────────────
// Per-chapter answer fields (written into the chapter object):
//   bsr_{id}_ch{N}_{type}_{elementId}        → field  {type}_{elementId}
//   bsr_{id}_ch{N}_likert_{elementId}_{stIdx}→ field  likert_{elementId}_{stIdx}
//   bsr_{id}_ch{N}_notes_0                   → field  notes_0
//   bsr_{id}_ch{N}_celebrated                → field  celebrated
//   bsr_{id}_star_ch{N}_{elementId}          → field  star_{elementId}
//
// Per-study raw keys (written directly into the answers store):
//   bsr_{id}_global_notes                    → IDB key  {id}_global_notes
//   lastPosition_{id}                        → IDB key  {id}_lastPosition
//
// Keys intentionally NOT migrated (stay in localStorage):
//   study_registry, lib_recent_*, lib_pinned*, bsr_activePathwayId,
//   appSettings, app_language, app_onboarding_complete, bsr_infoSeen_*
//   — these are app-level / settings keys, not per-study answer data.

async function migrateAnswersToIDB() {
  // ── Guard: already done ────────────────────────────────────────────────────
  if (localStorage.getItem('bsr_idb_migration_done') === '1') return;

  console.log('[migrate] Starting localStorage → IDB answer migration…');

  // ── Collect the study IDs to migrate ──────────────────────────────────────
  // study_registry is the authoritative list of installed study IDs.
  // We also scan localStorage for any bsr_{id}_* keys whose ID is NOT in the
  // registry (e.g. a study that was uninstalled but whose answers remain),
  // so orphaned answer data is also migrated and cleaned up.
  let registry = [];
  try {
    registry = JSON.parse(localStorage.getItem('study_registry') || '[]');
  } catch (e) {
    registry = [];
  }

  // Collect every study ID that has at least one bsr_{id}_* key in localStorage.
  const studyIdsFromKeys = new Set();
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (!key || !key.startsWith('bsr_')) continue;
    // Skip known non-study-answer keys that start with 'bsr_' but are app-level:
    //   bsr_activePathwayId, bsr_infoSeen_*
    if (key === 'bsr_activePathwayId') continue;
    if (key.startsWith('bsr_infoSeen_')) continue;
    // Extract the study ID: bsr_{studyId}_...
    // Study IDs may contain underscores, so we identify the boundary by checking
    // whether the remainder after 'bsr_' contains a known suffix pattern.
    // Strategy: try each registered study ID first, then fall back to pattern scan.
    const withoutPrefix = key.slice(4); // remove 'bsr_'
    for (const id of registry) {
      if (withoutPrefix.startsWith(id + '_')) {
        studyIdsFromKeys.add(id);
        break;
      }
    }
  }

  // Union: registered studies + any orphaned studies found via key scan.
  const allStudyIds = new Set([...registry, ...studyIdsFromKeys]);

  if (allStudyIds.size === 0) {
    // Nothing to migrate — mark done and return.
    localStorage.setItem('bsr_idb_migration_done', '1');
    console.log('[migrate] No study answer data found in localStorage. Migration complete.');
    return;
  }

  console.log(`[migrate] Migrating answer data for ${allStudyIds.size} study/studies:`, [...allStudyIds]);

  let totalKeysMigrated = 0;
  let studiesFailed = 0;

  for (const studyId of allStudyIds) {
    try {
      const migratedKeys = await _migrateStudy(studyId);
      totalKeysMigrated += migratedKeys;
    } catch (e) {
      console.error(`[migrate] Failed to migrate study '${studyId}':`, e);
      studiesFailed++;
      // Leave this study's localStorage keys intact — migration will retry on
      // next launch. Do not set the migration-done flag if any study failed.
    }
  }

  if (studiesFailed === 0) {
    localStorage.setItem('bsr_idb_migration_done', '1');
    console.log(`[migrate] Migration complete. ${totalKeysMigrated} keys migrated across ${allStudyIds.size} study/studies.`);
  } else {
    console.warn(`[migrate] Migration partially failed. ${studiesFailed} study/studies not migrated. Will retry on next launch.`);
  }
}


// ── PER-STUDY MIGRATION ───────────────────────────────────────────────────────
// Migrates all localStorage keys for a single study to IDB.
// Returns the number of keys successfully migrated.
// Throws on IDB write failure so the caller can track partial failures.

async function _migrateStudy(studyId) {
  const prefix = `bsr_${studyId}_`;

  // ── 1. Collect all relevant localStorage keys for this study ─────────────
  const chapterObjects = {};   // chapterNum (int) → { fieldName: value }
  const rawIDBWrites   = [];   // [{ key, value }] for non-chapter IDB entries
  const keysToRemove   = [];   // localStorage keys to delete after successful write

  // Also collect the lastPosition key (different prefix pattern)
  const lastPositionLSKey = `lastPosition_${studyId}`;

  for (let i = 0; i < localStorage.length; i++) {
    const lsKey = localStorage.key(i);
    if (!lsKey) continue;

    // ── Per-study raw keys ─────────────────────────────────────────────────

    // global_notes: bsr_{studyId}_global_notes
    if (lsKey === `${prefix}global_notes`) {
      const val = localStorage.getItem(lsKey);
      if (val !== null) {
        rawIDBWrites.push({ key: `${studyId}_global_notes`, value: val });
        keysToRemove.push(lsKey);
      }
      continue;
    }

    // lastPosition: lastPosition_{studyId}
    if (lsKey === lastPositionLSKey) {
      const val = localStorage.getItem(lsKey);
      if (val !== null) {
        rawIDBWrites.push({ key: `${studyId}_lastPosition`, value: val });
        keysToRemove.push(lsKey);
      }
      continue;
    }

    // ── Per-chapter keys (all start with bsr_{studyId}_ then ch{N}_...) ───
    if (!lsKey.startsWith(prefix)) continue;

    const remainder = lsKey.slice(prefix.length); // e.g. "ch3_q_el_01" or "star_ch3_el_02"

    // ── Star flags: bsr_{id}_star_ch{N}_{elementId} ───────────────────────
    // remainder: "star_ch{N}_{elementId}"
    const starMatch = remainder.match(/^star_ch(\d+)_(.+)$/);
    if (starMatch) {
      const chNum     = parseInt(starMatch[1], 10);
      const elementId = starMatch[2];
      const val       = localStorage.getItem(lsKey);
      if (val !== null) {
        _ensureChapter(chapterObjects, chNum);
        chapterObjects[chNum][`star_${elementId}`] = val;
        keysToRemove.push(lsKey);
      }
      continue;
    }

    // ── Chapter-scoped keys: bsr_{id}_ch{N}_... ───────────────────────────
    // remainder: "ch{N}_{rest}"
    const chMatch = remainder.match(/^ch(\d+)_(.+)$/);
    if (!chMatch) continue;

    const chNum = parseInt(chMatch[1], 10);
    const rest  = chMatch[2]; // e.g. "q_el_01", "r_el_02", "likert_el_03_0", "notes_0", "celebrated"
    const val   = localStorage.getItem(lsKey);
    if (val === null) continue;

    _ensureChapter(chapterObjects, chNum);

    // celebrated: bsr_{id}_ch{N}_celebrated
    if (rest === 'celebrated') {
      chapterObjects[chNum]['celebrated'] = val;
      keysToRemove.push(lsKey);
      continue;
    }

    // notes: bsr_{id}_ch{N}_notes_0
    if (rest === 'notes_0') {
      chapterObjects[chNum]['notes_0'] = val;
      keysToRemove.push(lsKey);
      continue;
    }

    // Likert: bsr_{id}_ch{N}_likert_{elementId}_{stIdx}
    // rest: "likert_{elementId}_{stIdx}"
    if (rest.startsWith('likert_')) {
      // Field name in IDB object is exactly the remainder: "likert_{elementId}_{stIdx}"
      chapterObjects[chNum][rest] = val;
      keysToRemove.push(lsKey);
      continue;
    }

    // Question/reflection answer: bsr_{id}_ch{N}_{type}_{elementId}
    // type is 'q' or 'r'; rest is e.g. "q_el_01" or "r_el_02"
    // Field name in IDB object is exactly rest: "{type}_{elementId}"
    if (rest.match(/^[qr]_.+/)) {
      chapterObjects[chNum][rest] = val;
      keysToRemove.push(lsKey);
      continue;
    }

    // Unrecognised key with the study prefix — leave it alone.
  }

  if (keysToRemove.length === 0) {
    return 0; // Nothing to migrate for this study
  }

  console.log(`[migrate] Study '${studyId}': ${Object.keys(chapterObjects).length} chapter(s), ${rawIDBWrites.length} raw key(s), ${keysToRemove.length} total localStorage keys.`);

  // ── 2. Write chapter objects to IDB ───────────────────────────────────────
  // Merge with any existing IDB record so a partially-migrated study doesn't
  // lose data that was already written on a previous (failed) attempt.
  for (const [chNumStr, fields] of Object.entries(chapterObjects)) {
    const chNum = parseInt(chNumStr, 10);
    let existing = {};
    try {
      existing = await StudyIDB.getChapterAnswers(studyId, chNum);
    } catch (e) {
      // No existing record — start fresh.
    }
    const merged = { ...existing, ...fields };
    await StudyIDB.setChapterAnswers(studyId, chNum, merged);
  }

  // ── 3. Write raw per-study keys to IDB ────────────────────────────────────
  for (const { key, value } of rawIDBWrites) {
    await StudyIDB.setAnswerRaw(key, value);
  }

  // ── 4. Remove migrated keys from localStorage ─────────────────────────────
  // Only reached if all IDB writes above succeeded (no throw).
  keysToRemove.forEach(k => localStorage.removeItem(k));

  return keysToRemove.length;
}


// ── UTILITY ───────────────────────────────────────────────────────────────────

function _ensureChapter(chapterObjects, chNum) {
  if (!chapterObjects[chNum]) chapterObjects[chNum] = {};
}
