// ── STUDY GROUPS ──────────────────────────────────────────────────────────────
// Lets members of a study group send their progress to the group's leader,
// with no server: files go through the share sheet (WhatsApp, email, …).
// Meant for groups of about 30 or fewer; a larger class splits into groups
// led by assistant teachers.
//
//   Leader:  Study group page → Create a group → shares an invite file
//            (.bsrgroup) in the group's chat.
//   Member:  opens the invite → enters a name → joined (localStorage).
//            Send my progress → picks what to include (every time; progress
//            only is the default) → a report file (.bsrprogress) goes to the
//            leader in a private message.
//   Leader:  opens the reports (several at once is fine) → the group page
//            shows a members × sessions grid, the most starred questions and
//            the shared answers question by question.
//
// Both files are plain JSON. A report holds a members[] list, so one file can
// carry several members (room for an assistant to pass a group on later).
// What a report always holds: sessions done (answered / total per session),
// when the member last studied (the newest change time in record._t, see
// idb.js), and which questions are starred. With scope 'starred' it adds the
// answers to starred questions; with 'all', every question's answer. Notes
// are never included.
//
// Storage: groups the reader belongs to in localStorage (GROUPS_JOINED_KEY);
// groups the reader leads in the IDB 'groups' store, which backups leave out.
// The page is study-scoped: it shows the active study's groups only.

const GROUP_INVITE_FORMAT = 'bsr-group-invite';
const GROUP_REPORT_FORMAT = 'bsr-progress';
const GROUP_FORMAT_VERSION = 1;
const GROUPS_JOINED_KEY  = 'bsr_groups_joined';
const GROUP_MEMBER_NAME_KEY = 'bsr_member_name';
const GROUP_FILE_MAX_BYTES = 4 * 1024 * 1024;
const GROUP_NAME_MAX = 60;
const GROUP_ANSWER_MAX = 20000;
const GROUP_ID_RE = /^[A-Za-z0-9_-]{6,64}$/;
const GROUP_KEY_RE = /^[A-Za-z0-9_.-]{1,200}$/;
const GROUP_SCOPES = ['progress', 'starred', 'all'];
const GROUP_RECENT_DAYS = 7;

function _isObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }

function _cleanName(v, fallback = '') {
  const s = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, GROUP_NAME_MAX) : '';
  return s || fallback;
}

function newGroupId() {
  const bytes = new Uint8Array(12);
  if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

// ── Checking files (pure; tested in testing/tests/groups.test.js) ────────────

// Returns a clean invite, or throws an Error whose message is the text to show.
function validateGroupInvite(obj) {
  if (!_isObj(obj) || obj.format !== GROUP_INVITE_FORMAT) throw new Error(t('group_err_bad_file'));
  if (Number(obj.formatVersion) > GROUP_FORMAT_VERSION) throw new Error(t('group_err_newer_format'));
  if (!GROUP_ID_RE.test(obj.groupId || '') || !GROUP_KEY_RE.test(obj.studyId || '')) throw new Error(t('group_err_bad_file'));
  return {
    groupId:    obj.groupId,
    groupName:  _cleanName(obj.groupName, t('group_default_name')),
    leaderName: _cleanName(obj.leaderName),
    studyId:    obj.studyId,
    studyTitle: _cleanName(obj.studyTitle, obj.studyId),
  };
}

// Returns a clean report, or throws an Error whose message is the text to show.
function validateProgressReport(obj) {
  if (!_isObj(obj) || obj.format !== GROUP_REPORT_FORMAT) throw new Error(t('group_err_bad_file'));
  if (Number(obj.formatVersion) > GROUP_FORMAT_VERSION) throw new Error(t('group_err_newer_format'));
  if (!GROUP_ID_RE.test(obj.groupId || '') || !GROUP_KEY_RE.test(obj.studyId || '')) throw new Error(t('group_err_bad_file'));
  const int = v => (Number.isInteger(v) && v >= 0 ? v : 0);
  const members = (Array.isArray(obj.members) ? obj.members : []).slice(0, 200)
    .filter(m => _isObj(m) && GROUP_ID_RE.test(m.memberId || ''))
    .map(m => ({
      memberId:    m.memberId,
      name:        _cleanName(m.name, t('group_member_unnamed')),
      scope:       GROUP_SCOPES.includes(m.scope) ? m.scope : 'progress',
      lastStudied: Number.isFinite(m.lastStudied) && m.lastStudied > 0 ? m.lastStudied : null,
      chapters:    (Array.isArray(m.chapters) ? m.chapters : []).slice(0, 200).filter(_isObj).map(c => ({
        chapterNumber: int(c.chapterNumber),
        answered:      int(c.answered),
        total:         int(c.total),
        starred:       (Array.isArray(c.starred) ? c.starred : []).filter(id => typeof id === 'string' && GROUP_KEY_RE.test(id)).slice(0, 500),
      })),
      answers: Object.fromEntries(Object.entries(_isObj(m.answers) ? m.answers : {})
        .filter(([k, v]) => GROUP_KEY_RE.test(k) && typeof v === 'string' && v.trim())
        .slice(0, 2000)
        .map(([k, v]) => [k, v.slice(0, GROUP_ANSWER_MAX)])),
    }));
  if (!members.length) throw new Error(t('group_err_bad_file'));
  return { groupId: obj.groupId, studyId: obj.studyId, createdAt: Number(obj.createdAt) || 0, members };
}

// Adds a report's members to a group record (keyed by memberId). An older
// report than the one already held for a member is skipped. Returns
// { updated: [names], skipped: [names] } and changes `group` in place.
function mergeReportIntoGroup(group, report, receivedAt = Date.now()) {
  group.members = _isObj(group.members) ? group.members : {};
  const updated = [], skipped = [];
  for (const m of report.members) {
    const have = group.members[m.memberId];
    if (have && (have.reportCreatedAt || 0) > report.createdAt) { skipped.push(m.name); continue; }
    group.members[m.memberId] = { ...m, reportCreatedAt: report.createdAt, receivedAt };
    updated.push(m.name);
  }
  return { updated, skipped };
}

// Members sorted by name, with the counts the grid needs.
function groupMembersList(group) {
  return Object.values(_isObj(group.members) ? group.members : {})
    .sort((a, b) => a.name.localeCompare(b.name));
}

function chapterStatus(c) {
  if (!c || !c.total) return 'none';
  if (c.answered >= c.total) return 'done';
  return c.answered > 0 ? 'started' : 'none';
}

// elementId → { count, names } across all members' starred lists.
function groupStarCounts(group) {
  const counts = new Map();
  for (const m of groupMembersList(group)) {
    for (const c of m.chapters) {
      for (const id of c.starred) {
        const entry = counts.get(id) || { count: 0, names: [] };
        entry.count++;
        entry.names.push(m.name);
        counts.set(id, entry);
      }
    }
  }
  return counts;
}

// The shared answers to one question: [{ name, text }].
function groupAnswersFor(group, elementId) {
  return groupMembersList(group)
    .filter(m => typeof m.answers[elementId] === 'string')
    .map(m => ({ name: m.name, text: m.answers[elementId] }));
}

// ── Questions of a chapter ────────────────────────────────────────────────────

// The answerable questions of a normalised chapter (applyStudyData shape:
// sections[] and reflection[]), in order: { elementId, type: 'q'|'r', ref, text }.
function chapterQuestionList(ch) {
  const list = [];
  for (const sec of ch.sections || []) {
    for (const q of sec.questions || []) list.push({ elementId: q.elementId, type: 'q', ref: q.ref || '', text: q.text || '' });
  }
  const reflEls = (ch.elements || []).filter(e => e.type === 'question' && e.subtype === 'reflection' && !e.repeatElement);
  reflEls.forEach((el, i) => list.push({
    elementId: el.elementId, type: 'r',
    ref: t('starred_reflection_ref', { number: i + 1 }),
    text: (ch.reflection || [])[i] || '',
  }));
  return list;
}

// ── Member side ───────────────────────────────────────────────────────────────

function getJoinedGroups() {
  try {
    const list = JSON.parse(localStorage.getItem(GROUPS_JOINED_KEY) || '[]');
    return Array.isArray(list) ? list.filter(g => _isObj(g) && GROUP_ID_RE.test(g.groupId || '')) : [];
  } catch (_) { return []; }
}

function _saveJoinedGroups(list) {
  safeSetItem(GROUPS_JOINED_KEY, JSON.stringify(list));
}

// Builds a member's report for one group. scope: 'progress' | 'starred' | 'all'.
async function buildProgressReport(membership, scope) {
  const data = await StudyIDB.get(`study_content_${membership.studyId}`);
  if (!data || !Array.isArray(data.chapters)) throw new Error(t('group_err_study_missing', { title: membership.studyTitle }));
  const chapters = [];
  const answers = {};
  let lastStudied = 0;
  for (const raw of data.chapters) {
    const ch = { ...raw, reflection: _extractReflectionQuestions(raw.elements), sections: _buildSectionsFromElements(raw.elements) };
    let record = {};
    try { record = await StudyIDB.getChapterAnswers(membership.studyId, raw.chapterNumber); } catch (_) { /* counts as not started */ }
    const { total, answered } = _getChapterProgressFromRecord(ch, record);
    const questions = chapterQuestionList(ch);
    const starred = questions.filter(q => record[starFieldKey(q.elementId)] === '1').map(q => q.elementId);
    for (const ms of Object.values(_isObj(record._t) ? record._t : {})) if (Number(ms) > lastStudied) lastStudied = Number(ms);
    if (scope !== 'progress') {
      for (const q of questions) {
        const val = (record[answerFieldKey(q.type, q.elementId)] || '').trim();
        if (val && (scope === 'all' || starred.includes(q.elementId))) answers[q.elementId] = val;
      }
    }
    chapters.push({ chapterNumber: raw.chapterNumber, answered, total, starred });
  }
  const notesTime = Number(await StudyIDB.getAnswerRaw(globalNotesTimeIDBKey(membership.studyId)).catch(() => 0)) || 0;
  lastStudied = Math.max(lastStudied, notesTime);
  return {
    format: GROUP_REPORT_FORMAT,
    formatVersion: GROUP_FORMAT_VERSION,
    groupId: membership.groupId,
    studyId: membership.studyId,
    studyVersion: String(data.studyMetadata?.studyVersion ?? ''),
    createdAt: Date.now(),
    members: [{ memberId: membership.memberId, name: membership.memberName, scope, lastStudied: lastStudied || null, chapters, answers }],
  };
}

function _fileStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function _fileSafe(s) {
  return String(s).replace(/[^\p{L}\p{N} ._-]+/gu, '').replace(/\s+/g, ' ').trim().slice(0, 60) || 'BSR';
}

// Opening an invite: asks for the reader's name, then joins.
async function joinGroupFromInvite(invite) {
  const joined = getJoinedGroups();
  const existing = joined.find(g => g.groupId === invite.groupId);
  const { value: name, isConfirmed } = await Swal.fire({
    title: t('group_join_title'),
    html: `<p><b>${escapeHtml(invite.groupName)}</b></p>
           <p>${escapeHtml(invite.leaderName ? t('group_join_led_by', { name: invite.leaderName, study: invite.studyTitle }) : invite.studyTitle)}</p>
           <p>${escapeHtml(t('group_join_name_prompt'))}</p>`,
    input: 'text',
    inputValue: existing?.memberName || localStorage.getItem(GROUP_MEMBER_NAME_KEY) || '',
    inputAttributes: { maxlength: String(GROUP_NAME_MAX), autocapitalize: 'words' },
    showCancelButton: true,
    confirmButtonText: t('group_join_btn'),
    cancelButtonText: t('group_cancel'),
    reverseButtons: true,
    inputValidator: v => (_cleanName(v) ? null : t('group_join_name_needed')),
  });
  if (!isConfirmed) return;
  const memberName = _cleanName(name);
  safeSetItem(GROUP_MEMBER_NAME_KEY, memberName);
  const entry = { ...invite, memberId: existing?.memberId || newGroupId(), memberName, joinedAt: existing?.joinedAt || Date.now(), lastSentAt: existing?.lastSentAt || 0 };
  _saveJoinedGroups([...joined.filter(g => g.groupId !== invite.groupId), entry]);
  const installed = !!(await StudyIDB.get(`study_content_${invite.studyId}`).catch(() => null));
  await Swal.fire({
    icon: 'success',
    title: t('group_joined_title'),
    text: installed ? t('group_joined_body', { study: invite.studyTitle }) : t('group_joined_install', { study: invite.studyTitle }),
  });
  if (window.activeStudyId === invite.studyId) Router.navigate({ page: 'group' });
}

// Member: Send my progress → choose what to include → share the file.
async function sendGroupProgress(groupId) {
  const membership = getJoinedGroups().find(g => g.groupId === groupId);
  if (!membership) return;
  const option = (value, checked) => `
    <label class="group-scope-option">
      <input type="radio" name="groupScope" value="${value}"${checked ? ' checked' : ''}>
      <span><b>${escapeHtml(t(`group_scope_${value}`))}</b><br>${escapeHtml(t(`group_scope_${value}_desc`))}</span>
    </label>`;
  const { value: scope, isConfirmed } = await Swal.fire({
    title: t('group_send_title'),
    html: `<p>${escapeHtml(t('group_send_intro', { group: membership.groupName }))}</p>
           <div class="group-scope-options">${option('progress', true)}${option('starred')}${option('all')}</div>
           <p class="group-scope-note">${escapeHtml(t('group_send_private'))}</p>`,
    showCancelButton: true,
    confirmButtonText: t('group_send_btn'),
    cancelButtonText: t('group_cancel'),
    reverseButtons: true,
    preConfirm: () => document.querySelector('input[name="groupScope"]:checked')?.value || 'progress',
  });
  if (!isConfirmed) return;
  try {
    const report = await buildProgressReport(membership, scope);
    const blob = new Blob([JSON.stringify(report)], { type: 'application/json' });
    await deliverFile(blob, `${_fileSafe(membership.memberName)} – ${_fileSafe(membership.studyTitle)} – ${_fileStamp()}.bsrprogress`);
    membership.lastSentAt = Date.now();
    _saveJoinedGroups([...getJoinedGroups().filter(g => g.groupId !== groupId), membership]);
    if (window.activeTabPage === 'group') renderGroupPage(window.activeTabId);
  } catch (err) {
    Swal.fire({ icon: 'error', title: t('group_send_failed'), text: err.message || String(err) });
  }
}

async function leaveGroup(groupId) {
  const g = getJoinedGroups().find(x => x.groupId === groupId);
  if (!g) return;
  const { isConfirmed } = await Swal.fire({
    title: t('group_leave_title', { group: g.groupName }),
    text: t('group_leave_body'),
    showCancelButton: true,
    confirmButtonText: t('group_leave_btn'),
    cancelButtonText: t('group_cancel'),
    reverseButtons: true,
  });
  if (!isConfirmed) return;
  _saveJoinedGroups(getJoinedGroups().filter(x => x.groupId !== groupId));
  renderGroupPage();
}

// ── Leader side ───────────────────────────────────────────────────────────────

function _activeStudyTitle() {
  return _cleanName(window.titlePageData?.title || '', window.activeStudyId || '');
}

function _inviteFor(group) {
  return {
    format: GROUP_INVITE_FORMAT,
    formatVersion: GROUP_FORMAT_VERSION,
    groupId: group.groupId,
    groupName: group.groupName,
    leaderName: group.leaderName,
    studyId: group.studyId,
    studyTitle: group.studyTitle,
    createdAt: group.createdAt,
  };
}

async function shareGroupInvite(groupId) {
  const group = await StudyIDB.getGroup(groupId);
  if (!group) return;
  const blob = new Blob([JSON.stringify(_inviteFor(group))], { type: 'application/json' });
  await deliverFile(blob, `${_fileSafe(group.groupName)} – invite.bsrgroup`);
}

async function createGroup() {
  const studyTitle = _activeStudyTitle();
  const { value, isConfirmed } = await Swal.fire({
    title: t('group_create_title'),
    html: `<label class="group-field-label" for="groupNameInput">${escapeHtml(t('group_create_name_label'))}</label>
           <input id="groupNameInput" class="swal2-input" maxlength="${GROUP_NAME_MAX}" value="${escapeHtml(t('group_create_name_default', { study: studyTitle }))}">
           <label class="group-field-label" for="groupLeaderInput">${escapeHtml(t('group_create_leader_label'))}</label>
           <input id="groupLeaderInput" class="swal2-input" maxlength="${GROUP_NAME_MAX}" value="${escapeHtml(localStorage.getItem(GROUP_MEMBER_NAME_KEY) || '')}">
           <p class="group-scope-note">${escapeHtml(t('group_create_note'))}</p>`,
    showCancelButton: true,
    confirmButtonText: t('group_create_btn'),
    cancelButtonText: t('group_cancel'),
    reverseButtons: true,
    preConfirm: () => {
      const groupName = _cleanName(document.getElementById('groupNameInput').value);
      const leaderName = _cleanName(document.getElementById('groupLeaderInput').value);
      if (!groupName || !leaderName) { Swal.showValidationMessage(t('group_create_needed')); return false; }
      return { groupName, leaderName };
    },
  });
  if (!isConfirmed) return;
  safeSetItem(GROUP_MEMBER_NAME_KEY, value.leaderName);
  const group = {
    groupId: newGroupId(), groupName: value.groupName, leaderName: value.leaderName,
    studyId: window.activeStudyId, studyTitle, createdAt: Date.now(), members: {},
  };
  await StudyIDB.setGroup(group);
  await Router.navigate({ page: 'group', tabId: group.groupId });
  await Swal.fire({ icon: 'success', title: t('group_created_title'), text: t('group_created_body'), confirmButtonText: t('group_share_invite_btn') });
  shareGroupInvite(group.groupId);
}

async function deleteGroup(groupId) {
  const group = await StudyIDB.getGroup(groupId);
  if (!group) return;
  const { isConfirmed } = await Swal.fire({
    icon: 'warning',
    title: t('group_delete_title', { group: group.groupName }),
    text: t('group_delete_body'),
    showCancelButton: true,
    confirmButtonText: t('group_delete_btn'),
    cancelButtonText: t('group_cancel'),
    reverseButtons: true,
  });
  if (!isConfirmed) return;
  await StudyIDB.removeGroup(groupId);
  Router.navigate({ page: 'group' });
}

// Opening one or more report files. Returns after saving; shows one message.
async function importProgressReports(reports) {
  const done = [], problems = [];
  let lastGroupId = null;
  for (const report of reports) {
    const group = await StudyIDB.getGroup(report.groupId);
    if (!group) { problems.push(t('group_err_not_your_group', { name: report.members[0]?.name || '?' })); continue; }
    if (group.studyId !== report.studyId) { problems.push(t('group_err_bad_file')); continue; }
    const { updated, skipped } = mergeReportIntoGroup(group, report);
    await StudyIDB.setGroup(group);
    lastGroupId = group.groupId;
    done.push(...updated.map(n => `${n} (${group.groupName})`));
    problems.push(...skipped.map(n => t('group_report_older', { name: n })));
  }
  if (lastGroupId) {
    const group = await StudyIDB.getGroup(lastGroupId);
    if (window.activeStudyId === group.studyId) await Router.navigate({ page: 'group', tabId: lastGroupId });
  }
  const items = [...done, ...problems].map(x => `<li>${escapeHtml(x)}</li>`).join('');
  const hint = done.length && window.activeTabPage !== 'group' ? `<p>${escapeHtml(t('group_report_open_study'))}</p>` : '';
  await Swal.fire({
    icon: done.length ? 'success' : 'error',
    title: done.length ? t('group_report_received', { count: done.length }) : t('group_report_not_added'),
    html: (items ? `<ul style="text-align:start">${items}</ul>` : '') + hint,
  });
}

// Called by loadAnyFile / _installMultipleFiles with a file's text. Returns
// true when the text was a group file (handled here), false otherwise.
function looksLikeGroupFile(text) {
  return typeof text === 'string' && (text.includes(`"${GROUP_INVITE_FORMAT}"`) || text.includes(`"${GROUP_REPORT_FORMAT}"`));
}

async function openGroupFiles(texts) {
  const reports = [];
  for (const text of texts) {
    let obj;
    try { obj = JSON.parse(text); } catch (_) { obj = null; }
    try {
      if (obj && obj.format === GROUP_INVITE_FORMAT) await joinGroupFromInvite(validateGroupInvite(obj));
      else reports.push(validateProgressReport(obj));
    } catch (err) {
      await Swal.fire({ icon: 'error', title: t('group_err_title'), text: err.message });
    }
  }
  if (reports.length) await importProgressReports(reports);
}

// Leader: a member's sheet (their shared answers), with Remove.
async function openGroupMember(groupId, memberId) {
  const group = await StudyIDB.getGroup(groupId);
  const m = group?.members?.[memberId];
  if (!m) return;
  const chapters = window.chapters || [];
  const body = chapters.map(ch => {
    const c = m.chapters.find(x => x.chapterNumber === ch.chapterNumber);
    const shared = chapterQuestionList(ch).filter(q => m.answers[q.elementId] !== undefined);
    return `<div class="group-member-session"><b>${escapeHtml(t('group_session_n', { n: ch.chapterNumber }))}</b>
      ${c ? escapeHtml(t('group_answered_of', { answered: c.answered, total: c.total })) : ''}
      ${shared.map(q => `<div class="group-answer"><div class="group-answer-q">${escapeHtml(q.text)}</div><div class="group-answer-a">${escapeHtml(m.answers[q.elementId])}</div></div>`).join('')}
    </div>`;
  }).join('');
  const res = await Swal.fire({
    title: escapeHtml(m.name),
    html: `<p class="group-scope-note">${escapeHtml(t('group_member_sent', { date: _groupDate(m.receivedAt), scope: t(`group_scope_${m.scope}`) }))}</p>
           <div class="group-member-sheet">${body}</div>`,
    showDenyButton: true,
    denyButtonText: t('group_remove_member_btn'),
    confirmButtonText: t('group_close_btn'),
  });
  if (!res.isDenied) return;
  const { isConfirmed } = await Swal.fire({
    title: t('group_remove_member_title', { name: m.name }),
    text: t('group_remove_member_body'),
    showCancelButton: true,
    confirmButtonText: t('group_remove_member_btn'),
    cancelButtonText: t('group_cancel'),
    reverseButtons: true,
  });
  if (!isConfirmed) return;
  delete group.members[memberId];
  await StudyIDB.setGroup(group);
  renderGroupPage(groupId);
}

// ── The page ──────────────────────────────────────────────────────────────────

function _groupDate(ms) {
  if (!ms) return t('group_never');
  try { return new Date(ms).toLocaleDateString(window.appLocale || undefined, { day: 'numeric', month: 'short' }); }
  catch (_) { return new Date(ms).toDateString(); }
}

let _groupAnswersSession = null;   // chapter number shown under "Answers by question"

function selectGroupAnswersSession(groupId, chNum) {
  _groupAnswersSession = chNum;
  renderGroupPage(groupId);
}

function _groupListHtml(joined, led) {
  const joinedHtml = joined.length ? joined.map(g => `
    <div class="settings-block group-card">
      <div class="settings-row-label">${escapeHtml(g.groupName)}</div>
      <div class="settings-row-desc">${escapeHtml(g.leaderName ? t('group_led_by', { name: g.leaderName }) : '')}
        ${escapeHtml(t('group_last_sent', { date: _groupDate(g.lastSentAt) }))}</div>
      <button class="howto-share-btn settings-export-btn" onclick="sendGroupProgress('${g.groupId}')">${ICONS.share} ${t('group_send_my_progress_btn')}</button>
      <button class="group-link-btn" onclick="leaveGroup('${g.groupId}')">${t('group_leave_btn')}</button>
    </div>`).join('') : `<div class="settings-row-desc">${t('group_none_joined')}</div>`;
  const ledHtml = led.map(g => {
    const members = groupMembersList(g);
    return `
    <div class="settings-block group-card">
      <div class="settings-row-label">${escapeHtml(g.groupName)}</div>
      <div class="settings-row-desc">${escapeHtml(t('group_member_count', { count: members.length }))}</div>
      <button class="howto-share-btn" onclick="Router.navigate({ page: 'group', tabId: '${g.groupId}' })">${t('group_open_btn')}</button>
    </div>`;
  }).join('');
  return `
    <div class="settings-section">
      <div class="settings-section-heading">${t('group_joined_heading')}</div>
      ${joinedHtml}
    </div>
    <div class="settings-section">
      <div class="settings-section-heading">${t('group_led_heading')}</div>
      ${ledHtml}
      <div class="settings-block">
        <div class="settings-row-desc">${t('group_create_desc')}</div>
        <button class="howto-share-btn settings-export-btn" onclick="createGroup()">+ ${t('group_create_btn')}</button>
      </div>
    </div>`;
}

function _groupDetailHtml(group) {
  const chapters = window.chapters || [];
  const members = groupMembersList(group);
  const recent = members.filter(m => Date.now() - (m.receivedAt || 0) < GROUP_RECENT_DAYS * 864e5).length;
  const head = `
    <div class="settings-block">
      <div class="settings-row-desc">${escapeHtml(t('group_summary', { count: members.length, recent }))}</div>
      <button class="howto-share-btn settings-export-btn" onclick="shareGroupInvite('${group.groupId}')">${ICONS.share} ${t('group_share_invite_btn')}</button>
    </div>`;
  if (!members.length) {
    return head + `<div class="settings-block"><div class="settings-row-desc">${t('group_no_reports')}</div></div>` + _groupDangerHtml(group);
  }
  const cell = (m, ch) => {
    const c = m.chapters.find(x => x.chapterNumber === ch.chapterNumber);
    const st = chapterStatus(c);
    const label = st === 'done' ? '✓' : st === 'started' ? `${c.answered}/${c.total}` : '';
    const title = c ? t('group_answered_of', { answered: c.answered, total: c.total }) : '';
    return `<td class="group-cell group-cell-${st}" title="${escapeHtml(title)}">${label}</td>`;
  };
  const grid = `
    <div class="settings-section">
      <div class="settings-section-heading">${t('group_progress_heading')}</div>
      <div class="group-grid-wrap">
        <table class="group-grid">
          <thead><tr><th>${t('group_col_member')}</th>${chapters.map(ch => `<th>${ch.chapterNumber}</th>`).join('')}</tr></thead>
          <tbody>${members.map(m => `
            <tr>
              <th><button class="group-member-btn" onclick="openGroupMember('${group.groupId}', '${m.memberId}')">${escapeHtml(m.name)}</button>
                <span class="group-member-meta">${escapeHtml(t('group_last_studied', { date: _groupDate(m.lastStudied) }))}</span></th>
              ${chapters.map(ch => cell(m, ch)).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      <div class="settings-row-desc group-grid-key">${t('group_grid_key')}</div>
    </div>`;

  const stars = groupStarCounts(group);
  const starredRows = [];
  for (const ch of chapters) {
    for (const q of chapterQuestionList(ch)) {
      const s = stars.get(q.elementId);
      if (s) starredRows.push({ ch, q, s });
    }
  }
  starredRows.sort((a, b) => b.s.count - a.s.count);
  const starredHtml = `
    <div class="settings-section">
      <div class="settings-section-heading">${t('group_starred_heading')}</div>
      ${starredRows.length ? starredRows.slice(0, 15).map(({ ch, q, s }) => `
        <div class="settings-block group-star-row">
          <div class="group-answer-q"><span class="group-star-count">★ ${s.count}</span> ${escapeHtml(t('group_session_n', { n: ch.chapterNumber }))} · ${escapeHtml(q.text)}</div>
          <div class="settings-row-desc">${escapeHtml(s.names.join(', '))}</div>
        </div>`).join('') : `<div class="settings-row-desc">${t('group_no_stars')}</div>`}
    </div>`;

  const sessionNums = chapters.map(ch => ch.chapterNumber);
  if (!sessionNums.includes(_groupAnswersSession)) {
    const withAnswers = chapters.find(ch => chapterQuestionList(ch).some(q => groupAnswersFor(group, q.elementId).length));
    _groupAnswersSession = withAnswers ? withAnswers.chapterNumber : sessionNums[0];
  }
  const ch = chapters.find(c => c.chapterNumber === _groupAnswersSession);
  const qBlocks = ch ? chapterQuestionList(ch).map(q => {
    const answers = groupAnswersFor(group, q.elementId);
    if (!answers.length) return '';
    return `
      <div class="settings-block">
        <div class="group-answer-q">${q.ref ? `<span class="group-answer-ref">${escapeHtml(q.ref)}</span> ` : ''}${escapeHtml(q.text)}</div>
        ${answers.map(a => `<div class="group-answer"><div class="group-answer-name">${escapeHtml(a.name)}</div><div class="group-answer-a">${escapeHtml(a.text)}</div></div>`).join('')}
      </div>`;
  }).join('') : '';
  const answersHtml = `
    <div class="settings-section">
      <div class="settings-section-heading">${t('group_answers_heading')}</div>
      <div class="group-session-picker">${chapters.map(c => `
        <button class="group-session-btn${c.chapterNumber === _groupAnswersSession ? ' active' : ''}"
          onclick="selectGroupAnswersSession('${group.groupId}', ${c.chapterNumber})">${c.chapterNumber}</button>`).join('')}
      </div>
      ${qBlocks || `<div class="settings-row-desc">${t('group_no_answers')}</div>`}
    </div>`;

  return head + grid + starredHtml + answersHtml + _groupDangerHtml(group);
}

function _groupDangerHtml(group) {
  return `
    <div class="settings-section">
      <div class="settings-block">
        <div class="settings-row-desc">${t('group_privacy_note')}</div>
        <button class="settings-danger-btn" onclick="deleteGroup('${group.groupId}')">${t('group_delete_btn')}</button>
      </div>
    </div>`;
}

// Router page 'group'. tabId: a groupId the reader leads (the group's page),
// or none (the list of this study's groups).
async function renderGroupPage(groupId) {
  closeMenu();
  _resetNonChapterPageState();
  isNonChapterPage = true;
  window.activeTabPage = 'group';
  window.activeTabId = groupId || null;
  const content = document.getElementById('mainContent');
  document.getElementById('progressBar').style.width = '0%';
  document.getElementById('header-title').innerText = t('group_page_title');
  const studyId = window.activeStudyId;

  let led = [];
  try { led = (await StudyIDB.getAllGroups()).filter(g => g.studyId === studyId); }
  catch (e) { console.warn('[renderGroupPage] IDB read failed.', e); }
  const group = groupId ? led.find(g => g.groupId === groupId) : null;

  const body = group
    ? _groupDetailHtml(group)
    : _groupListHtml(getJoinedGroups().filter(g => g.studyId === studyId), led);

  content.innerHTML = `
    <div class="howto-page">
      <div class="howto-header">
        <div class="howto-eyebrow">${group ? t('group_eyebrow_leader') : t('group_eyebrow')}</div>
        <div class="howto-title">${escapeHtml(group ? group.groupName : t('group_page_title'))}</div>
      </div>
      <div class="settings-page group-page">
        ${group ? '' : `<p class="settings-row-desc group-intro">${t('group_intro')}</p>`}
        ${body}
      </div>
      <div class="page-close-bar">
        <button class="page-close-btn" onclick="Router.back()"><span>${ICONS.close}</span> ${t('group_close_btn')}</button>
      </div>
      <div style="height: 40px;"></div>
    </div>`;
  window.scrollTo(0, 0);
}
