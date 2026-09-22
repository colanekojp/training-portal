const API_URL = window.PORTAL_CONFIG.API_URL;
const COURSE_URL = 'https://colanekojp.com.tw/member_course/';
const LEARNING_CACHE_MAX_AGE = 10 * 60 * 1000;
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const TESTING_MODE = window.PORTAL_CONFIG.DEMO_MODE_ENABLED && PAGE_PARAMS.get('testing') === '1';

const state = {
  unit: 1,
  items: [],
  index: 0,
  questions: [],
  toastTimer: null
};

const el = {};

document.addEventListener('DOMContentLoaded', () => {
  cacheElements();
  bindEvents();
  const requestedUnit = Number(new URLSearchParams(location.search).get('unit'));
  state.unit = requestedUnit >= 1 && requestedUnit <= 8 ? requestedUnit : 1;
  renderUnitSelector();
  loadVocabulary();
});

function cacheElements() {
  [
    'testing-banner', 'unit-selector', 'page-loading', 'study-panel', 'study-title', 'show-quiz',
    'vocabulary-progress-text', 'vocabulary-progress-bar', 'flashcard',
    'flashcard-word', 'flashcard-reading', 'flashcard-meaning',
    'flashcard-example-ja', 'flashcard-example-zh', 'vocabulary-prev',
    'vocabulary-next', 'vocabulary-student-id', 'complete-vocabulary',
    'start-quiz', 'vocabulary-message', 'quiz-panel', 'quiz-title',
    'back-to-study', 'quiz-loading', 'quiz-form', 'quiz-questions',
    'quiz-student-id', 'quiz-submit', 'quiz-message', 'quiz-result', 'toast'
  ].forEach((id) => { el[id] = document.getElementById(id); });
  el['testing-banner'].hidden = !TESTING_MODE;
}

function bindEvents() {
  el['unit-selector'].addEventListener('click', (event) => {
    const button = event.target.closest('[data-unit]');
    if (!button) return;
    selectUnit(Number(button.dataset.unit));
  });
  el.flashcard.addEventListener('click', () => el.flashcard.classList.toggle('is-flipped'));
  el['vocabulary-prev'].addEventListener('click', () => moveCard(-1));
  el['vocabulary-next'].addEventListener('click', () => moveCard(1));
  el['complete-vocabulary'].addEventListener('click', completeVocabulary);
  el['show-quiz'].addEventListener('click', showQuiz);
  el['start-quiz'].addEventListener('click', showQuiz);
  el['back-to-study'].addEventListener('click', showStudy);
  el['quiz-form'].addEventListener('submit', submitQuiz);
  [el['vocabulary-student-id'], el['quiz-student-id']].forEach((input) => {
    input.addEventListener('input', () => {
      input.value = input.value.toUpperCase().replace(/\s+/g, '');
    });
  });
}

async function apiGet(action, params = {}) {
  const url = new URL(API_URL);
  url.search = new URLSearchParams({ action, ...params }).toString();
  const response = await fetch(url.toString(), { redirect: 'follow' });
  if (!response.ok) throw new Error(`API 連線失敗（${response.status}）`);
  const result = await response.json();
  if (!result.ok) throw new Error(result.message || '系統目前無法處理');
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
  if (!result.ok) throw new Error(result.message || '系統目前無法處理');
  return result;
}

function renderUnitSelector() {
  el['unit-selector'].innerHTML = Array.from({ length: 8 }, (_, index) => {
    const unit = index + 1;
    return `<button class="unit-select${unit === state.unit ? ' is-active' : ''}" type="button" data-unit="${unit}" aria-pressed="${unit === state.unit}">第 ${unit} 回</button>`;
  }).join('');
}

async function selectUnit(unit) {
  if (unit === state.unit) return;
  state.unit = unit;
  history.replaceState(null, '', `?unit=${unit}${TESTING_MODE ? '&testing=1' : ''}`);
  renderUnitSelector();
  showStudy();
  await loadVocabulary();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function loadVocabulary() {
  state.items = [];
  state.index = 0;
  state.questions = [];
  el['page-loading'].hidden = false;
  el['page-loading'].textContent = `正在載入第 ${state.unit} 回單字……`;
  el['study-panel'].hidden = true;
  el['quiz-panel'].hidden = true;
  setMessage(el['vocabulary-message'], '');
  const cachedItems = readLearningCache('vocabulary', state.unit);
  if (cachedItems?.length) {
    state.items = cachedItems;
    el['study-title'].textContent = `第 ${state.unit} 回單字背誦`;
    el['page-loading'].hidden = true;
    el['study-panel'].hidden = false;
    renderCard();
    return;
  }
  try {
    const data = await apiGet('vocabulary', { level: 'N2', unit: state.unit });
    if (!data.items.length) throw new Error('這回目前沒有單字資料。');
    state.items = data.items;
    writeLearningCache('vocabulary', state.unit, data.items);
    el['study-title'].textContent = `第 ${state.unit} 回單字背誦`;
    el['page-loading'].hidden = true;
    el['study-panel'].hidden = false;
    renderCard();
  } catch (error) {
    el['page-loading'].textContent = error.message;
  }
}

function renderCard() {
  const item = state.items[state.index];
  const current = state.index + 1;
  const total = state.items.length;
  el.flashcard.classList.remove('is-flipped');
  el['flashcard-word'].textContent = item.word;
  el['flashcard-reading'].textContent = item.reading || '—';
  el['flashcard-meaning'].textContent = item.meaning;
  el['flashcard-example-ja'].textContent = item.example_ja || '';
  el['flashcard-example-zh'].textContent = item.example_zh || '';
  el['vocabulary-progress-text'].textContent = `${current} / ${total}`;
  el['vocabulary-progress-bar'].style.width = `${(current / total) * 100}%`;
  el['vocabulary-prev'].disabled = state.index === 0;
  el['vocabulary-next'].disabled = state.index === total - 1;
}

function moveCard(step) {
  const next = state.index + step;
  if (next < 0 || next >= state.items.length) return;
  state.index = next;
  renderCard();
}

async function completeVocabulary() {
  const studentId = normalizeStudentId(el['vocabulary-student-id'].value);
  if (!studentId) return setMessage(el['vocabulary-message'], '請輸入正確的 N2 學員編號，例如 N2001。', 'error');
  if (TESTING_MODE) {
    setMessage(el['vocabulary-message'], 'Demo 登記完成；本次沒有寫入 Google Sheet。', 'success');
    showToast('Demo 完成，沒有寫入後台');
    return;
  }
  setButtonLoading(el['complete-vocabulary'], true, '登記中……');
  setMessage(el['vocabulary-message'], '正在登記……');
  try {
    const result = await apiPost({
      action: 'complete_vocabulary',
      level: 'N2',
      student_id: studentId,
      unit: state.unit
    });
    setMessage(el['vocabulary-message'], result.message, 'success');
    showToast(result.message);
  } catch (error) {
    setMessage(el['vocabulary-message'], error.message, 'error');
  } finally {
    setButtonLoading(el['complete-vocabulary'], false, '登記單字完成');
  }
}

async function showQuiz() {
  el['quiz-panel'].hidden = false;
  el['study-panel'].hidden = true;
  el['quiz-title'].textContent = `第 ${state.unit} 回單字測驗`;
  el['quiz-student-id'].value = el['vocabulary-student-id'].value;
  el['quiz-result'].hidden = true;
  setMessage(el['quiz-message'], '');
  if (state.questions.length) {
    el['quiz-loading'].hidden = true;
    el['quiz-form'].hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  const cachedQuestions = readLearningCache('quiz', state.unit);
  if (cachedQuestions?.length) {
    state.questions = cachedQuestions;
    renderQuestions();
    el['quiz-loading'].hidden = true;
    el['quiz-form'].hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }
  el['quiz-loading'].hidden = false;
  el['quiz-loading'].textContent = '正在載入測驗……';
  el['quiz-form'].hidden = true;
  try {
    const data = await apiGet('quiz', { level: 'N2', unit: state.unit });
    if (!data.questions.length) throw new Error('這回目前沒有測驗題。');
    state.questions = data.questions;
    writeLearningCache('quiz', state.unit, data.questions);
    renderQuestions();
    el['quiz-loading'].hidden = true;
    el['quiz-form'].hidden = false;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (error) {
    el['quiz-loading'].textContent = error.message;
  }
}

function readLearningCache(type, unit) {
  try {
    const cached = JSON.parse(localStorage.getItem(`n2-${type}-cache-v1-${unit}`));
    if (!cached || Date.now() - Number(cached.savedAt) > LEARNING_CACHE_MAX_AGE) return null;
    return cached.data;
  } catch (error) {
    return null;
  }
}

function writeLearningCache(type, unit, data) {
  try {
    localStorage.setItem(`n2-${type}-cache-v1-${unit}`, JSON.stringify({ savedAt: Date.now(), data }));
  } catch (error) {
    // 瀏覽器停用儲存功能時，改由 API 正常讀取。
  }
}

function showStudy() {
  el['quiz-panel'].hidden = true;
  el['study-panel'].hidden = !state.items.length;
  if (!state.items.length) el['page-loading'].hidden = false;
  el['vocabulary-student-id'].value = el['quiz-student-id'].value;
}

function renderQuestions() {
  const labels = ['①', '②', '③', '④'];
  el['quiz-questions'].innerHTML = state.questions.map((question, index) => {
    const options = [question.option_a, question.option_b, question.option_c, question.option_d];
    return `
      <fieldset class="quiz-question" data-question-id="${escapeHtml(question.question_id)}">
        <legend><span class="section-kicker">第 ${index + 1} 題</span><br><span lang="ja">${escapeHtml(question.question)}</span></legend>
        <div class="quiz-options">
          ${options.map((option, optionIndex) => `
            <label class="quiz-option">
              <input type="radio" name="${escapeHtml(question.question_id)}" value="${optionIndex + 1}">
              <span><strong>${labels[optionIndex]}</strong> <span lang="ja">${escapeHtml(option)}</span></span>
            </label>
          `).join('')}
        </div>
      </fieldset>`;
  }).join('');
}

async function submitQuiz(event) {
  event.preventDefault();
  const studentId = normalizeStudentId(el['quiz-student-id'].value);
  if (!studentId) return setMessage(el['quiz-message'], '請輸入正確的 N2 學員編號，例如 N2001。', 'error');
  const answers = {};
  for (const question of state.questions) {
    const selected = el['quiz-form'].querySelector(`input[name="${cssEscape(question.question_id)}"]:checked`);
    if (!selected) return setMessage(el['quiz-message'], `第 ${question.question_no} 題尚未作答。`, 'error');
    answers[question.question_id] = Number(selected.value);
  }
  setButtonLoading(el['quiz-submit'], true, '計分中……');
  setMessage(el['quiz-message'], '正在提交並計算結果……');
  try {
    if (TESTING_MODE) {
      el['quiz-result'].innerHTML = `
        <span>第 ${state.unit} 回 Demo 測驗完成</span>
        <p>正式模式會由 GAS 計分並保存作答；這次展示不計分，也不會寫入 Google Sheet。</p>`;
      el['quiz-result'].hidden = false;
      setMessage(el['quiz-message'], 'Demo 流程完成。', 'success');
      showToast('Demo 測驗完成，沒有寫入後台');
      return;
    }
    const result = await apiPost({ action: 'submit_quiz', level: 'N2', student_id: studentId, unit: state.unit, answers });
    const data = result.data;
    const questionResults = Array.isArray(data.questionResults) ? data.questionResults : [];
    const wrongCount = Number(data.totalCount) - Number(data.correctCount);
    applyQuizFeedback(questionResults);
    el['quiz-result'].innerHTML = `
      <span class="result-kicker">第 ${state.unit} 回測驗完成</span>
      <strong>${data.correctCount} / ${data.totalCount}</strong>
      <p>答對率 ${data.accuracyPercent}%</p>
      ${wrongCount ? `<p class="result-note">答對 ${data.correctCount} 題、答錯 ${wrongCount} 題。畫面已用顏色標示你的答案與正確答案，可往上逐題檢視。</p>` : '<p class="result-note">全部答對，做得很好！每一題都已用綠色標示。</p>'}
      <aside class="grammar-course-cta">
        <strong>想把單字記得更熟、用得更準嗎？</strong>
        <p>回到王可樂日語課程繼續複習，把今天答錯的單字真正變成你的實力！</p>
        <a class="button button-primary" href="${COURSE_URL}" target="_blank" rel="noopener noreferrer">前往官網看課程</a>
      </aside>`;
    el['quiz-result'].hidden = false;
    el['quiz-questions'].querySelectorAll('input').forEach((input) => { input.disabled = true; });
    el['quiz-result'].scrollIntoView({ behavior: 'smooth', block: 'center' });
    setMessage(el['quiz-message'], '測驗結果已記錄。', 'success');
    showToast('測驗結果已記錄');
  } catch (error) {
    setMessage(el['quiz-message'], error.message, 'error');
  } finally {
    if (el['quiz-result'].hidden) {
      setButtonLoading(el['quiz-submit'], false, '提交測驗');
    } else {
      el['quiz-submit'].disabled = true;
      el['quiz-submit'].textContent = '本次測驗已提交';
    }
  }
}

function applyQuizFeedback(results) {
  const byId = new Map(results.map((item) => [item.questionId, item]));
  state.questions.forEach((question) => {
    const result = byId.get(question.question_id);
    const card = document.querySelector(`[data-question-id="${cssEscape(question.question_id)}"]`);
    if (!card || !result) return;
    const selectedOption = Number(result.selectedOption);
    const correctOption = Number(result.correctOption);
    const isCorrect = Boolean(result.isCorrect);
    card.classList.add(isCorrect ? 'is-correct' : 'is-wrong');
    card.querySelectorAll('.quiz-option').forEach((option, index) => {
      const optionNo = index + 1;
      if (optionNo === correctOption) option.classList.add('is-answer-correct');
      if (optionNo === selectedOption && optionNo !== correctOption) option.classList.add('is-answer-wrong');
    });
    const options = [question.option_a, question.option_b, question.option_c, question.option_d];
    const selectedText = options[selectedOption - 1] || '';
    const correctText = options[correctOption - 1] || '';
    card.insertAdjacentHTML('beforeend', `
      <div class="quiz-question-feedback ${isCorrect ? 'is-correct' : 'is-wrong'}" aria-live="polite">
        <strong>${isCorrect ? '答對了' : '這題答錯了'}</strong>
        <span>你的答案：${selectedOption}. ${escapeHtml(selectedText)}</span>
        <span>正確答案：${correctOption}. ${escapeHtml(correctText)}</span>
      </div>
    `);
  });
}

function normalizeStudentId(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, '');
  return /^N2\d{3}$/.test(normalized) ? normalized : '';
}

function setMessage(element, message, type = '') {
  element.textContent = message;
  element.className = `form-message ${type}`;
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function cssEscape(value) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
}
