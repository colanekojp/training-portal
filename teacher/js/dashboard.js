const config = window.TEACHER_DASHBOARD_CONFIG;
const params = new URLSearchParams(window.location.search);
const demoMode = !config.API_URL || params.get('demo') === '1';
const filePreviewMode = window.location.protocol === 'file:';
const roundCacheTtlMs = 4 * 60 * 1000;
const state = {
  level: normalizeLevel(params.get('level')),
  unit: normalizeUnit(params.get('round')),
  data: null,
  sort: 'wrong',
  selectedQuestionId: '',
  requestId: 0
};
const el = {};

document.addEventListener('DOMContentLoaded', init);

function init() {
  cacheElements();
  bindEvents();
  renderLevelTabs();
  renderRoundTabs();
  el['preview-banner'].hidden = !demoMode;
  showDashboard();
  if (filePreviewMode) {
    setError(new Error('請不要直接雙點 index.html；請以 http://127.0.0.1:4173/teacher/ 開啟，或使用正式發布後的 HTTPS 網址。'));
    return;
  }
  loadRound();
}

function cacheElements() {
  [
    'dashboard', 'preview-banner', 'level-tabs', 'round-tabs', 'loading-panel', 'error-panel',
    'dashboard-content', 'updated-at', 'refresh-button', 'status-pill', 'round-title',
    'round-note', 'participant-count', 'roster-summary', 'completion-rate',
    'question-count', 'sample-status', 'sample-detail', 'sort-select',
    'question-list', 'empty-state', 'detail-panel'
  ].forEach((id) => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el['level-tabs'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-level]');
    if (!button) return;
    selectLevel(button.dataset.level);
  });
  el['round-tabs'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-unit]');
    if (!button) return;
    selectUnit(Number(button.dataset.unit));
  });
  el['sort-select'].addEventListener('change', () => {
    state.sort = el['sort-select'].value;
    renderQuestionList();
  });
  el['question-list'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-question-id]');
    if (!button) return;
    selectQuestion(button.dataset.questionId);
  });
  el['refresh-button'].addEventListener('click', refreshStats);
}

function normalizeLevel(value) {
  const level = String(value || config.DEFAULT_LEVEL || 'N1').trim().toUpperCase();
  return config.LEVELS.includes(level) ? level : config.DEFAULT_LEVEL;
}

function showDashboard() {
  el.dashboard.hidden = false;
}

function normalizeUnit(value) {
  const unit = Number(value);
  return Number.isInteger(unit) && unit >= 1 && unit <= 8 ? unit : 1;
}

function renderLevelTabs() {
  el['level-tabs'].querySelectorAll('[data-level]').forEach((button) => {
    const active = button.dataset.level === state.level;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
    if (active) button.setAttribute('aria-current', 'page');
    else button.removeAttribute('aria-current');
  });
}

function selectLevel(levelValue) {
  const level = normalizeLevel(levelValue);
  if (level === state.level) return;
  state.level = level;
  state.selectedQuestionId = '';
  const url = new URL(window.location.href);
  url.searchParams.set('level', level);
  url.searchParams.set('round', String(state.unit));
  history.replaceState(null, '', `${url.pathname}${url.search}`);
  renderLevelTabs();
  loadRound();
}

function renderRoundTabs() {
  el['round-tabs'].innerHTML = Array.from({ length: 8 }, (_, index) => {
    const unit = index + 1;
    return `<button class="round-tab${unit === state.unit ? ' is-active' : ''}" type="button" data-unit="${unit}" aria-pressed="${unit === state.unit}">第 ${unit} 回</button>`;
  }).join('');
}

function selectUnit(unit) {
  if (unit === state.unit) return;
  state.unit = unit;
  state.selectedQuestionId = '';
  const url = new URL(window.location.href);
  url.searchParams.set('round', String(unit));
  history.replaceState(null, '', `${url.pathname}${url.search}`);
  renderRoundTabs();
  loadRound();
}

async function loadRound() {
  const requestId = ++state.requestId;
  setLoading(true);
  try {
    const data = demoMode
      ? await loadDemoRound(state.level, state.unit)
      : await fetchLiveStats(state.level, state.unit);
    if (requestId !== state.requestId) return;
    state.data = data;
    state.selectedQuestionId = '';
    renderDashboard();
  } catch (error) {
    if (requestId !== state.requestId) return;
    setError(error);
    throw error;
  }
}

async function loadDemoRound(level, unit) {
  const response = await fetch(config.DEMO_DATA_URL, { cache: 'no-store' });
  if (!response.ok) throw new Error('預覽資料載入失敗');
  const payload = await response.json();
  const found = level === 'N1'
    ? payload.units.find((item) => Number(item.unit) === unit)
    : null;
  if (found) return { ...found, level };
  return {
    level, unit, title: `${level} 第 ${unit} 回文法測驗`, dataStatus: 'upcoming',
    rosterCount: 0, participantCount: 0, completedAttemptCount: 0, completionRate: 0,
    questionCount: 0, generatedAt: payload.generatedAt, questionStats: []
  };
}

async function fetchLiveStats(level, unit) {
  const cacheKey = `teacher-dashboard-${level}-${unit}`;
  try {
    const cached = JSON.parse(sessionStorage.getItem(cacheKey));
    if (cached && Date.now() - Number(cached.savedAt) < roundCacheTtlMs) {
      return cached.data;
    }
  } catch (_) {
    // file:// 或隱私模式禁用儲存時直接讀取 API。
  }

  const data = await apiGet({
    action: 'teacher_grammar_stats',
    level,
    unit
  });
  try {
    sessionStorage.setItem(cacheKey, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (_) {
    // 瀏覽器禁用儲存時仍可正常使用。
  }
  return data;
}

async function apiGet(payload, timeoutMs = 60000) {
  const url = new URL(config.API_URL);
  Object.entries(payload).forEach(([key, value]) => url.searchParams.set(key, String(value)));
  url.searchParams.set('_', String(Date.now()));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`API 連線失敗（${response.status}）`);
    const result = await response.json();
    if (!result || !result.ok) {
      const error = new Error(result?.message || '系統目前無法讀取統計');
      error.code = result?.code;
      throw error;
    }
    return result.data;
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('API 連線逾時，請再試一次');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function refreshStats() {
  el['refresh-button'].disabled = true;
  el['refresh-button'].textContent = demoMode ? '重新載入中…' : '背景統計更新中…';
  try {
    if (!demoMode) {
      await apiGet({ action: 'teacher_refresh', level: state.level }, 60000);
      try {
        Object.keys(sessionStorage)
          .filter((key) => key.startsWith(`teacher-dashboard-${state.level}-`))
          .forEach((key) => sessionStorage.removeItem(key));
      } catch (_) {
        // 無儲存權限不影響統計更新。
      }
    }
    await loadRound();
  } catch (error) {
    setError(error);
  } finally {
    el['refresh-button'].disabled = false;
    el['refresh-button'].textContent = '更新統計';
  }
}

function setLoading(loading) {
  el['loading-panel'].hidden = !loading;
  el['loading-panel'].textContent = `正在讀取 ${state.level} 第 ${state.unit} 回統計……`;
  el['error-panel'].hidden = true;
  if (loading) el['dashboard-content'].hidden = true;
}

function setError(error) {
  el['loading-panel'].hidden = true;
  el['dashboard-content'].hidden = true;
  el['error-panel'].hidden = false;
  el['error-panel'].innerHTML = `<strong>統計載入失敗</strong><p>${escapeHtml(error.message)}</p>`;
}

function renderDashboard() {
  const data = state.data;
  setLoading(false);
  el['dashboard-content'].hidden = false;
  el['updated-at'].textContent = data.generatedAt
    ? `統計更新：${formatDateTime(data.generatedAt)}`
    : '尚未產生統計時間';
  el['round-title'].textContent = data.title || `${state.level} 第 ${data.unit} 回文法測驗`;
  document.title = `${state.level} 老師檢閱｜JLPT 特訓班`;
  renderStatus(data);
  el['participant-count'].textContent = `${number(data.participantCount)} 人`;
  el['roster-summary'].textContent = data.rosterCount
    ? `全班 ${number(data.rosterCount)} 人` : '班級總人數尚未設定';
  el['completion-rate'].textContent = data.rosterCount
    ? `${number(data.completionRate)}%` : '–';
  el['question-count'].textContent = `${number(data.questionCount)} 題`;
  const enough = Number(data.participantCount) >= 10;
  el['sample-status'].textContent = enough ? '可初步參考' : '樣本不足';
  el['sample-status'].className = `metric-status ${enough ? 'is-ready' : 'is-warning'}`;
  el['sample-detail'].textContent = enough
    ? '仍建議搭配截止狀態判讀' : '至少 10 人後再比較較穩定';
  renderQuestionList();
  renderQuestionDetail(null);
}

function renderStatus(data) {
  const labels = {
    preliminary: ['暫定結果', '截止日前的資料會持續變動。'],
    final: ['截止後結果', '本回已截止，可作為直播講解依據。'],
    upcoming: ['尚未開始', '本回目前尚未進入作答期間。']
  };
  const [label, note] = labels[data.dataStatus] || ['統計資料', '請依最後更新時間判讀。'];
  el['status-pill'].textContent = label;
  el['status-pill'].className = `status-pill is-${data.dataStatus || 'default'}`;
  el['round-note'].textContent = note;
}

function renderQuestionList() {
  const questions = sortedQuestions(state.data?.questionStats || []);
  el['empty-state'].hidden = questions.length > 0 && questions.some((item) => Number(item.answeredCount) > 0);
  el['question-list'].hidden = !el['empty-state'].hidden;
  if (!questions.length) {
    el['question-list'].innerHTML = '';
    return;
  }

  el['question-list'].innerHTML = questions.map((item, index) => {
    const selected = item.questionId === state.selectedQuestionId;
    const rate = Math.max(0, Math.min(100, Number(item.errorRate) || 0));
    return `
      <button class="question-row${selected ? ' is-selected' : ''}" type="button" data-question-id="${escapeAttribute(item.questionId)}" aria-pressed="${selected}">
        <span class="rank">${state.sort === 'number' ? `Q${number(item.questionNo)}` : index + 1}</span>
        <span class="question-copy">
          <strong><span>第 ${number(item.questionNo)} 題</span>${escapeHtml(item.prompt || '')}</strong>
          <span class="rate-track"><i style="width:${rate}%"></i></span>
        </span>
        <span class="question-stat"><b>${number(item.wrongCount)}</b><small>人答錯</small></span>
        <span class="question-stat rate"><b>${number(item.errorRate)}%</b><small>${number(item.answeredCount)} 人作答</small></span>
        <span class="row-arrow" aria-hidden="true">›</span>
      </button>`;
  }).join('');
}

function sortedQuestions(questions) {
  return [...questions].sort((a, b) => {
    if (state.sort === 'rate') {
      return Number(b.errorRate) - Number(a.errorRate)
        || Number(b.wrongCount) - Number(a.wrongCount)
        || Number(a.questionNo) - Number(b.questionNo);
    }
    if (state.sort === 'number') return Number(a.questionNo) - Number(b.questionNo);
    return Number(b.wrongCount) - Number(a.wrongCount)
      || Number(b.errorRate) - Number(a.errorRate)
      || Number(a.questionNo) - Number(b.questionNo);
  });
}

function selectQuestion(questionId) {
  state.selectedQuestionId = questionId;
  renderQuestionList();
  const question = state.data.questionStats.find((item) => item.questionId === questionId);
  renderQuestionDetail(question);
  if (window.matchMedia('(max-width: 920px)').matches) {
    el['detail-panel'].scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

function renderQuestionDetail(question) {
  if (!question) {
    el['detail-panel'].innerHTML = `
      <div class="detail-placeholder">
        <span>←</span><strong>請選一題查看詳細統計</strong>
        <p>會顯示完整題目、正確答案與最常被選的錯誤答案。</p>
      </div>`;
    return;
  }

  const counts = Array.isArray(question.selectedCounts) ? question.selectedCounts : [0, 0, 0, 0];
  el['detail-panel'].innerHTML = `
    <div class="detail-head">
      <span>問題 ${number(question.sectionNo)}・第 ${number(question.questionNo)} 題</span>
      <strong>${number(question.wrongCount)} 人答錯・錯誤率 ${number(question.errorRate)}%</strong>
    </div>
    <h3 lang="ja">${escapeHtml(question.prompt || '')}</h3>
    <div class="option-list">
      ${(question.options || []).map((option, index) => {
        const optionNo = index + 1;
        const correct = optionNo === Number(question.correctOption);
        const commonWrong = optionNo === Number(question.mostCommonWrongOption) && !correct;
        const selectedCount = Number(counts[index]) || 0;
        const selectedRate = Number(question.answeredCount)
          ? Math.round(selectedCount / Number(question.answeredCount) * 1000) / 10 : 0;
        return `
          <div class="option-row${correct ? ' is-correct' : ''}${commonWrong ? ' is-common-wrong' : ''}">
            <span class="option-number">${optionNo}</span>
            <span class="option-copy" lang="ja">${escapeHtml(option || '')}</span>
            <span class="option-count">${selectedCount} 人<br><small>${selectedRate}%</small></span>
            ${correct ? '<em>正解</em>' : commonWrong ? '<em>最多人誤選</em>' : ''}
          </div>`;
      }).join('')}
    </div>
    <p class="detail-insight">${question.mostCommonWrongOption
      ? `最多人誤選第 ${number(question.mostCommonWrongOption)} 項，共 ${number(question.mostCommonWrongCount)} 人。`
      : '目前沒有錯誤選項資料。'}</p>`;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toLocaleString('zh-TW', { maximumFractionDigits: 1 }) : '0';
}

function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value || '');
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;').replaceAll("'", '&#039;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll('`', '&#096;');
}
