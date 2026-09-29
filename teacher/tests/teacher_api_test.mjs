import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const sourceText = fs.readFileSync(path.join(directory, '../gas/Code.gs'), 'utf8');
const context = vm.createContext({ console });
vm.runInContext(sourceText, context);

assert.deepEqual(
  JSON.parse(vm.runInContext('JSON.stringify(TEACHER_CONFIG.SUPPORTED_LEVELS)', context)),
  ['N1', 'N2', 'N3']
);
assert.equal(vm.runInContext("TEACHER_CONFIG.RESPONSE_CHUNK_SIZE", context), 10000);
assert.equal(vm.runInContext("TEACHER_CONFIG.REFRESH_EVERY_MINUTES", context), 5);
assert.equal(vm.runInContext("TEACHER_CONFIG.LEVELS.N2.CACHE_SHEET", context), 'n2_stats_cache');
assert.equal(vm.runInContext("TEACHER_CONFIG.LEVELS.N3.CACHE_SHEET", context), 'n3_stats_cache');
assert.deepEqual(
  JSON.parse(vm.runInContext("JSON.stringify(teacherCommonWrong_({ correctOption: 1, selectedCounts: [7, 3, 2, 3] }))", context)),
  { option: 2, count: 3 }
);
assert.match(sourceText, /teacher_refresh/);
assert.match(sourceText, /refreshAllTeacherDashboardCaches/);
assert.match(sourceText, /ContentService\.MimeType\.JAVASCRIPT/);
assert.match(sourceText, /teacherOutput_\(result, callback\)/);
assert.match(sourceText, /everyMinutes\(TEACHER_CONFIG\.REFRESH_EVERY_MINUTES\)/);
assert.match(sourceText, /for \(var startRow = 2; startRow <= lastRow; startRow \+= chunkSize\)/);
assert.doesNotMatch(sourceText, /setValue\([^)]*responses/i);
assert.doesNotMatch(sourceText, /TEACHER_DASHBOARD_KEY|teacherAssertAccess_/);

function buildFixture(level, studentCount) {
  const header = ['attempt_id', 'question_id', 'selected_option', 'is_correct'];
  const rows = [header];
  const selectedAttemptToUnit = {};
  const questions = {};
  for (let unit = 1; unit <= 8; unit += 1) {
    const unitId = `${level}-R${String(unit).padStart(2, '0')}`;
    for (let question = 1; question <= 40; question += 1) {
      const questionId = `${unitId}-Q${String(question).padStart(3, '0')}`;
      questions[questionId] = {
        questionId, unitId, correctOption: 1,
        answeredCount: 0, wrongCount: 0, selectedCounts: [0, 0, 0, 0]
      };
    }
    for (let student = 1; student <= studentCount; student += 1) {
      const attemptId = `${unitId}-A${student}`;
      selectedAttemptToUnit[attemptId] = unitId;
      for (let question = 1; question <= 40; question += 1) {
        const questionId = `${unitId}-Q${String(question).padStart(3, '0')}`;
        const selected = (student + question) % 4 + 1;
        rows.push([attemptId, questionId, selected, selected === 1]);
      }
    }
  }
  return { rows, source: { selectedAttemptToUnit, questions, responseRowCount: 0 } };
}

function fakeSpreadsheet(rows) {
  const sheet = {
    getName: () => 'responses',
    getLastRow: () => rows.length,
    getLastColumn: () => rows[0].length,
    getRange(startRow, startColumn, rowCount, columnCount) {
      const values = rows.slice(startRow - 1, startRow - 1 + rowCount)
        .map((row) => row.slice(startColumn - 1, startColumn - 1 + columnCount));
      return { getValues: () => values, getDisplayValues: () => values };
    }
  };
  return { getSheetByName: (name) => name === 'responses' ? sheet : null };
}

function benchmark(level, studentCount) {
  const fixture = buildFixture(level, studentCount);
  context.__spreadsheet = fakeSpreadsheet(fixture.rows);
  context.__source = fixture.source;
  const start = performance.now();
  vm.runInContext('streamResponseStats_(__spreadsheet, __source)', context);
  const elapsedMs = Math.round((performance.now() - start) * 10) / 10;
  const rowCount = fixture.rows.length - 1;
  assert.equal(context.__source.responseRowCount, rowCount);
  assert.equal(context.__source.questions[`${level}-R01-Q001`].answeredCount, studentCount);
  return { level, studentCount, responseRows: rowCount, elapsedMs };
}

const results = [benchmark('N1', 300), benchmark('N2', 300), benchmark('N3', 1000)];
console.log(JSON.stringify({ ok: true, benchmarks: results }, null, 2));
