const APP_CONFIG = {
  SPREADSHEET_ID: '10bPN4_Ag0Y7KMwWm1mjb_9KCFJ4ktqqyrvm-6RGAnuQ',
  ALLOWED_TELEGRAM_IDS: ['26156823', '1288379477'],
  STUDENTS_SHEET: 'Ученики',
  ATTENDANCE_SHEET: 'Посещения',
  JOURNAL_PREFIX: 'Журнал ',
  INITIAL_STUDENTS: [
    'Агния',
    'Алиса',
    'Аннетта',
    'Арслан',
    'Артём',
    'Вадим',
    'Вереника',
    'Вика',
    'Виола',
    'Вова',
    'Глеб',
    'Дарина',
    'Диана (вн)',
    'Диана (з.)',
    'Доминика',
    'Ева',
    'Исмаил',
    'Лана',
    'Милослава',
    'Неля',
    'Нильс',
    'Снежана',
    'Таня',
    'Тима (Ар.)',
    'Тима (ом.)',
    'Тинэтта'
  ]
};

function doGet(e) {
  try {
    ensureSetup_();
    const action = (e && e.parameter && e.parameter.action) || 'health';

    if (action === 'health') {
      return jsonResponse_({ ok: true, service: 'attendance-api', timestamp: new Date().toISOString() });
    }

    return jsonResponse_({ ok: false, error: 'Unknown GET action' });
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message, stack: error.stack });
  }
}

function doPost(e) {
  try {
    ensureSetup_();

    const payload = parseRequest_(e);
    const action = payload.action;

    if (!action) {
      throw new Error('Не передано действие action');
    }

    const auth = validateTelegramRequest_(payload.initData || '');

    switch (action) {
      case 'init':
      case 'getDay':
        return jsonResponse_(buildInitPayload_(payload.date, auth.user));

      case 'saveAttendance':
        saveAttendance_(payload.date, payload.records || [], auth.user);
        return jsonResponse_(buildInitPayload_(payload.date, auth.user, 'Журнал сохранён'));

      case 'addStudent':
        addStudent_(String(payload.name || '').trim(), auth.user);
        return jsonResponse_(buildInitPayload_(payload.date, auth.user, 'Ученик добавлен'));

      case 'deleteStudent':
        deleteStudent_(String(payload.studentId || '').trim());
        return jsonResponse_(buildInitPayload_(payload.date, auth.user, 'Ученик удалён'));

      case 'deleteHistoryDate':
        deleteHistoryDate_(payload.dateToDelete || payload.targetDate || payload.historyDate || '');
        return jsonResponse_(buildInitPayload_(payload.date, auth.user, 'Сохранение за дату удалено'));

      case 'clearHistory':
        clearHistory_();
        return jsonResponse_(buildInitPayload_(payload.date, auth.user, 'История очищена'));

      default:
        throw new Error('Неизвестное действие: ' + action);
    }
  } catch (error) {
    return jsonResponse_({ ok: false, error: error.message, stack: error.stack });
  }
}

function parseRequest_(e) {
  if (!e || !e.postData || !e.postData.contents) {
    return Object.assign({}, (e && e.parameter) || {});
  }

  const raw = e.postData.contents;
  const type = (e.postData.type || '').toLowerCase();

  if (type.indexOf('application/json') !== -1) {
    return JSON.parse(raw);
  }

  const params = {};
  raw.split('&').forEach(function(pair) {
    if (!pair) return;
    const index = pair.indexOf('=');
    const key = decodeURIComponent(index >= 0 ? pair.slice(0, index) : pair);
    const value = decodeURIComponent(index >= 0 ? pair.slice(index + 1) : '').replace(/\+/g, ' ');
    params[key] = value;
  });

  if (params.payload) {
    return JSON.parse(params.payload);
  }

  return params;
}

function validateTelegramRequest_(initDataRaw) {
  if (!initDataRaw) {
    throw new Error('Приложение должно быть открыто из Telegram');
  }

  const botToken = PropertiesService.getScriptProperties().getProperty('TELEGRAM_BOT_TOKEN');
  if (!botToken) {
    throw new Error('В Script Properties не задан TELEGRAM_BOT_TOKEN');
  }

  const parsed = parseInitData_(initDataRaw);
  const incomingHash = String(parsed.hash || '').toLowerCase();

  if (!incomingHash) {
    throw new Error('В initData отсутствует hash');
  }

  delete parsed.hash;

  const dataCheckString = Object.keys(parsed)
    .sort()
    .map(function(key) {
      return key + '=' + parsed[key];
    })
    .join('\n');

  const secretKey = Utilities.computeHmacSha256Signature(botToken, 'WebAppData');
  const dataCheckBytes = Utilities.newBlob(dataCheckString).getBytes();
  const calculatedHash = bytesToHex_(Utilities.computeHmacSha256Signature(dataCheckBytes, secretKey)).toLowerCase();

  if (calculatedHash !== incomingHash) {
    throw new Error('Проверка Telegram initData не пройдена');
  }

  const user = JSON.parse(parsed.user || '{}');
  if (!user || !user.id) {
    throw new Error('Не удалось определить пользователя Telegram');
  }

  if (APP_CONFIG.ALLOWED_TELEGRAM_IDS.indexOf(String(user.id)) === -1) {
    throw new Error('У вас нет доступа к этому журналу');
  }

  return { ok: true, user: user };
}

function parseInitData_(initDataRaw) {
  const result = {};
  initDataRaw.split('&').forEach(function(chunk) {
    if (!chunk) return;
    const index = chunk.indexOf('=');
    const key = decodeURIComponent(index >= 0 ? chunk.slice(0, index) : chunk);
    const value = decodeURIComponent(index >= 0 ? chunk.slice(index + 1) : '');
    result[key] = value;
  });
  return result;
}

function bytesToHex_(bytes) {
  return bytes.map(function(b) {
    const normalized = (b < 0 ? b + 256 : b).toString(16);
    return normalized.length === 1 ? '0' + normalized : normalized;
  }).join('');
}

function ensureSetup_() {
  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);

  let studentsSheet = ss.getSheetByName(APP_CONFIG.STUDENTS_SHEET);
  if (!studentsSheet) {
    studentsSheet = ss.insertSheet(APP_CONFIG.STUDENTS_SHEET);
    studentsSheet.getRange(1, 1, 1, 5).setValues([['studentId', 'fullName', 'sortOrder', 'createdAt', 'createdBy']]);
    studentsSheet.setFrozenRows(1);
    studentsSheet.getRange('A:E').setNumberFormat('@');
  }

  if (studentsSheet.getLastRow() === 1) {
    const now = new Date().toISOString();
    const rows = APP_CONFIG.INITIAL_STUDENTS.map(function(name, index) {
      return ['STU_' + Utilities.getUuid(), name, index + 1, now, 'seed'];
    });
    if (rows.length) {
      studentsSheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
      studentsSheet.getRange(2, 1, rows.length, rows[0].length).setNumberFormat('@');
    }
    studentsSheet.autoResizeColumns(1, 5);
  }

  let attendanceSheet = ss.getSheetByName(APP_CONFIG.ATTENDANCE_SHEET);
  if (!attendanceSheet) {
    attendanceSheet = ss.insertSheet(APP_CONFIG.ATTENDANCE_SHEET);
    attendanceSheet.getRange(1, 1, 1, 9).setValues([[
      'date',
      'monthKey',
      'studentId',
      'studentName',
      'status',
      'reason',
      'comment',
      'updatedAt',
      'updatedByTelegramId'
    ]]);
    attendanceSheet.setFrozenRows(1);
    attendanceSheet.getRange('A:I').setNumberFormat('@');
    attendanceSheet.autoResizeColumns(1, 9);
  }
}

function buildInitPayload_(date, user, toastMessage) {
  const normalizedDate = normalizeDate_(date);
  const students = getStudents_();
  const attendanceRows = getAttendanceRows_();
  const studentCountersById = buildStudentCountersById_(students, attendanceRows);
  const studentsWithStats = students.map(function(student) {
    const counters = studentCountersById[student.studentId] || { presentCount: 0, absentCount: 0, savedCount: 0 };
    return Object.assign({}, student, counters);
  });
  const records = getDayRecordsFromRows_(attendanceRows, normalizedDate);
  const history = buildAllHistory_(attendanceRows, studentsWithStats);
  const stats = buildStats_(studentsWithStats, records);

  return {
    ok: true,
    date: normalizedDate,
    user: {
      id: user.id,
      first_name: user.first_name || '',
      last_name: user.last_name || '',
      username: user.username || ''
    },
    students: studentsWithStats,
    records: records,
    history: history,
    stats: stats,
    toast: toastMessage || ''
  };
}

function getStudents_() {
  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(APP_CONFIG.STUDENTS_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 5).getValues();
  return values
    .map(function(row) {
      return {
        studentId: String(row[0] || '').trim(),
        fullName: String(row[1] || '').trim(),
        sortOrder: Number(row[2]) || 0,
        createdAt: row[3],
        createdBy: row[4]
      };
    })
    .filter(function(item) { return !!item.studentId && !!item.fullName; })
    .sort(function(a, b) { return a.sortOrder - b.sortOrder; });
}

function getAttendanceRows_() {
  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(APP_CONFIG.ATTENDANCE_SHEET);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, 9).getValues();
  return values.map(function(row, index) {
    const normalizedDate = normalizeSheetDateValue_(row[0]);
    const monthKey = normalizeSheetMonthKeyValue_(row[1], normalizedDate);
    return {
      rowNumber: index + 2,
      date: normalizedDate,
      monthKey: monthKey,
      studentId: String(row[2] || '').trim(),
      studentName: String(row[3] || '').trim(),
      status: String(row[4] || '').trim() === 'absent' ? 'absent' : 'present',
      reason: String(row[5] || '').trim(),
      comment: String(row[6] || '').trim(),
      updatedAt: row[7],
      updatedByTelegramId: String(row[8] || '').trim()
    };
  }).filter(function(row) {
    return !!row.date && !!row.studentId;
  });
}

function normalizeSheetDateValue_(value) {
  if (!value && value !== 0) return '';

  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const text = String(value).trim();
  if (!text) return '';

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const dotMatch = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    return [dotMatch[3], pad2_(dotMatch[2]), pad2_(dotMatch[1])].join('-');
  }

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return '';
}

function normalizeSheetMonthKeyValue_(value, fallbackDate) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM');
  }

  const text = String(value || '').trim();
  if (/^\d{4}-\d{2}$/.test(text)) {
    return text;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text.slice(0, 7);
  }
  if (fallbackDate) {
    return fallbackDate.slice(0, 7);
  }
  return '';
}

function getDayRecordsFromRows_(attendanceRows, date) {
  const normalizedDate = normalizeDate_(date);
  return attendanceRows
    .filter(function(row) { return row.date === normalizedDate; })
    .map(function(row) {
      return {
        studentId: row.studentId,
        studentName: row.studentName,
        status: row.status === 'absent' ? 'absent' : 'present',
        reason: row.reason || '',
        comment: row.comment || ''
      };
    });
}

function buildStudentCountersById_(students, attendanceRows) {
  const countersById = {};
  students.forEach(function(student) {
    countersById[student.studentId] = {
      presentCount: 0,
      absentCount: 0,
      savedCount: 0
    };
  });

  attendanceRows.forEach(function(row) {
    if (!countersById[row.studentId]) {
      countersById[row.studentId] = { presentCount: 0, absentCount: 0, savedCount: 0 };
    }
    countersById[row.studentId].savedCount += 1;
    if (row.status === 'absent') {
      countersById[row.studentId].absentCount += 1;
    } else {
      countersById[row.studentId].presentCount += 1;
    }
  });

  return countersById;
}

function buildAllHistory_(attendanceRows, students) {
  const orderById = {};
  students.forEach(function(student, index) {
    orderById[student.studentId] = student.sortOrder || (index + 1);
  });

  const grouped = {};
  attendanceRows.forEach(function(row) {
    if (!grouped[row.date]) {
      grouped[row.date] = {
        date: row.date,
        total: 0,
        present: 0,
        absent: 0,
        presentList: [],
        absentList: []
      };
    }

    const group = grouped[row.date];
    group.total += 1;

    if (row.status === 'absent') {
      group.absent += 1;
      group.absentList.push({
        studentId: row.studentId,
        studentName: row.studentName,
        reason: row.reason || '',
        comment: row.comment || ''
      });
    } else {
      group.present += 1;
      group.presentList.push({
        studentId: row.studentId,
        studentName: row.studentName
      });
    }
  });

  const sorter = function(a, b) {
    const aOrder = orderById[a.studentId] || 99999;
    const bOrder = orderById[b.studentId] || 99999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a.studentName || '').localeCompare(String(b.studentName || ''), 'ru');
  };

  return Object.keys(grouped)
    .sort()
    .reverse()
    .map(function(dateKey) {
      const entry = grouped[dateKey];
      entry.presentList.sort(sorter);
      entry.absentList.sort(sorter);
      return entry;
    });
}

function buildStats_(students, records) {
  const byId = {};
  records.forEach(function(rec) {
    byId[rec.studentId] = rec;
  });

  let present = 0;
  let absent = 0;
  students.forEach(function(student) {
    const rec = byId[student.studentId];
    if (!rec || rec.status === 'present') {
      present += 1;
    } else {
      absent += 1;
    }
  });

  return {
    total: students.length,
    present: present,
    absent: absent
  };
}

function addStudent_(name, user) {
  if (!name) {
    throw new Error('Введите имя ученика');
  }

  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(APP_CONFIG.STUDENTS_SHEET);
  const students = getStudents_();

  const exists = students.some(function(student) {
    return student.fullName.toLowerCase() === name.toLowerCase();
  });
  if (exists) {
    throw new Error('Такой ученик уже существует');
  }

  const nextOrder = students.length ? Math.max.apply(null, students.map(function(s) { return s.sortOrder; })) + 1 : 1;
  sheet.appendRow([
    'STU_' + Utilities.getUuid(),
    name,
    nextOrder,
    new Date().toISOString(),
    String(user.id)
  ]);
  SpreadsheetApp.flush();
  syncAllJournalSheets_();
}

function deleteStudent_(studentId) {
  if (!studentId) {
    throw new Error('Не передан studentId');
  }

  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const studentsSheet = ss.getSheetByName(APP_CONFIG.STUDENTS_SHEET);
  const attendanceSheet = ss.getSheetByName(APP_CONFIG.ATTENDANCE_SHEET);

  deleteRowsByPredicate_(studentsSheet, 2, function(row) {
    return String(row[0] || '').trim() === studentId;
  });

  deleteRowsByPredicate_(attendanceSheet, 2, function(row) {
    return String(row[2] || '').trim() === studentId;
  });

  const students = getStudents_();
  if (students.length) {
    const sortValues = students.map(function(student, index) {
      return [index + 1];
    });
    studentsSheet.getRange(2, 3, sortValues.length, 1).setValues(sortValues);
  }

  SpreadsheetApp.flush();
  syncAllJournalSheets_();
}

function deleteHistoryDate_(date) {
  const normalizedDate = normalizeDate_(date);
  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const attendanceSheet = ss.getSheetByName(APP_CONFIG.ATTENDANCE_SHEET);
  const monthKey = getMonthKey_(normalizedDate);

  deleteRowsByPredicate_(attendanceSheet, 2, function(row) {
    return normalizeSheetDateValue_(row[0]) === normalizedDate;
  });

  SpreadsheetApp.flush();
  syncJournalSheet_(monthKey);
}

function clearHistory_() {
  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const attendanceSheet = ss.getSheetByName(APP_CONFIG.ATTENDANCE_SHEET);
  const lastRow = attendanceSheet.getLastRow();
  if (lastRow >= 2) {
    attendanceSheet.deleteRows(2, lastRow - 1);
  }
  deleteAllJournalSheets_();
}

function saveAttendance_(date, records, user) {
  const normalizedDate = normalizeDate_(date);
  const monthKey = getMonthKey_(normalizedDate);
  const students = getStudents_();

  const recordsById = {};
  (records || []).forEach(function(item) {
    if (item && item.studentId) {
      recordsById[item.studentId] = item;
    }
  });

  const sanitized = students.map(function(student) {
    const incoming = recordsById[student.studentId] || {};
    const status = incoming.status === 'absent' ? 'absent' : 'present';
    return [
      normalizedDate,
      monthKey,
      student.studentId,
      student.fullName,
      status,
      status === 'absent' ? String(incoming.reason || '').trim() : '',
      status === 'absent' ? String(incoming.comment || '').trim() : '',
      new Date().toISOString(),
      String(user.id)
    ];
  });

  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const sheet = ss.getSheetByName(APP_CONFIG.ATTENDANCE_SHEET);

  deleteRowsByPredicate_(sheet, 2, function(row) {
    return normalizeSheetDateValue_(row[0]) === normalizedDate;
  });

  if (sanitized.length) {
    const startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, sanitized.length, sanitized[0].length).setValues(sanitized);
    sheet.getRange(startRow, 1, sanitized.length, sanitized[0].length).setNumberFormat('@');
  }

  SpreadsheetApp.flush();
  syncJournalSheet_(monthKey);
}

function deleteRowsByPredicate_(sheet, startRow, predicate) {
  const lastRow = sheet.getLastRow();
  if (lastRow < startRow) return 0;

  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const values = sheet.getRange(startRow, 1, lastRow - startRow + 1, lastColumn).getValues();
  const rowsToDelete = [];

  values.forEach(function(row, index) {
    if (predicate(row, index + startRow)) {
      rowsToDelete.push(index + startRow);
    }
  });

  rowsToDelete.reverse().forEach(function(rowNumber) {
    sheet.deleteRow(rowNumber);
  });

  return rowsToDelete.length;
}

function syncAllJournalSheets_() {
  const attendanceRows = getAttendanceRows_();
  const monthKeysMap = {};
  attendanceRows.forEach(function(row) {
    if (row.monthKey && /^\d{4}-\d{2}$/.test(row.monthKey)) {
      monthKeysMap[row.monthKey] = true;
    }
  });

  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  ss.getSheets().forEach(function(sheet) {
    const name = sheet.getName();
    if (name.indexOf(APP_CONFIG.JOURNAL_PREFIX) === 0) {
      const monthKey = name.replace(APP_CONFIG.JOURNAL_PREFIX, '');
      if (!monthKeysMap[monthKey]) {
        ss.deleteSheet(sheet);
      }
    }
  });

  Object.keys(monthKeysMap).sort().forEach(function(monthKey) {
    rebuildMonthSheet_(monthKey, attendanceRows);
  });
}

function syncJournalSheet_(monthKey) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) {
    return;
  }

  const attendanceRows = getAttendanceRows_();
  const hasRows = attendanceRows.some(function(row) {
    return row.monthKey === monthKey;
  });

  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const existing = ss.getSheetByName(getJournalSheetName_(monthKey));

  if (!hasRows) {
    if (existing) {
      ss.deleteSheet(existing);
    }
    return;
  }

  rebuildMonthSheet_(monthKey, attendanceRows);
}

function deleteAllJournalSheets_() {
  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  ss.getSheets().forEach(function(sheet) {
    if (sheet.getName().indexOf(APP_CONFIG.JOURNAL_PREFIX) === 0) {
      ss.deleteSheet(sheet);
    }
  });
}

function rebuildMonthSheet_(monthKey, allAttendanceRows) {
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || ''))) {
    return;
  }

  const students = getStudents_();
  const rows = (allAttendanceRows || getAttendanceRows_()).filter(function(row) {
    return row.monthKey === monthKey;
  });

  const ss = SpreadsheetApp.openById(APP_CONFIG.SPREADSHEET_ID);
  const sheetName = getJournalSheetName_(monthKey);
  let sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  unmergeWholeSheet_(sheet);
  sheet.clear();

  const year = Number(monthKey.split('-')[0]);
  const month = Number(monthKey.split('-')[1]);
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthLabel = Utilities.formatDate(new Date(year, month - 1, 1), Session.getScriptTimeZone(), 'MMMM yyyy');
  const headers = ['№', 'Список обучающихся'];
  for (let day = 1; day <= daysInMonth; day++) {
    headers.push(day);
  }

  sheet.getRange(1, 1).setValue('Журнал посещаемости');
  sheet.getRange(1, 2).setValue(capitalize_(monthLabel));
  sheet.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#dce9ff')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  sheet.getRange(2, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(2, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#eef4ff')
    .setHorizontalAlignment('center')
    .setVerticalAlignment('middle');

  const map = {};
  rows.forEach(function(row) {
    if (!row.date) return;
    if (!map[row.studentId]) map[row.studentId] = {};
    const day = Number(row.date.split('-')[2]);
    if (day >= 1 && day <= daysInMonth) {
      map[row.studentId][day] = row;
    }
  });

  const values = [];
  const notes = [];
  const backgrounds = [];

  students.forEach(function(student, index) {
    const baseBg = index % 2 === 0 ? '#ffffff' : '#f8fbff';
    const rowValues = [index + 1, student.fullName];
    const rowNotes = ['', ''];
    const rowBackgrounds = [baseBg, baseBg];

    for (let day = 1; day <= daysInMonth; day++) {
      const rec = map[student.studentId] && map[student.studentId][day];
      if (!rec) {
        rowValues.push('');
        rowNotes.push('');
        rowBackgrounds.push(baseBg);
      } else if (rec.status === 'absent') {
        rowValues.push('Н');
        const noteParts = [];
        if (rec.reason) noteParts.push('Причина: ' + rec.reason);
        if (rec.comment) noteParts.push('Комментарий: ' + rec.comment);
        rowNotes.push(noteParts.join('\n'));
        rowBackgrounds.push('#ffe4ea');
      } else {
        rowValues.push('✓');
        rowNotes.push('');
        rowBackgrounds.push('#e3f7ef');
      }
    }

    values.push(rowValues);
    notes.push(rowNotes);
    backgrounds.push(rowBackgrounds);
  });

  if (values.length && headers.length) {
    sheet.getRange(3, 1, values.length, headers.length).setValues(values);
    sheet.getRange(3, 1, values.length, headers.length).setNotes(notes);
    sheet.getRange(3, 1, values.length, headers.length).setBackgrounds(backgrounds);
  }

  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(2);
  sheet.setColumnWidth(1, 44);
  sheet.setColumnWidth(2, 230);
  for (let c = 3; c <= headers.length; c++) {
    sheet.setColumnWidth(c, 38);
  }

  sheet.setRowHeights(1, 1, 30);
  sheet.setRowHeights(2, 1, 30);

  const neededRows = Math.max(values.length + 4, 4);
  if (sheet.getMaxRows() < neededRows) {
    sheet.insertRowsAfter(sheet.getMaxRows(), neededRows - sheet.getMaxRows());
  }

  sheet.getRange(1, 1, Math.max(values.length + 2, 2), headers.length)
    .setBorder(true, true, true, true, true, true)
    .setVerticalAlignment('middle');

  if (values.length) {
    sheet.getRange(3, 2, values.length, 1).setHorizontalAlignment('left');
    if (headers.length > 2) {
      sheet.getRange(3, 3, values.length, headers.length - 2).setHorizontalAlignment('center');
    }
  }
}

function unmergeWholeSheet_(sheet) {
  const maxRows = Math.max(sheet.getMaxRows(), 1);
  const maxColumns = Math.max(sheet.getMaxColumns(), 1);
  const mergedRanges = sheet.getRange(1, 1, maxRows, maxColumns).getMergedRanges();
  mergedRanges.forEach(function(range) {
    range.breakApart();
  });
}

function getJournalSheetName_(monthKey) {
  return APP_CONFIG.JOURNAL_PREFIX + monthKey;
}

function pad2_(value) {
  const text = String(value || '').trim();
  return text.length === 1 ? '0' + text : text;
}

function normalizeDate_(date) {
  if (!date) {
    return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  if (Object.prototype.toString.call(date) === '[object Date]' && !isNaN(date.getTime ? date.getTime() : date)) {
    return Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  const text = String(date).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    return text;
  }

  const parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  throw new Error('Неверный формат даты. Используйте YYYY-MM-DD');
}

function getMonthKey_(date) {
  return normalizeDate_(date).slice(0, 7);
}

function capitalize_(value) {
  return value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

function jsonResponse_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
