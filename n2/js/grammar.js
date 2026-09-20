const API_URL = window.PORTAL_CONFIG.API_URL;
const LEVEL = 'N2';
const params = new URLSearchParams(window.location.search);
const DEMO_MODE = window.PORTAL_CONFIG.DEMO_MODE_ENABLED && params.get('testing') === '1';
const GRAMMAR_CACHE_MAX_AGE = 30 * 60 * 1000;

const state = {
  round: normalizeRound(params.get('round')),
  test: null,
  startedAt: '',
  toastTimer: null
};

const el = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  renderRoundSelector();
  loadGrammarTest();
});

function cacheElements() {
  [
    'testing-banner', 'round-selector', 'page-title', 'page-description', 'page-loading',
    'grammar-form', 'grammar-meta', 'grammar-sections', 'student-id',
    'submit-confirmed', 'submit-message', 'submit-button', 'grammar-result', 'toast'
  ].forEach((id) => { el[id] = document.getElementById(id); });
}

function bindEvents() {
  el['round-selector'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-round]');
    if (!button) return;
    selectRound(Number(button.dataset.round));
  });
  el['grammar-form'].addEventListener('submit', submitGrammarTest);
  el['student-id'].addEventListener('input', () => {
    el['student-id'].value = normalizeStudentIdText(el['student-id'].value);
  });
  el['testing-banner'].hidden = !DEMO_MODE;
}

async function apiGet(action, requestParams = {}) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({ action, ...requestParams }).toString();
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

function normalizeRound(value) {
  const round = Number(value);
  return Number.isInteger(round) && round >= 1 && round <= 8 ? round : 1;
}

function renderRoundSelector() {
  el['round-selector'].innerHTML = Array.from({ length: 8 }, (_, index) => {
    const round = index + 1;
    const selected = round === state.round;
    return `<button class="unit-select${selected ? ' is-active' : ''}" type="button" data-round="${round}" aria-pressed="${selected}">第 ${round} 回</button>`;
  }).join('');
}

function selectRound(round) {
  if (round === state.round) return;
  state.round = round;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set('round', String(round));
  if (DEMO_MODE) nextUrl.searchParams.set('testing', '1');
  history.replaceState(null, '', `${nextUrl.pathname}${nextUrl.search}`);
  renderRoundSelector();
  loadGrammarTest();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadGrammarTest() {
  state.test = null;
  state.startedAt = '';
  el['page-title'].textContent = `第 ${state.round} 回文法測驗`;
  el['page-description'].textContent = '閱讀本回文章並完成所有題目，送出後即完成本回進度登記。';
  el['page-loading'].hidden = false;
  el['page-loading'].className = 'learning-loading';
  el['page-loading'].textContent = `正在載入第 ${state.round} 回文法測驗……`;
  el['grammar-form'].hidden = true;
  el['grammar-result'].hidden = true;
  el['grammar-result'].innerHTML = '';
  setMessage('');

  try {
    const data = DEMO_MODE
      ? await loadDemoGrammarTest(state.round)
      : await loadCachedGrammarTest(state.round);
    if (!data.questions?.length) throw new Error('這回目前沒有測驗題目。');
    state.test = data;
    state.startedAt = new Date().toISOString();
    renderGrammarTest();
    el['page-loading'].hidden = true;
    el['grammar-form'].hidden = false;
  } catch (error) {
    el['page-loading'].className = 'learning-loading is-error';
    el['page-loading'].innerHTML = errorStateHtml(error);
  }
}

async function loadDemoGrammarTest(round) {
  const response = await fetch('assets/n2-grammar-demo.json?v=20260920-4');
  if (!response.ok) throw new Error('Demo 題庫載入失敗。');
  const payload = await response.json();
  const data = payload.units?.find((unit) => Number(unit.unit) === round);
  if (!data) throw new Error('Demo 題庫找不到這一回。');
  return data;
}

async function loadCachedGrammarTest(round) {
  const cached = readGrammarCache(round);
  if (cached) return cached;
  const data = await apiGet('grammar_test', { level: LEVEL, unit: round });
  writeGrammarCache(round, data);
  return data;
}

function readGrammarCache(round) {
  try {
    const cached = JSON.parse(localStorage.getItem(`n2-grammar-cache-v1-${round}`));
    if (!cached?.data || Date.now() - Number(cached.savedAt) > GRAMMAR_CACHE_MAX_AGE) return null;
    return cached.data;
  } catch (error) {
    return null;
  }
}

function writeGrammarCache(round, data) {
  try {
    localStorage.setItem(`n2-grammar-cache-v1-${round}`, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // 無痕模式或瀏覽器停用儲存時，仍可直接讀取 API。
  }
}

function renderGrammarTest() {
  const data = state.test;
  el['page-title'].textContent = data.title || `第 ${state.round} 回文法測驗`;
  document.title = `${data.title || `N2 文法測驗第 ${state.round} 回`}｜2026第2回JLPT特訓班`;
  el['grammar-meta'].innerHTML = `
    <span><b>等級</b>${escapeHtml(data.level)}</span>
    <span><b>回次</b>第 ${data.unit} 回</span>
    <span><b>題數</b>${data.questions.length} 題</span>
    <span><b>截止</b>${formatDateTime(data.deadlineAt)}</span>
  `;

  const sectionNumbers = [...new Set([
    ...data.contents.map((item) => Number(item.section_no)),
    ...data.questions.map((item) => Number(item.section_no))
  ])].filter(Number.isFinite).sort((a, b) => a - b);

  el['grammar-sections'].innerHTML = sectionNumbers.map((sectionNo) => {
    const contents = data.contents.filter((item) => Number(item.section_no) === sectionNo);
    const questions = data.questions.filter((item) => Number(item.section_no) === sectionNo);
    return `
      <section class="grammar-section" aria-labelledby="section-${sectionNo}-title">
        <div class="grammar-section-heading">
          <span>問題 ${sectionNo}</span>
          <small>${questions.length} 題</small>
        </div>
        <h2 class="sr-only" id="section-${sectionNo}-title">問題 ${sectionNo}</h2>
        <div class="grammar-reading">${contents.map(renderContentBlock).join('')}</div>
        <div class="grammar-question-list">${questions.map(renderQuestion).join('')}</div>
      </section>
    `;
  }).join('');
}

function renderContentBlock(item) {
  if (item.content_type === 'instruction') {
    return `<p class="grammar-instruction" lang="ja">${renderMultiline(item.content)}</p>`;
  }
  if (item.content_type === 'table_json') {
    return renderTableContent(item.content);
  }
  return `<div class="grammar-passage" lang="ja">${renderMultiline(item.content)}</div>`;
}

function renderTableContent(value) {
  try {
    const rows = JSON.parse(value);
    if (!Array.isArray(rows) || !rows.length) throw new Error('empty table');
    return `
      <div class="grammar-table-wrap">
        <table class="grammar-reading-table">
          <tbody>${rows.map((row) => `<tr>${(Array.isArray(row) ? row : [row]).map((cell) => `<td lang="ja">${renderMultiline(cell)}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    `;
  } catch (error) {
    return `<div class="grammar-passage" lang="ja">${renderMultiline(value)}</div>`;
  }
}

function renderQuestion(question, index) {
  const options = [question.option_1, question.option_2, question.option_3, question.option_4];
  const labels = ['1', '2', '3', '4'];
  return `
    <fieldset class="grammar-question" id="question-${escapeAttribute(question.question_id)}" data-question-id="${escapeAttribute(question.question_id)}">
      <legend>
        <span class="grammar-question-number">${question.question_no || index + 1}</span>
        <span lang="ja">${renderMultiline(question.prompt)}</span>
      </legend>
      <div class="grammar-options">
        ${options.map((option, optionIndex) => `
          <label class="grammar-option">
            <input type="radio" name="${escapeAttribute(question.question_id)}" value="${optionIndex + 1}">
            <span><b>${labels[optionIndex]}</b><span lang="ja">${escapeHtml(option)}</span></span>
          </label>
        `).join('')}
      </div>
    </fieldset>
  `;
}

async function submitGrammarTest(event) {
  event.preventDefault();
  if (!state.test) return;

  clearQuestionErrors();
  const studentId = normalizeStudentId(el['student-id'].value);
  if (!studentId) {
    setMessage('請輸入正確的 N2 學員編號，例如 N2001。', 'error');
    el['student-id'].focus();
    return;
  }
  if (!el['submit-confirmed'].checked) {
    setMessage('請先勾選確認已閱讀並完成全部題目。', 'error');
    el['submit-confirmed'].focus();
    return;
  }

  const answers = {};
  const unanswered = [];
  state.test.questions.forEach((question) => {
    const selected = el['grammar-form'].querySelector(`input[name="${cssEscape(question.question_id)}"]:checked`);
    if (!selected) {
      unanswered.push(question);
      document.querySelector(`[data-question-id="${cssEscape(question.question_id)}"]`)?.classList.add('has-error');
    } else {
      answers[question.question_id] = Number(selected.value);
    }
  });

  if (unanswered.length) {
    const first = unanswered[0];
    setMessage(`還有 ${unanswered.length} 題尚未作答，請完成後再送出。`, 'error');
    document.querySelector(`[data-question-id="${cssEscape(first.question_id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  setButtonLoading(true, '正在提交……');
  setMessage(DEMO_MODE ? '正在完成 Demo 作答流程……' : '正在儲存作答並登記文法進度……');
  try {
    if (DEMO_MODE) {
      showDemoResult();
      disableCompletedForm();
      setMessage('Demo 流程完成；本次沒有寫入任何資料。', 'success');
      showToast('Demo 完成，沒有寫入 Google Sheet');
      return;
    }
    const result = await apiPost({
      action: 'submit_grammar_test',
      level: LEVEL,
      student_id: studentId,
      unit: state.round,
      started_at: state.startedAt,
      answers
    });
    showResult(result.data, result.message);
    disableCompletedForm();
    setMessage('作答與進度已成功保存。', 'success');
    showToast('本回文法進度已完成登記');
  } catch (error) {
    setMessage(error.message, 'error');
  } finally {
    if (el['grammar-result'].hidden) {
      setButtonLoading(false, '提交本回測驗');
    } else {
      el['submit-button'].disabled = true;
      el['submit-button'].textContent = '本次作答已提交';
    }
  }
}

function showDemoResult() {
  el['grammar-result'].innerHTML = `
    <span class="result-kicker">Demo 模式</span>
    <h2>第 ${state.round} 回測驗流程完成</h2>
    <p>正式模式會由 GAS 計算答對題數、保存每題作答，並將 N2 點名表的「文法${state.round}」打勾。</p>
    <p class="result-note">這次展示不計分、不驗證學員名單，也不會寫入 Google Sheet。</p>
    <div class="grammar-result-actions">
      <a class="button button-secondary" href="index.html?testing=1&week=${state.round}">返回 Demo 學習專區</a>
      ${state.round < 8 ? `<a class="button button-outline" href="grammar.html?round=${state.round + 1}&testing=1">展示下一回</a>` : ''}
    </div>
  `;
  el['grammar-result'].hidden = false;
  el['grammar-result'].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function showResult(data, message) {
  const wrongIds = new Set(data.wrongQuestionIds || []);
  state.test.questions.forEach((question) => {
    const card = document.querySelector(`[data-question-id="${cssEscape(question.question_id)}"]`);
    if (card && wrongIds.has(question.question_id)) card.classList.add('is-wrong');
  });
  el['grammar-result'].innerHTML = `
    <span class="result-kicker">第 ${state.round} 回完成</span>
    <h2>${escapeHtml(message || '文法進度已完成登記')}</h2>
    <strong>${data.correctCount} / ${data.totalCount}</strong>
    <p>答對率 ${data.accuracyPercent}%${data.lateSubmission ? '；已超過本回期限，作答已保存但本次不計點。' : data.alreadyCompleted ? '；本回先前已完成，因此不會重複積點。' : '；本回文法已登記完成並計點。'}</p>
    ${wrongIds.size ? `<p class="result-note">畫面已標示本次答錯的 ${wrongIds.size} 題，可往上重新檢視。</p>` : '<p class="result-note">全部答對，做得很好！</p>'}
    <div class="grammar-result-actions">
      <a class="button button-secondary" href="index.html">返回 N2 學習專區</a>
      ${state.round < 8 ? `<a class="button button-outline" href="grammar.html?round=${state.round + 1}">查看下一回</a>` : ''}
    </div>
  `;
  el['grammar-result'].hidden = false;
  el['grammar-result'].scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function disableCompletedForm() {
  el['grammar-form'].querySelectorAll('input, button').forEach((control) => { control.disabled = true; });
}

function clearQuestionErrors() {
  document.querySelectorAll('.grammar-question.has-error').forEach((card) => card.classList.remove('has-error'));
}

function normalizeStudentIdText(value) {
  return String(value || '').toUpperCase().replace(/\s+/g, '').replace(/[^N0-9]/g, '').slice(0, 5);
}

function normalizeStudentId(value) {
  const normalized = normalizeStudentIdText(value);
  return /^N2\d{3}$/.test(normalized) ? normalized : '';
}

function errorStateHtml(error) {
  const messages = {
    TASK_NOT_OPEN: '這回文法測驗尚未開放，請依照課程進度再回來作答。',
    DEADLINE_PASSED: '這回文法測驗的進度登記已截止。',
    QUIZ_NOT_FOUND: '這回目前沒有測驗題目。'
  };
  return `<strong>${escapeHtml(messages[error.code] || error.message)}</strong><button class="button button-small button-outline" type="button" onclick="location.reload()">重新載入</button>`;
}

function formatDateTime(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}

function renderMultiline(value) {
  return escapeHtml(value).replace(/\n/g, '<br>');
}

function setMessage(message, type = '') {
  el['submit-message'].textContent = message;
  el['submit-message'].className = `form-message ${type}`;
}

function setButtonLoading(loading, label) {
  el['submit-button'].disabled = loading;
  el['submit-button'].textContent = label;
}

function showToast(message) {
  clearTimeout(state.toastTimer);
  el.toast.textContent = message;
  el.toast.classList.add('show');
  state.toastTimer = setTimeout(() => el.toast.classList.remove('show'), 3200);
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

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
