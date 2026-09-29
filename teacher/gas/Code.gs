/**
 * JLPT 老師檢閱 API（獨立 GAS 專案，N1 第一版）
 *
 * 這支程式不依賴、也不修改學生端 GAS。
 * 它只讀取正式 N1 文法題庫與點名表，統計結果寫入自己建立的快取試算表。
 */
var TEACHER_CONFIG = Object.freeze({
  VERSION: '1.0.0',
  TIME_ZONE: 'Asia/Taipei',
  LEVEL: 'N1',
  GRAMMAR_SPREADSHEET_ID: '1LGmgYXIyQDsHZ1V4TClsafnifb57NQcm-UjabTHn_xI',
  MAIN_SPREADSHEET_ID: '1mPkjuaWJWMhG0r9xDHLdld_N0jRXBc7hgU8dbgoX_M4',
  ATTENDANCE_SHEET: 'N1點名表',
  CACHE_SHEET: 'n1_stats_cache',
  CACHE_SPREADSHEET_PROPERTY: 'TEACHER_CACHE_SPREADSHEET_ID',
  RESPONSE_CHUNK_SIZE: 10000,
  REFRESH_EVERY_MINUTES: 5,
  SCHEDULE: Object.freeze([
    Object.freeze({ unit: 1, releaseAt: '2026-09-28T00:00:00+08:00', deadlineAt: '2026-10-11T23:59:59+08:00' }),
    Object.freeze({ unit: 2, releaseAt: '2026-10-05T00:00:00+08:00', deadlineAt: '2026-10-18T23:59:59+08:00' }),
    Object.freeze({ unit: 3, releaseAt: '2026-10-12T00:00:00+08:00', deadlineAt: '2026-10-25T23:59:59+08:00' }),
    Object.freeze({ unit: 4, releaseAt: '2026-10-19T00:00:00+08:00', deadlineAt: '2026-11-01T23:59:59+08:00' }),
    Object.freeze({ unit: 5, releaseAt: '2026-10-26T00:00:00+08:00', deadlineAt: '2026-11-08T23:59:59+08:00' }),
    Object.freeze({ unit: 6, releaseAt: '2026-11-02T00:00:00+08:00', deadlineAt: '2026-11-15T23:59:59+08:00' }),
    Object.freeze({ unit: 7, releaseAt: '2026-11-09T00:00:00+08:00', deadlineAt: '2026-11-22T23:59:59+08:00' }),
    Object.freeze({ unit: 8, releaseAt: '2026-11-16T00:00:00+08:00', deadlineAt: '2026-11-29T23:59:59+08:00' })
  ])
});

var CACHE_HEADERS = Object.freeze([
  'level', 'unit', 'unit_id', 'title', 'data_status',
  'roster_count', 'participant_count', 'completed_attempt_count', 'completion_rate',
  'question_count', 'question_id', 'section_no', 'question_no', 'question_type',
  'prompt', 'option_1', 'option_2', 'option_3', 'option_4', 'correct_option',
  'answered_count', 'wrong_count', 'error_rate',
  'selected_1', 'selected_2', 'selected_3', 'selected_4',
  'common_wrong_option', 'common_wrong_count', 'common_wrong_text',
  'release_at', 'deadline_at', 'generated_at'
]);

function doGet(e) {
  var parameters = e && e.parameter ? e.parameter : {};
  var callback = String(parameters.callback || '');
  try {
    var action = String(parameters.action || 'health');
    var result;
    if (action === 'health') {
      result = {
        ok: true,
        code: 'HEALTHY',
        message: '老師檢閱 API 運作正常',
        data: { version: TEACHER_CONFIG.VERSION, level: TEACHER_CONFIG.LEVEL }
      };
    } else if (action === 'teacher_grammar_stats') {
      result = {
        ok: true,
        code: 'SUCCESS',
        message: '統計讀取成功',
        data: getCachedTeacherStats_(parameters.unit)
      };
    } else if (action === 'teacher_refresh_n1') {
      result = {
        ok: true,
        code: 'REFRESHED',
        message: 'N1 統計更新完成',
        data: refreshN1DashboardCache()
      };
    } else {
      throw teacherError_('INVALID_ACTION', '不支援這個老師檢閱動作');
    }
    return teacherOutput_(result, callback);
  } catch (error) {
    return teacherOutput_(teacherErrorResponse_(error), callback);
  }
}

function doPost(e) {
  try {
    var payload = teacherParsePayload_(e);
    var action = String(payload.action || '');
    if (action === 'teacher_grammar_stats') {
      return teacherJson_({
        ok: true,
        code: 'SUCCESS',
        message: '統計讀取成功',
        data: getCachedTeacherStats_(payload.unit)
      });
    }
    if (action === 'teacher_refresh_n1') {
      return teacherJson_({
        ok: true,
        code: 'REFRESHED',
        message: 'N1 統計更新完成',
        data: refreshN1DashboardCache()
      });
    }
    throw teacherError_('INVALID_ACTION', '不支援這個老師檢閱動作');
  } catch (error) {
    return teacherJson_(teacherErrorResponse_(error));
  }
}

/**
 * 第一次安裝時手動執行一次。
 */
function setupTeacherDashboard() {
  var properties = PropertiesService.getScriptProperties();
  var cacheId = properties.getProperty(TEACHER_CONFIG.CACHE_SPREADSHEET_PROPERTY);
  var cacheSpreadsheet;
  if (cacheId) {
    cacheSpreadsheet = SpreadsheetApp.openById(cacheId);
  } else {
    cacheSpreadsheet = SpreadsheetApp.create('JLPT 老師檢閱統計快取（N1）');
    properties.setProperty(TEACHER_CONFIG.CACHE_SPREADSHEET_PROPERTY, cacheSpreadsheet.getId());
  }
  ensureCacheSheet_(cacheSpreadsheet);

  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'refreshN1DashboardCache') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('refreshN1DashboardCache')
    .timeBased()
    .everyMinutes(TEACHER_CONFIG.REFRESH_EVERY_MINUTES)
    .create();

  var summary = refreshN1DashboardCache();
  summary.cacheSpreadsheetUrl = cacheSpreadsheet.getUrl();
  console.log(JSON.stringify(summary, null, 2));
  return summary;
}

/**
 * 背景工作：掃描原始資料並重建小型統計快取。
 * responses 以固定列數分批讀取，避免資料量增加時一次占用過多記憶體。
 */
function refreshN1DashboardCache() {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var startedAt = new Date();
    var grammarSpreadsheet = SpreadsheetApp.openById(TEACHER_CONFIG.GRAMMAR_SPREADSHEET_ID);
    var source = buildN1SnapshotSource_(grammarSpreadsheet);
    streamResponseStats_(grammarSpreadsheet, source);
    var rosterCount = getN1RosterCount_();
    var generatedAt = new Date();
    var cacheRows = createCacheRows_(source, rosterCount, generatedAt);
    writeCacheRows_(cacheRows);
    return {
      level: TEACHER_CONFIG.LEVEL,
      cacheRowCount: cacheRows.length,
      responseRowCount: source.responseRowCount,
      participantCount: Object.keys(source.latestByStudentUnit).length,
      generatedAt: teacherFormatIso_(generatedAt),
      elapsedMs: new Date().getTime() - startedAt.getTime()
    };
  } finally {
    lock.releaseLock();
  }
}

function buildN1SnapshotSource_(spreadsheet) {
  var unitSheet = teacherSheet_(spreadsheet, 'units');
  var questionSheet = teacherSheet_(spreadsheet, 'questions');
  var attemptSheet = teacherSheet_(spreadsheet, 'attempts');
  var unitHeaders = teacherHeaders_(unitSheet);
  var questionHeaders = teacherHeaders_(questionSheet);
  var attemptHeaders = teacherHeaders_(attemptSheet);
  teacherRequireHeaders_(unitHeaders, ['unit_id', 'level', 'round_no', 'title'], 'units');
  teacherRequireHeaders_(questionHeaders, [
    'question_id', 'unit_id', 'section_no', 'question_no', 'question_type',
    'prompt', 'option_1', 'option_2', 'option_3', 'option_4', 'correct_option'
  ], 'questions');
  teacherRequireHeaders_(attemptHeaders, [
    'attempt_id', 'student_id', 'unit_id', 'submitted_at', 'completed'
  ], 'attempts');

  var units = {};
  teacherRows_(unitSheet).forEach(function (row) {
    var level = String(row[unitHeaders.level] || '').trim().toUpperCase();
    var unit = Number(row[unitHeaders.round_no]);
    var unitId = String(row[unitHeaders.unit_id] || '').trim();
    if (level === 'N1' && unit >= 1 && unit <= 8 && unitId) {
      units[unitId] = { unitId: unitId, unit: unit, title: String(row[unitHeaders.title] || '') };
    }
  });

  var questions = {};
  var questionCountByUnit = {};
  teacherRows_(questionSheet).forEach(function (row) {
    var unitId = String(row[questionHeaders.unit_id] || '').trim();
    var questionId = String(row[questionHeaders.question_id] || '').trim();
    if (!units[unitId] || !questionId) return;
    questions[questionId] = {
      questionId: questionId,
      unitId: unitId,
      sectionNo: Number(row[questionHeaders.section_no]) || 0,
      questionNo: Number(row[questionHeaders.question_no]) || 0,
      questionType: String(row[questionHeaders.question_type] || ''),
      prompt: String(row[questionHeaders.prompt] || ''),
      options: [
        String(row[questionHeaders.option_1] || ''), String(row[questionHeaders.option_2] || ''),
        String(row[questionHeaders.option_3] || ''), String(row[questionHeaders.option_4] || '')
      ],
      correctOption: Number(row[questionHeaders.correct_option]) || 0,
      answeredCount: 0,
      wrongCount: 0,
      selectedCounts: [0, 0, 0, 0]
    };
    questionCountByUnit[unitId] = (questionCountByUnit[unitId] || 0) + 1;
  });

  var attempts = teacherRows_(attemptSheet);
  var latestByStudentUnit = {};
  var completedAttemptCountByUnit = {};
  attempts.forEach(function (row, index) {
    var attemptId = String(row[attemptHeaders.attempt_id] || '').trim();
    var studentId = String(row[attemptHeaders.student_id] || '').trim().toUpperCase();
    var unitId = String(row[attemptHeaders.unit_id] || '').trim();
    if (!attemptId || !units[unitId] || !/^N1\d{3}$/.test(studentId)
        || !teacherChecked_(row[attemptHeaders.completed])) return;
    completedAttemptCountByUnit[unitId] = (completedAttemptCountByUnit[unitId] || 0) + 1;
    var dateValue = row[attemptHeaders.submitted_at];
    var submittedAt = dateValue instanceof Date ? dateValue.getTime() : new Date(dateValue).getTime();
    if (isNaN(submittedAt)) submittedAt = 0;
    var key = unitId + '|' + studentId;
    var current = latestByStudentUnit[key];
    if (!current || submittedAt > current.submittedAt
        || (submittedAt === current.submittedAt && index > current.rowIndex)) {
      latestByStudentUnit[key] = {
        attemptId: attemptId, unitId: unitId, studentId: studentId,
        submittedAt: submittedAt, rowIndex: index
      };
    }
  });

  var selectedAttemptToUnit = {};
  var participantCountByUnit = {};
  Object.keys(latestByStudentUnit).forEach(function (key) {
    var attempt = latestByStudentUnit[key];
    selectedAttemptToUnit[attempt.attemptId] = attempt.unitId;
    participantCountByUnit[attempt.unitId] = (participantCountByUnit[attempt.unitId] || 0) + 1;
  });

  return {
    units: units,
    questions: questions,
    questionCountByUnit: questionCountByUnit,
    latestByStudentUnit: latestByStudentUnit,
    selectedAttemptToUnit: selectedAttemptToUnit,
    participantCountByUnit: participantCountByUnit,
    completedAttemptCountByUnit: completedAttemptCountByUnit,
    responseRowCount: 0
  };
}

function streamResponseStats_(spreadsheet, source) {
  var sheet = teacherSheet_(spreadsheet, 'responses');
  var headers = teacherHeaders_(sheet);
  teacherRequireHeaders_(headers, ['attempt_id', 'question_id', 'selected_option', 'is_correct'], 'responses');
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  var width = sheet.getLastColumn();
  var chunkSize = TEACHER_CONFIG.RESPONSE_CHUNK_SIZE;

  for (var startRow = 2; startRow <= lastRow; startRow += chunkSize) {
    var rowCount = Math.min(chunkSize, lastRow - startRow + 1);
    var values = sheet.getRange(startRow, 1, rowCount, width).getValues();
    source.responseRowCount += values.length;
    values.forEach(function (row) {
      var attemptId = String(row[headers.attempt_id] || '').trim();
      var questionId = String(row[headers.question_id] || '').trim();
      var unitId = source.selectedAttemptToUnit[attemptId];
      var question = source.questions[questionId];
      if (!unitId || !question || question.unitId !== unitId) return;
      var selected = Number(row[headers.selected_option]) || 0;
      question.answeredCount += 1;
      if (selected >= 1 && selected <= 4) question.selectedCounts[selected - 1] += 1;
      if (!teacherChecked_(row[headers.is_correct])) question.wrongCount += 1;
    });
  }
}

function createCacheRows_(source, rosterCount, generatedAt) {
  var now = generatedAt.getTime();
  return Object.keys(source.questions).map(function (questionId) {
    var question = source.questions[questionId];
    var unit = source.units[question.unitId];
    var schedule = TEACHER_CONFIG.SCHEDULE[unit.unit - 1];
    var status = now < new Date(schedule.releaseAt).getTime()
      ? 'upcoming'
      : now <= new Date(schedule.deadlineAt).getTime() ? 'preliminary' : 'final';
    var participantCount = source.participantCountByUnit[question.unitId] || 0;
    var commonWrong = teacherCommonWrong_(question);
    var row = {
      level: 'N1', unit: unit.unit, unit_id: unit.unitId, title: unit.title,
      data_status: status, roster_count: rosterCount,
      participant_count: participantCount,
      completed_attempt_count: source.completedAttemptCountByUnit[question.unitId] || 0,
      completion_rate: rosterCount ? Math.round(participantCount / rosterCount * 1000) / 10 : 0,
      question_count: source.questionCountByUnit[question.unitId] || 0,
      question_id: question.questionId, section_no: question.sectionNo,
      question_no: question.questionNo, question_type: question.questionType,
      prompt: question.prompt, option_1: question.options[0], option_2: question.options[1],
      option_3: question.options[2], option_4: question.options[3],
      correct_option: question.correctOption, answered_count: question.answeredCount,
      wrong_count: question.wrongCount,
      error_rate: question.answeredCount
        ? Math.round(question.wrongCount / question.answeredCount * 1000) / 10 : 0,
      selected_1: question.selectedCounts[0], selected_2: question.selectedCounts[1],
      selected_3: question.selectedCounts[2], selected_4: question.selectedCounts[3],
      common_wrong_option: commonWrong.option,
      common_wrong_count: commonWrong.count,
      common_wrong_text: commonWrong.option ? question.options[commonWrong.option - 1] : '',
      release_at: schedule.releaseAt, deadline_at: schedule.deadlineAt,
      generated_at: teacherFormatIso_(generatedAt)
    };
    return CACHE_HEADERS.map(function (header) { return row[header]; });
  }).sort(function (a, b) {
    return Number(a[1]) - Number(b[1]) || Number(a[12]) - Number(b[12]);
  });
}

function teacherCommonWrong_(question) {
  var option = 0;
  var count = 0;
  question.selectedCounts.forEach(function (value, index) {
    var candidate = index + 1;
    if (candidate !== question.correctOption && value > count) {
      option = candidate;
      count = value;
    }
  });
  return { option: option, count: count };
}

function writeCacheRows_(rows) {
  var cacheSpreadsheet = getCacheSpreadsheet_();
  var sheet = ensureCacheSheet_(cacheSpreadsheet);
  sheet.clearContents();
  sheet.getRange(1, 1, 1, CACHE_HEADERS.length).setValues([CACHE_HEADERS]);
  if (rows.length) {
    sheet.getRange(2, 1, rows.length, CACHE_HEADERS.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  SpreadsheetApp.flush();
}

function getCachedTeacherStats_(unitValue) {
  var unit = Number(unitValue);
  if (!Number.isInteger(unit) || unit < 1 || unit > 8) {
    throw teacherError_('INVALID_UNIT', '回次只接受 1 到 8');
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var sheet = ensureCacheSheet_(getCacheSpreadsheet_());
    if (sheet.getLastRow() < 2) {
      throw teacherError_('CACHE_NOT_READY', '統計尚未建立，請先執行 setupTeacherDashboard');
    }
    var headers = teacherHeaders_(sheet);
    teacherRequireHeaders_(headers, CACHE_HEADERS, TEACHER_CONFIG.CACHE_SHEET);
    var rows = teacherRows_(sheet).filter(function (row) {
      return Number(row[headers.unit]) === unit;
    });
    if (!rows.length) {
      throw teacherError_('CACHE_NOT_READY', '這一回尚未建立統計快取');
    }
    var first = rows[0];
    var questions = rows.map(function (row) {
      return {
        questionId: String(row[headers.question_id] || ''),
        sectionNo: Number(row[headers.section_no]) || 0,
        questionNo: Number(row[headers.question_no]) || 0,
        questionType: String(row[headers.question_type] || ''),
        prompt: String(row[headers.prompt] || ''),
        options: [
          String(row[headers.option_1] || ''), String(row[headers.option_2] || ''),
          String(row[headers.option_3] || ''), String(row[headers.option_4] || '')
        ],
        correctOption: Number(row[headers.correct_option]) || 0,
        answeredCount: Number(row[headers.answered_count]) || 0,
        wrongCount: Number(row[headers.wrong_count]) || 0,
        errorRate: Number(row[headers.error_rate]) || 0,
        selectedCounts: [
          Number(row[headers.selected_1]) || 0, Number(row[headers.selected_2]) || 0,
          Number(row[headers.selected_3]) || 0, Number(row[headers.selected_4]) || 0
        ],
        mostCommonWrongOption: Number(row[headers.common_wrong_option]) || 0,
        mostCommonWrongCount: Number(row[headers.common_wrong_count]) || 0,
        mostCommonWrongText: String(row[headers.common_wrong_text] || '')
      };
    }).sort(function (a, b) {
      return b.wrongCount - a.wrongCount || b.errorRate - a.errorRate || a.questionNo - b.questionNo;
    });
    return {
      level: String(first[headers.level] || 'N1'), unit: unit,
      unitId: String(first[headers.unit_id] || ''), title: String(first[headers.title] || ''),
      dataStatus: String(first[headers.data_status] || ''),
      rosterCount: Number(first[headers.roster_count]) || 0,
      participantCount: Number(first[headers.participant_count]) || 0,
      completedAttemptCount: Number(first[headers.completed_attempt_count]) || 0,
      completionRate: Number(first[headers.completion_rate]) || 0,
      questionCount: Number(first[headers.question_count]) || questions.length,
      releaseAt: String(first[headers.release_at] || ''),
      deadlineAt: String(first[headers.deadline_at] || ''),
      generatedAt: String(first[headers.generated_at] || ''),
      questionStats: questions
    };
  } finally {
    lock.releaseLock();
  }
}

function getN1RosterCount_() {
  var spreadsheet = SpreadsheetApp.openById(TEACHER_CONFIG.MAIN_SPREADSHEET_ID);
  var sheet = teacherSheet_(spreadsheet, TEACHER_CONFIG.ATTENDANCE_SHEET);
  var headers = teacherHeaders_(sheet);
  var studentIndex = teacherRequireHeader_(headers, '學員編號', TEACHER_CONFIG.ATTENDANCE_SHEET);
  var seen = {};
  teacherRows_(sheet).forEach(function (row) {
    var studentId = String(row[studentIndex] || '').trim().toUpperCase();
    if (/^N1\d{3}$/.test(studentId)) seen[studentId] = true;
  });
  return Object.keys(seen).length;
}

function getCacheSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty(
    TEACHER_CONFIG.CACHE_SPREADSHEET_PROPERTY
  );
  if (!id) {
    throw teacherError_('CACHE_NOT_CONFIGURED', '請先執行 setupTeacherDashboard');
  }
  return SpreadsheetApp.openById(id);
}

function ensureCacheSheet_(spreadsheet) {
  var sheet = spreadsheet.getSheetByName(TEACHER_CONFIG.CACHE_SHEET);
  if (!sheet) sheet = spreadsheet.insertSheet(TEACHER_CONFIG.CACHE_SHEET);
  return sheet;
}

function teacherSheet_(spreadsheet, name) {
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw teacherError_('SHEET_NOT_FOUND', '找不到工作表：' + name);
  return sheet;
}

function teacherHeaders_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (!lastColumn) throw teacherError_('INVALID_HEADERS', sheet.getName() + ' 沒有表頭');
  var values = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0];
  var headers = {};
  values.forEach(function (value, index) {
    var key = String(value || '').trim();
    if (key) headers[key] = index;
  });
  return headers;
}

function teacherRequireHeader_(headers, name, sheetName) {
  if (!Object.prototype.hasOwnProperty.call(headers, name)) {
    throw teacherError_('INVALID_HEADERS', sheetName + ' 缺少欄位：' + name);
  }
  return headers[name];
}

function teacherRequireHeaders_(headers, names, sheetName) {
  names.forEach(function (name) { teacherRequireHeader_(headers, name, sheetName); });
}

function teacherRows_(sheet) {
  return sheet.getLastRow() < 2
    ? []
    : sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();
}

function teacherChecked_(value) {
  return value === true || String(value || '').trim().toUpperCase() === 'TRUE';
}

function teacherParsePayload_(e) {
  var text = e && e.postData && e.postData.contents
    ? String(e.postData.contents).trim() : '';
  if (!text) throw teacherError_('INVALID_REQUEST', '沒有收到資料');
  try {
    var payload = JSON.parse(text);
    if (payload && typeof payload === 'object') return payload;
  } catch (ignore) {
    // 統一回傳安全錯誤。
  }
  throw teacherError_('INVALID_REQUEST', '資料格式不正確');
}

function teacherFormatIso_(value) {
  return Utilities.formatDate(value, TEACHER_CONFIG.TIME_ZONE, "yyyy-MM-dd'T'HH:mm:ssXXX");
}

function teacherError_(code, message) {
  var error = new Error(message);
  error.name = 'TeacherError';
  error.code = code;
  return error;
}

function teacherErrorResponse_(error) {
  console.error(error && error.stack ? error.stack : error);
  return {
    ok: false,
    code: error && error.code ? error.code : 'SERVER_ERROR',
    message: error && error.name === 'TeacherError'
      ? error.message : '老師檢閱服務暫時無法處理'
  };
}

function teacherJson_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function teacherOutput_(value, callback) {
  if (!callback) return teacherJson_(value);
  if (!/^[A-Za-z_$][0-9A-Za-z_$]*$/.test(callback)) {
    return teacherJson_(teacherErrorResponse_(
      teacherError_('INVALID_CALLBACK', 'callback 格式不正確')
    ));
  }
  return ContentService.createTextOutput(callback + '(' + JSON.stringify(value) + ');')
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}
