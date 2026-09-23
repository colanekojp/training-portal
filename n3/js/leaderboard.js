const API_URL = window.PORTAL_CONFIG.API_URL;
const LEADERBOARD_CACHE_KEY = 'n3-leaderboard-cache-v4';
const LEADERBOARD_CACHE_MAX_AGE = 10 * 60 * 1000;
const PAGE_PARAMS = new URLSearchParams(window.location.search);
const TESTING_MODE = window.PORTAL_CONFIG.DEMO_MODE_ENABLED && PAGE_PARAMS.get('testing') === '1';

const DEMO_ROWS = [
  { rank: 1, studentId: 'N3001', grammar: 4, listening: 2, tutoring: 4, vocabulary: 3, assistantBonus: 2, total: 15 },
  { rank: 2, studentId: 'N3008', grammar: 4, listening: 2, tutoring: 3, vocabulary: 2, assistantBonus: 1, total: 12 },
  { rank: 3, studentId: 'N3005', grammar: 3, listening: 1, tutoring: 4, vocabulary: 2, assistantBonus: 1, total: 11 },
  { rank: 4, studentId: 'N3002', grammar: 3, listening: 1, tutoring: 3, vocabulary: 1, assistantBonus: 1, total: 9 }
];

const content = document.getElementById('leaderboard-page-content');
const refreshButton = document.getElementById('refresh-leaderboard');

document.addEventListener('DOMContentLoaded', () => {
  refreshButton.addEventListener('click', () => loadLeaderboard(false));
  document.getElementById('testing-banner').hidden = !TESTING_MODE;
  if (TESTING_MODE) {
    refreshButton.disabled = true;
    refreshButton.textContent = 'Demo 範例資料';
    renderLeaderboard(DEMO_ROWS);
    return;
  }
  const cachedRows = readLeaderboardCache();
  if (cachedRows) renderLeaderboard(cachedRows);
  loadLeaderboard(Boolean(cachedRows));
});

async function loadLeaderboard(keepCurrentContent = false) {
  refreshButton.disabled = true;
  if (!keepCurrentContent) content.innerHTML = '<div class="empty-state">正在讀取排行榜……</div>';
  try {
    const url = new URL(API_URL);
    url.search = new URLSearchParams({ action: 'portal', level: 'N3', include_leaderboard: '1' }).toString();
    const response = await fetch(url.toString(), { redirect: 'follow' });
    if (!response.ok) throw new Error(`API 連線失敗（${response.status}）`);
    const result = await response.json();
    if (!result.ok) throw new Error(result.message || '排行榜目前無法讀取。');
    const rows = result.data.leaderboard || [];
    writeLeaderboardCache(rows);
    renderLeaderboard(rows);
  } catch (error) {
    if (!keepCurrentContent) content.innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
  } finally {
    refreshButton.disabled = false;
  }
}

function renderLeaderboard(rows) {
  if (!rows.length) {
    content.innerHTML = '<div class="empty-state">排行榜目前尚無資料。</div>';
    return;
  }
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);
  const podium = `
    <div class="leaderboard-podium">
      ${top.map((row, index) => leaderboardCard(row, index)).join('')}
    </div>`;
  const tableRows = rest.length ? rest : rows.length <= 3 ? [] : rows;
  const table = tableRows.length ? `
    <div class="leaderboard-table-wrap">
      <table class="leaderboard-table">
        <thead><tr><th>名次</th><th>學員</th><th>文法</th><th>聽力</th><th>補習</th><th>單字</th><th>助教加分</th><th>總分</th></tr></thead>
        <tbody>
          ${tableRows.map((row) => `
            <tr>
              <td>${Number(row.rank)}</td>
              <td><strong>${escapeHtml(leaderboardName(row))}</strong></td>
              <td>${Number(row.grammar)}</td>
              <td>${Number(row.listening)}</td>
              <td>${Number(row.tutoring)}</td>
              <td>${Number(row.vocabulary || 0)}</td>
              <td>${Number(row.assistantBonus)}</td>
              <td><strong>${Number(row.total)}</strong></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>` : '';
  content.innerHTML = podium + table;
}

function leaderboardCard(row, index) {
  return `
    <article class="leaderboard-card ${index === 0 ? 'first' : ''}">
      <div class="leaderboard-title-row">
        <span class="rank-circle">${index + 1}</span>
        <span class="status-chip">第 ${Number(row.rank)} 名</span>
      </div>
      <h3>${escapeHtml(leaderboardName(row))}</h3>
      <div class="leaderboard-score">${Number(row.total)}<small>分</small></div>
      <div class="score-breakdown">
        <span>文法 ${Number(row.grammar)}</span><span>聽力 ${Number(row.listening)}</span>
        <span>補習 ${Number(row.tutoring)}</span><span>單字 ${Number(row.vocabulary || 0)}</span>
        <span>加分 ${Number(row.assistantBonus)}</span>
      </div>
    </article>`;
}

function leaderboardName(row) {
  return row.studentId || row.studentLabel || '—';
}

function readLeaderboardCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(LEADERBOARD_CACHE_KEY));
    if (!cached || Date.now() - Number(cached.savedAt) > LEADERBOARD_CACHE_MAX_AGE) return null;
    return cached.rows;
  } catch (error) {
    return null;
  }
}

function writeLeaderboardCache(rows) {
  try {
    localStorage.setItem(LEADERBOARD_CACHE_KEY, JSON.stringify({ savedAt: Date.now(), rows }));
  } catch (error) {
    // 瀏覽器停用儲存功能時，仍可直接讀取 API。
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
