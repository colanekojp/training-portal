const API_URL = window.PORTAL_CONFIG.API_URL;
const LEVEL = 'N3';
const COURSE_URL = 'https://colanekojp.com.tw/member_course/';
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const TESTING_MODE = window.PORTAL_CONFIG.DEMO_MODE_ENABLED && PAGE_PARAMS.get('testing') === '1';
const REQUESTED_TEST_WEEK = Number(PAGE_PARAMS.get('week'));
const TEST_WEEK = REQUESTED_TEST_WEEK >= 1 && REQUESTED_TEST_WEEK <= 8 ? REQUESTED_TEST_WEEK : 1;
const PORTAL_CACHE_KEY = 'n3-portal-cache-v4';
const PORTAL_CACHE_MAX_AGE = 5 * 60 * 1000;

const FALLBACK_WEEK_DATA = [
  { grammar: [1, '2026-09-28T00:00:00+08:00', '2026-10-04T23:59:59+08:00'], listening: [1, '2026-10-02T00:00:00+08:00', '2026-10-04T23:59:59+08:00'], tutoring: [1, '2026-09-30T19:00:00+08:00', '2026-10-06T23:59:59+08:00'], vocabulary: [1, '2026-10-04T00:00:00+08:00', '2026-10-10T23:59:59+08:00'] },
  { grammar: [2, '2026-10-05T00:00:00+08:00', '2026-10-11T23:59:59+08:00'], listening: null, tutoring: [2, '2026-10-07T19:00:00+08:00', '2026-10-13T23:59:59+08:00'], vocabulary: [2, '2026-10-11T00:00:00+08:00', '2026-10-17T23:59:59+08:00'] },
  { grammar: [3, '2026-10-12T00:00:00+08:00', '2026-10-18T23:59:59+08:00'], listening: [2, '2026-10-16T00:00:00+08:00', '2026-10-18T23:59:59+08:00'], tutoring: [3, '2026-10-14T19:00:00+08:00', '2026-10-20T23:59:59+08:00'], vocabulary: [3, '2026-10-18T00:00:00+08:00', '2026-10-24T23:59:59+08:00'] },
  { grammar: [4, '2026-10-19T00:00:00+08:00', '2026-10-25T23:59:59+08:00'], listening: null, tutoring: [4, '2026-10-21T19:00:00+08:00', '2026-10-27T23:59:59+08:00'], vocabulary: [4, '2026-10-25T00:00:00+08:00', '2026-10-31T23:59:59+08:00'] },
  { grammar: [5, '2026-10-26T00:00:00+08:00', '2026-11-01T23:59:59+08:00'], listening: [3, '2026-10-30T00:00:00+08:00', '2026-11-01T23:59:59+08:00'], tutoring: [5, '2026-10-28T19:00:00+08:00', '2026-11-03T23:59:59+08:00'], vocabulary: [5, '2026-11-01T00:00:00+08:00', '2026-11-07T23:59:59+08:00'] },
  { grammar: [6, '2026-11-02T00:00:00+08:00', '2026-11-08T23:59:59+08:00'], listening: null, tutoring: [6, '2026-11-04T19:00:00+08:00', '2026-11-10T23:59:59+08:00'], vocabulary: [6, '2026-11-08T00:00:00+08:00', '2026-11-14T23:59:59+08:00'] },
  { grammar: [7, '2026-11-09T00:00:00+08:00', '2026-11-15T23:59:59+08:00'], listening: [4, '2026-11-13T00:00:00+08:00', '2026-11-15T23:59:59+08:00'], tutoring: [7, '2026-11-11T19:00:00+08:00', '2026-11-17T23:59:59+08:00'], vocabulary: [7, '2026-11-15T00:00:00+08:00', '2026-11-21T23:59:59+08:00'] },
  { grammar: [8, '2026-11-16T00:00:00+08:00', '2026-11-22T23:59:59+08:00'], listening: null, tutoring: [8, '2026-11-18T19:00:00+08:00', '2026-11-24T23:59:59+08:00'], vocabulary: [8, '2026-11-22T00:00:00+08:00', '2026-11-28T23:59:59+08:00'] }
];

const state = {
  portal: null,
  selectedWeek: 1,
  listeningVerified: false,
  toastTimer: null
};

const el = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  showTestingBanner();
  applyPortalData(readPortalCache() || createFallbackPortal());
  loadPortal();
});

function cacheElements() {
  [
    'announcement-text', 'api-state', 'testing-banner', 'weekly-subtitle',
    'current-week-tasks', 'week-tabs', 'week-detail', 'tutoring-list',
    'listening-dialog', 'listening-form', 'listening-dialog-title',
    'listening-task-description', 'listening-task-no', 'listening-student-id',
    'listening-access-panel', 'listening-course-link', 'listening-confirmed',
    'listening-message', 'listening-submit', 'toast'
  ].forEach((id) => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el['week-tabs'].addEventListener('click', handleWeekTabClick);
  document.body.addEventListener('click', handleActionClick);
  el['listening-form'].addEventListener('submit', submitListeningForm);
  el['listening-student-id'].addEventListener('input', () => {
    el['listening-student-id'].value = normalizeStudentIdText(el['listening-student-id'].value);
    if (state.listeningVerified) resetListeningVerification();
  });
  document.querySelectorAll('[data-close-dialog]').forEach((button) => {
    button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog)?.close());
  });
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close();
    });
  });
}

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({ action, ...params }).toString();
  const response = await fetch(url.toString(), { redirect: 'follow' });
  if (!response.ok) throw new Error(`API 連線失敗（${response.status}）`);
  const result = await response.json();
  if (!result.ok) throw apiError(result);
  return result.data;
}

async function apiPost(payload) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload),
    redirect: 'follow'
  });
  if (!response.ok) throw new Error(`API 連線失敗（${response.status}）`);
  const result = await response.json();
  if (!result.ok) throw apiError(result);
  return result;
}

function apiError(result) {
  const error = new Error(result.message || '系統目前無法處理');
  error.code = result.code || 'SERVER_ERROR';
  return error;
}

async function loadPortal() {
  setApiState('連線中', 'loading');
  try {
    const portal = await apiGet('portal', { level: LEVEL });
    writePortalCache(portal);
    applyPortalData(portal, true);
    setApiState('資料已更新', 'online');
  } catch (error) {
    setApiState('讀取失敗', 'error');
    showToast('暫時無法更新，畫面保留目前資料');
    console.error(error);
  }
}

function applyPortalData(portal, preserveSelection = false) {
  const previousWeek = state.selectedWeek;
  const nextPortal = JSON.parse(JSON.stringify(portal));
  ensureScoringWindows(nextPortal);
  // API 狀態由 GAS 的台灣時間判定；只有離線 fallback 才使用瀏覽器時間估算。
  if (!nextPortal.version) refreshPortalStatuses(nextPortal);
  if (TESTING_MODE) applyTestingMode(nextPortal);
  state.portal = nextPortal;
  state.selectedWeek = preserveSelection && previousWeek >= 1 && previousWeek <= 8
    ? previousWeek
    : nextPortal.currentWeek || 1;
  el['announcement-text'].textContent = nextPortal.announcement || '';
  renderCurrentWeek();
  renderWeekTabs();
  renderWeekDetail();
  renderTutoring();
}

function ensureScoringWindows(portal) {
  portal.weeks.forEach((week) => {
    if (week.tutoring?.startAt && !week.tutoring.deadlineAt) {
      week.tutoring.deadlineAt = deadlineAfterSevenDays(week.tutoring.startAt);
    }
    if (week.vocabulary?.releaseAt && !week.vocabulary.deadlineAt) {
      week.vocabulary.deadlineAt = deadlineAfterSevenDays(week.vocabulary.releaseAt);
    }
  });
}

function deadlineAfterSevenDays(value) {
  const [year, month, day] = String(value).slice(0, 10).split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return '';
  const deadline = new Date(Date.UTC(year, month - 1, day + 6));
  return `${deadline.toISOString().slice(0, 10)}T23:59:59+08:00`;
}

function createFallbackPortal() {
  const courseTask = (type, data) => data ? {
    type,
    no: data[0],
    releaseAt: data[1],
    deadlineAt: data[2],
    courseUrl: type === 'grammar' ? COURSE_URL : '',
    completionMethod: type === 'grammar' ? 'grammar_test' : 'listening_report'
  } : null;
  return {
    level: LEVEL,
    pageTitle: 'N3學習專區｜2026第2回JLPT特訓班',
    announcement: '',
    weeks: FALLBACK_WEEK_DATA.map((week, index) => ({
      week: index + 1,
      grammar: courseTask('grammar', week.grammar),
      listening: courseTask('listening', week.listening),
      tutoring: { no: week.tutoring[0], startAt: week.tutoring[1], deadlineAt: week.tutoring[2], meetUrl: '' },
      vocabulary: { unit: week.vocabulary[0], releaseAt: week.vocabulary[1], deadlineAt: week.vocabulary[2], status: 'available' }
    }))
  };
}

function refreshPortalStatuses(portal) {
  const now = new Date();
  portal.weeks.forEach((week) => {
    [week.grammar, week.listening].filter(Boolean).forEach((task) => {
      task.status = now < new Date(task.releaseAt) ? 'upcoming' : now > new Date(task.deadlineAt) ? 'closed' : 'open';
    });
    const tutoringStart = new Date(week.tutoring.startAt);
    const tutoringEnd = new Date(tutoringStart.getTime() + 120 * 60 * 1000);
    week.tutoring.status = Number.isNaN(tutoringStart.getTime())
      ? 'config_missing'
      : now > tutoringEnd ? 'ended' : week.tutoring.meetUrl ? 'available' : 'link_pending';
    week.vocabulary.status = 'available';
  });
  const firstStart = new Date(portal.weeks[0].grammar.releaseAt);
  portal.currentWeek = now < firstStart ? 0 : portal.weeks.find((week) => now <= new Date(week.grammar.deadlineAt))?.week || 8;
}

function applyTestingMode(portal) {
  portal.currentWeek = TEST_WEEK;
  const week = portal.weeks[TEST_WEEK - 1];
  if (week?.grammar) week.grammar.status = 'open';
  if (week?.listening) week.listening.status = 'open';
  if (week?.tutoring) week.tutoring.status = week.tutoring.meetUrl ? 'available' : 'link_pending';
}

function renderCurrentWeek() {
  const currentWeek = state.portal.currentWeek;
  if (TESTING_MODE) {
    el['weekly-subtitle'].textContent = `Demo 模式：正在預覽第 ${currentWeek} 週，所有操作都不會寫入後台。`;
    const week = state.portal.weeks[(currentWeek || 1) - 1];
    el['current-week-tasks'].innerHTML = renderWeekTasks(week);
  } else {
    const upcomingTasks = getUpcomingDeadlineTasks();
    el['weekly-subtitle'].textContent = upcomingTasks.length
      ? `接下來七天內有 ${upcomingTasks.length} 個活動即將截止計點。`
      : '接下來七天內沒有即將截止計點的活動。';
    el['current-week-tasks'].innerHTML = upcomingTasks.length
      ? renderTaskItems(upcomingTasks)
      : '<p class="empty-state">目前沒有進入七天截止提醒的活動。</p>';
  }
}

function renderWeekTabs() {
  el['week-tabs'].innerHTML = state.portal.weeks.map((week) => `
    <button class="week-tab" type="button" role="tab" aria-selected="${week.week === state.selectedWeek}" data-week="${week.week}">第 ${week.week} 週</button>
  `).join('');
}

function handleWeekTabClick(event) {
  const button = event.target.closest('[data-week]');
  if (!button) return;
  state.selectedWeek = Number(button.dataset.week);
  renderWeekTabs();
  renderWeekDetail();
}

function renderWeekDetail() {
  const week = state.portal.weeks[state.selectedWeek - 1];
  el['week-detail'].innerHTML = `<div class="task-grid">${renderWeekTasks(week)}</div>`;
}

function renderWeekTasks(week) {
  return renderTaskItems(getWeekTaskItems(week));
}

function getWeekTaskItems(week) {
  const tasks = [
    { startAt: week.grammar.releaseAt, deadlineAt: week.grammar.deadlineAt, render: () => courseTaskCard(week.grammar) },
    { startAt: week.tutoring.startAt, deadlineAt: week.tutoring.deadlineAt, render: () => tutoringTaskCard(week.tutoring) },
    { startAt: week.vocabulary.releaseAt, deadlineAt: week.vocabulary.deadlineAt, render: () => vocabularyTaskCard(week.vocabulary) }
  ];
  if (week.listening) {
    tasks.push({ startAt: week.listening.releaseAt, deadlineAt: week.listening.deadlineAt, render: () => courseTaskCard(week.listening) });
  }
  return tasks;
}

function renderTaskItems(tasks) {
  return [...tasks]
    .sort((a, b) => new Date(a.startAt) - new Date(b.startAt))
    .map((task) => task.render())
    .join('');
}

function getUpcomingDeadlineTasks() {
  const now = new Date(state.portal.generatedAt || Date.now());
  const cutoff = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  return state.portal.weeks
    .flatMap(getWeekTaskItems)
    .filter((task) => {
      const deadline = new Date(task.deadlineAt);
      return !Number.isNaN(deadline.getTime()) && deadline >= now && deadline <= cutoff;
    });
}

function courseTaskCard(task) {
  const isGrammar = task.type === 'grammar';
  const title = `${isGrammar ? '文法' : '聽力'}第 ${task.no} 堂`;
  const grammarLabel = task.status === 'closed' ? '練習（不計點）' : task.status === 'upcoming' ? '可提前作答' : '開始本回測驗';
  const grammarHref = `grammar.html?round=${task.no}${TESTING_MODE ? '&testing=1' : ''}`;
  const listeningDisabled = task.status !== 'open';
  const listeningLabel = task.status === 'closed' ? '回報已截止' : task.status === 'upcoming' ? '尚未開放' : '驗證資格／完成回報';
  return `
    <article class="task-card ${escapeHtml(task.type)}">
      <div class="task-topline"><h3>${title}</h3></div>
      <p>${isGrammar ? '文法測驗八回皆可作答；期限內提交才會計點。' : '有購買聽力課的學員，驗證資格後可觀看及回報。'}</p>
      <div class="task-date-list">
        <span><b>${isGrammar ? '計點開始' : '建議開始'}</b><time>${formatDate(task.releaseAt)}</time></span>
        <span><b>計點截止</b><time>${formatDateTime(task.deadlineAt)}</time></span>
      </div>
      <div class="task-actions">
        ${isGrammar
          ? `<a class="button button-small button-secondary" href="${COURSE_URL}" target="_blank" rel="noopener noreferrer">前往官網看課</a><a class="button button-small button-primary" href="${grammarHref}">${grammarLabel}</a>`
          : `<button class="button button-small button-primary" type="button" data-listening-access="${task.no}" ${listeningDisabled ? 'disabled' : ''}>${listeningLabel}</button>`}
      </div>
    </article>
  `;
}

function tutoringTaskCard(task) {
  const canEnter = task.status === 'available' && task.meetUrl;
  return `
    <article class="task-card tutoring">
      <div class="task-topline"><h3>補習日第 ${task.no} 次</h3></div>
      <p>每週三直播複習，由助教直接點名，不需自行回報。</p>
      <div class="task-date-list">
        <span><b>計點開始</b><time>${formatDateTime(task.startAt)}</time></span>
        <span><b>計點截止</b><time>${formatDateTime(task.deadlineAt)}</time></span>
      </div>
      <div class="task-actions">
        ${canEnter
          ? `<a class="button button-small button-secondary" href="${escapeAttribute(task.meetUrl)}" target="_blank" rel="noopener noreferrer">前往直播</a>`
          : `<button class="button button-small button-outline" type="button" disabled>${task.status === 'ended' ? '本次補習已結束' : '直播連結待公布'}</button>`}
      </div>
    </article>
  `;
}

function vocabularyTaskCard(task) {
  const demoSuffix = TESTING_MODE ? '&testing=1' : '';
  return `
    <article class="task-card vocabulary">
      <div class="task-topline"><h3>補充單字第 ${task.unit} 回</h3></div>
      <p>N3 單字字卡與小測驗，可提前練習後面的回次。</p>
      <div class="task-date-list">
        <span><b>計點開始</b><time>${formatDate(task.releaseAt)}</time></span>
        <span><b>計點截止</b><time>${formatDateTime(task.deadlineAt)}</time></span>
      </div>
      <div class="task-actions"><a class="button button-small button-primary" href="vocabulary.html?unit=${task.unit}${demoSuffix}" target="_blank" rel="noopener noreferrer">單字＋測驗</a></div>
    </article>
  `;
}

function renderTutoring() {
  el['tutoring-list'].innerHTML = state.portal.weeks.map(({ tutoring }) => {
    const canEnter = tutoring.status === 'available' && tutoring.meetUrl;
    return `
      <article class="compact-card">
        <div class="compact-card-top"><span class="unit-number">${tutoring.no}</span></div>
        <h3>補習日 ${tutoring.no}</h3>
        <p>${formatDateTime(tutoring.startAt)}</p>
        ${canEnter
          ? `<a class="button button-small button-secondary" href="${escapeAttribute(tutoring.meetUrl)}" target="_blank" rel="noopener noreferrer">前往直播</a>`
          : `<button class="button button-small button-outline" type="button" disabled>${tutoring.status === 'ended' ? '直播已結束' : '連結待公布'}</button>`}
      </article>
    `;
  }).join('');
}

function handleActionClick(event) {
  const button = event.target.closest('[data-listening-access]');
  if (button) openListeningDialog(Number(button.dataset.listeningAccess));
}

function openListeningDialog(taskNo) {
  el['listening-dialog-title'].textContent = `聽力第 ${taskNo} 堂`;
  el['listening-task-description'].textContent = '請先輸入 N3 學員編號驗證聽力課資格。看完課程後，可在同一視窗完成回報。';
  el['listening-task-no'].value = String(taskNo);
  el['listening-student-id'].value = '';
  el['listening-student-id'].readOnly = false;
  resetListeningVerification();
  setListeningMessage('');
  el['listening-dialog'].showModal();
  el['listening-student-id'].focus();
}

function resetListeningVerification() {
  state.listeningVerified = false;
  el['listening-access-panel'].hidden = true;
  el['listening-confirmed'].checked = false;
  el['listening-student-id'].readOnly = false;
  el['listening-submit'].textContent = '驗證聽力資格';
}

async function submitListeningForm(event) {
  event.preventDefault();
  const studentId = normalizeStudentId(el['listening-student-id'].value);
  if (!studentId) return setListeningMessage('請輸入正確的 N3 學員編號，例如 N3001。', 'error');

  if (!state.listeningVerified) {
    setButtonLoading(el['listening-submit'], true, '驗證中……');
    setListeningMessage('正在確認聽力課資格……');
    try {
      const data = TESTING_MODE
        ? { eligible: true, courseUrl: COURSE_URL }
        : await apiPost({ action: 'verify_listening_access', level: LEVEL, student_id: studentId }).then((result) => result.data);
      state.listeningVerified = true;
      el['listening-course-link'].href = data.courseUrl;
      el['listening-access-panel'].hidden = false;
      el['listening-student-id'].readOnly = true;
      el['listening-submit'].textContent = '我已看完，完成回報';
      setListeningMessage(TESTING_MODE ? 'Demo 資格驗證成功；不會寫入資料。' : '資格驗證成功，請前往官網觀看課程。', 'success');
    } catch (error) {
      setListeningMessage(error.message, 'error');
    } finally {
      el['listening-submit'].disabled = false;
      if (!state.listeningVerified) el['listening-submit'].textContent = '驗證聽力資格';
    }
    return;
  }

  if (!el['listening-confirmed'].checked) return setListeningMessage('請先勾選確認已看完本堂聽力課。', 'error');
  setButtonLoading(el['listening-submit'], true, '回報中……');
  setListeningMessage('正在登記聽力進度……');
  try {
    const result = TESTING_MODE
      ? { message: 'Demo 回報完成；本次沒有寫入後台。' }
      : await apiPost({
        action: 'report_listening',
        level: LEVEL,
        student_id: studentId,
        task_no: Number(el['listening-task-no'].value),
        confirmed: true
      });
    setListeningMessage(result.message, 'success');
    showToast(result.message);
    setTimeout(() => el['listening-dialog'].close(), 1200);
  } catch (error) {
    setListeningMessage(error.message, 'error');
  } finally {
    setButtonLoading(el['listening-submit'], false, '我已看完，完成回報');
  }
}

function normalizeStudentIdText(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').replace(/[^N0-9]/g, '').slice(0, 5);
}

function normalizeStudentId(value) {
  const normalized = normalizeStudentIdText(value);
  return /^N3\d{3}$/.test(normalized) ? normalized : '';
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric' }).format(new Date(value));
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '待設定';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function showTestingBanner() {
  if (!TESTING_MODE) return;
  el['testing-banner'].hidden = false;
  el['testing-banner'].innerHTML = `Demo 模式：正在預覽第 ${TEST_WEEK} 週，操作不會寫入後台。<a href="index.html">切換正式模式</a>`;
  document.querySelectorAll('a[href^="grammar.html"], a[href^="vocabulary.html"], a[href^="leaderboard.html"]').forEach((anchor) => {
    const url = new URL(anchor.getAttribute('href'), window.location.href);
    url.searchParams.set('testing', '1');
    anchor.setAttribute('href', `${url.pathname.split('/').pop()}${url.search}`);
  });
}

function setApiState(label, status) {
  el['api-state'].textContent = label;
  el['api-state'].className = `api-state ${status === 'online' ? 'is-online' : status === 'error' ? 'is-error' : ''}`;
}

function setListeningMessage(message, type = '') {
  el['listening-message'].textContent = message;
  el['listening-message'].className = `form-message ${type}`;
}

function setButtonLoading(button, loading, label) {
  button.disabled = loading;
  button.textContent = label;
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add('show');
  state.toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
}

function readPortalCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(PORTAL_CACHE_KEY));
    if (!cached?.data || Date.now() - Number(cached.savedAt) > PORTAL_CACHE_MAX_AGE) return null;
    return cached.data;
  } catch (error) {
    return null;
  }
}

function writePortalCache(portal) {
  try {
    localStorage.setItem(PORTAL_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), data: portal }));
  } catch (error) {
    // 無痕模式或瀏覽器停用儲存時，仍可使用即時資料。
  }
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#096;');
}
