(() => {
  'use strict';

  const tg = window.Telegram?.WebApp || null;

  const REASONS = Object.freeze([
    'Болел(а)',
    'Семейные обстоятельства',
    'Уехал(а)',
    'Школа / экзамен',
    'Предупредил(а) заранее',
    'Без причины',
    'Другое'
  ]);

  const REQUEST_TIMEOUT_MS = 30000;
  const DEMO_STUDENTS = Object.freeze([
    { studentId: 'demo-1', fullName: 'Анна Смирнова', sortOrder: 1, presentCount: 12, absentCount: 1 },
    { studentId: 'demo-2', fullName: 'Михаил Орлов', sortOrder: 2, presentCount: 10, absentCount: 3 },
    { studentId: 'demo-3', fullName: 'София Кузнецова', sortOrder: 3, presentCount: 13, absentCount: 0 },
    { studentId: 'demo-4', fullName: 'Даниил Волков', sortOrder: 4, presentCount: 8, absentCount: 4 },
    { studentId: 'demo-5', fullName: 'Мария Белова', sortOrder: 5, presentCount: 11, absentCount: 2 }
  ]);

  const state = {
    apiUrl: normalizeString(window.APP_CONFIG?.API_URL),
    user: null,
    date: '',
    students: [],
    records: new Map(),
    history: [],
    activeTab: 'attendance',
    filter: 'all',
    search: '',
    dirty: false,
    editingStudentId: null,
    openedHistoryDate: null,
    canEdit: false,
    dateHasRecords: false,
    lessonNote: '',
    loadingDepth: 0,
    demoMode: Boolean(window.APP_CONFIG?.DEMO_MODE) || !tg,
    pendingConfirmResolve: null,
    telegramMainButtonBound: false,
    telegramBackButtonBound: false
  };

  const els = {
    appShell: getRequiredElement('appShell'),
    lessonDate: getRequiredElement('lessonDate'),
    studentsList: getRequiredElement('studentsList'),
    studentsAdminList: getRequiredElement('studentsAdminList'),
    historyList: getRequiredElement('historyList'),
    statTotal: getRequiredElement('statTotal'),
    statPresent: getRequiredElement('statPresent'),
    statAbsent: getRequiredElement('statAbsent'),
    attendanceProgress: getRequiredElement('attendanceProgress'),
    progressLabel: getRequiredElement('progressLabel'),
    progressPercent: getRequiredElement('progressPercent'),
    addStudentForm: getRequiredElement('addStudentForm'),
    addStudentBtn: getRequiredElement('addStudentBtn'),
    newStudentName: getRequiredElement('newStudentName'),
    saveBtn: getRequiredElement('saveBtn'),
    saveBannerBtn: getRequiredElement('saveBannerBtn'),
    unsavedBanner: getRequiredElement('unsavedBanner'),
    markAllPresentBtn: getRequiredElement('markAllPresentBtn'),
    clearHistoryBtn: getRequiredElement('clearHistoryBtn'),
    userBadge: getRequiredElement('userBadge'),
    modeBadge: getRequiredElement('modeBadge'),
    accessNote: getRequiredElement('accessNote'),
    attendanceHelp: getRequiredElement('attendanceHelp'),
    lessonNoteInput: getRequiredElement('lessonNoteInput'),
    lessonNoteView: getRequiredElement('lessonNoteView'),
    studentsHelp: getRequiredElement('studentsHelp'),
    historyHelp: getRequiredElement('historyHelp'),
    loadingOverlay: getRequiredElement('loadingOverlay'),
    loadingText: getRequiredElement('loadingText'),
    toast: getRequiredElement('toast'),
    searchInput: getRequiredElement('searchInput'),
    filterRow: getRequiredElement('filterRow'),
    reasonModal: getRequiredElement('reasonModal'),
    modalStudentName: getRequiredElement('modalStudentName'),
    reasonSelect: getRequiredElement('reasonSelect'),
    reasonComment: getRequiredElement('reasonComment'),
    closeModalBtn: getRequiredElement('closeModalBtn'),
    saveReasonBtn: getRequiredElement('saveReasonBtn'),
    markPresentFromModalBtn: getRequiredElement('markPresentFromModalBtn'),
    historyModal: getRequiredElement('historyModal'),
    historyModalTitle: getRequiredElement('historyModalTitle'),
    historyModalBody: getRequiredElement('historyModalBody'),
    closeHistoryModalBtn: getRequiredElement('closeHistoryModalBtn'),
    confirmModal: getRequiredElement('confirmModal'),
    confirmTitle: getRequiredElement('confirmTitle'),
    confirmText: getRequiredElement('confirmText'),
    confirmCancelBtn: getRequiredElement('confirmCancelBtn'),
    confirmAcceptBtn: getRequiredElement('confirmAcceptBtn')
  };

  function getRequiredElement(id) {
    const element = document.getElementById(id);
    if (!element) {
      throw new Error(`Не найден элемент интерфейса: #${id}`);
    }
    return element;
  }

  function normalizeString(value) {
    return String(value ?? '').trim();
  }

  function normalizeStudentId(value) {
    return normalizeString(value);
  }

  function getTelegramUser() {
    return tg?.initDataUnsafe?.user || null;
  }

  function getTelegramDisplayName(user = getTelegramUser()) {
    if (!user) return 'Пользователь';
    return [user.first_name, user.last_name].filter(Boolean).join(' ') || user.username || 'Пользователь';
  }

  function getLocalAdminTelegramIds() {
    const ids = Array.isArray(window.APP_CONFIG?.ADMIN_TELEGRAM_IDS)
      ? window.APP_CONFIG.ADMIN_TELEGRAM_IDS
      : [];

    return ids
      .map((item) => normalizeString(item))
      .filter(Boolean);
  }

  function isLocalAdminUser(user) {
    if (!user?.id) return false;
    return getLocalAdminTelegramIds().includes(normalizeString(user.id));
  }

  function initTelegram() {
    if (!tg) {
      document.body.classList.add('demo-mode');
      els.userBadge.textContent = 'Демо-просмотр';
      els.modeBadge.textContent = 'Вне Telegram';
      els.modeBadge.className = 'mode-chip demo';
      return;
    }

    tg.ready();
    tg.expand();

    try {
      tg.enableClosingConfirmation?.();
      tg.setHeaderColor?.('#101828');
      tg.setBackgroundColor?.('#f4f7fb');
    } catch (error) {
      console.warn('Telegram chrome setup skipped:', error);
    }

    els.userBadge.textContent = getTelegramDisplayName();
    setupTelegramMainButton();
    setupTelegramBackButton();
  }

  function setupTelegramMainButton() {
    if (!tg?.MainButton || state.telegramMainButtonBound) return;
    tg.MainButton.onClick(() => {
      if (state.canEdit && state.dirty) {
        saveJournal();
      }
    });
    state.telegramMainButtonBound = true;
  }

  function setupTelegramBackButton() {
    if (!tg?.BackButton || state.telegramBackButtonBound) return;
    tg.BackButton.onClick(() => {
      if (!els.reasonModal.classList.contains('hidden')) {
        closeReasonModal();
        return;
      }
      if (!els.historyModal.classList.contains('hidden')) {
        closeHistoryModal();
        return;
      }
      if (!els.confirmModal.classList.contains('hidden')) {
        resolveConfirm(false);
        return;
      }
      if (state.activeTab !== 'attendance') {
        setActiveTab('attendance');
      }
    });
    state.telegramBackButtonBound = true;
  }

  function updateTelegramChrome() {
    if (!tg) return;

    const modalIsOpen = !els.reasonModal.classList.contains('hidden')
      || !els.historyModal.classList.contains('hidden')
      || !els.confirmModal.classList.contains('hidden');
    const shouldShowBack = modalIsOpen || state.activeTab !== 'attendance';

    try {
      if (tg.BackButton) {
        shouldShowBack ? tg.BackButton.show() : tg.BackButton.hide();
      }

      if (tg.MainButton) {
        if (state.canEdit && state.dirty) {
          tg.MainButton.setText('Сохранить журнал');
          tg.MainButton.show();
        } else {
          tg.MainButton.hide();
        }
      }
    } catch (error) {
      console.warn('Telegram chrome update skipped:', error);
    }
  }

  function setLoading(isLoading, text = 'Загрузка…') {
    state.loadingDepth += isLoading ? 1 : -1;
    state.loadingDepth = Math.max(0, state.loadingDepth);
    els.loadingText.textContent = text;
    els.loadingOverlay.classList.toggle('hidden', state.loadingDepth === 0);
  }

  function normalizeUiErrorMessage(message) {
    const text = normalizeString(message);
    if (!text) return 'Произошла ошибка';
    if (text === 'Failed to fetch' || text === 'Load failed' || text.includes('NetworkError')) {
      return 'Ошибка сети или ответа сервера';
    }
    if (text.includes('Unexpected token')) return 'Сервер вернул некорректный ответ';
    return text;
  }

  function showToast(message) {
    const text = normalizeUiErrorMessage(message);
    if (!text) return;

    els.toast.textContent = text;
    els.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => {
      els.toast.classList.remove('show');
    }, 3000);
  }

  function haptic(type = 'impact') {
    if (!tg?.HapticFeedback) return;
    try {
      if (type === 'success' || type === 'error' || type === 'warning') {
        tg.HapticFeedback.notificationOccurred(type);
      } else {
        tg.HapticFeedback.impactOccurred('light');
      }
    } catch (error) {
      console.warn('Haptic feedback skipped:', error);
    }
  }

  function todayLocalISO() {
    const now = new Date();
    const tzOffset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
  }

  function assertApiIsConfigured() {
    const placeholder = 'PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE';
    if (!state.apiUrl || state.apiUrl.includes(placeholder)) {
      throw new Error('Укажите URL задеплоенного Apps Script в frontend/config.js');
    }
    if (!tg?.initData) {
      throw new Error('Для реальной работы откройте приложение внутри Telegram');
    }
  }

  async function api(action, extra = {}, loadingText = 'Загрузка…') {
    if (state.demoMode) {
      return demoApi(action, extra, loadingText);
    }

    assertApiIsConfigured();
    setLoading(true, loadingText);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    const payload = {
      action,
      initData: tg.initData,
      ...extra
    };

    try {
      const response = await fetch(state.apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
        },
        body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString(),
        signal: controller.signal
      });

      const text = await response.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch (error) {
        console.error('Bad server response:', text);
        throw new Error('Сервер вернул некорректный ответ');
      }

      if (!response.ok) {
        throw new Error(data.error || `Ошибка сервера: ${response.status}`);
      }

      if (!data.ok) {
        throw new Error(data.error || 'Не удалось выполнить запрос');
      }

      return data;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('Сервер не ответил вовремя. Проверьте Apps Script и интернет.');
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      setLoading(false);
    }
  }

  async function demoApi(action, extra = {}, loadingText = 'Загрузка демо…') {
    setLoading(true, loadingText);
    await wait(220);

    try {
      if (!window.__ATTENDANCE_DEMO_DB__) {
        const today = todayLocalISO();
        window.__ATTENDANCE_DEMO_DB__ = {
          students: structuredCloneSafe(DEMO_STUDENTS),
          days: {
            [today]: {
              lessonNote: 'Демо-режим: данные не отправляются на сервер.',
              records: [
                { studentId: 'demo-1', studentName: 'Анна Смирнова', status: 'present', reason: '', comment: '' },
                { studentId: 'demo-2', studentName: 'Михаил Орлов', status: 'absent', reason: 'Болел(а)', comment: 'Предупредили заранее' },
                { studentId: 'demo-3', studentName: 'София Кузнецова', status: 'present', reason: '', comment: '' },
                { studentId: 'demo-4', studentName: 'Даниил Волков', status: 'absent', reason: 'Школа / экзамен', comment: '' },
                { studentId: 'demo-5', studentName: 'Мария Белова', status: 'present', reason: '', comment: '' }
              ]
            }
          }
        };
      }

      const db = window.__ATTENDANCE_DEMO_DB__;
      const selectedDate = normalizeString(extra.date || state.date || todayLocalISO());

      if (action === 'saveAttendance') {
        db.days[selectedDate] = {
          lessonNote: normalizeString(extra.lessonNote),
          records: structuredCloneSafe(extra.records || [])
        };
        updateDemoCounters(db);
        return buildDemoPayload(selectedDate, 'Демо-журнал сохранён локально');
      }

      if (action === 'addStudent') {
        const fullName = normalizeString(extra.name);
        if (!fullName) throw new Error('Введите имя нового ученика');
        const student = {
          studentId: `demo-${Date.now()}`,
          fullName,
          sortOrder: db.students.length + 1,
          presentCount: 0,
          absentCount: 0
        };
        db.students.push(student);
        return buildDemoPayload(selectedDate, 'Ученик добавлен в демо-список');
      }

      if (action === 'deleteStudent') {
        const id = normalizeStudentId(extra.studentId);
        db.students = db.students.filter((student) => normalizeStudentId(student.studentId) !== id);
        Object.values(db.days).forEach((day) => {
          day.records = (day.records || []).filter((record) => normalizeStudentId(record.studentId) !== id);
        });
        updateDemoCounters(db);
        return buildDemoPayload(selectedDate, 'Ученик удалён из демо-списка');
      }

      if (action === 'deleteHistoryDate') {
        delete db.days[normalizeString(extra.dateToDelete)];
        updateDemoCounters(db);
        return buildDemoPayload(selectedDate, 'Дата удалена из демо-истории');
      }

      if (action === 'clearHistory') {
        db.days = {};
        updateDemoCounters(db);
        return buildDemoPayload(selectedDate, 'Демо-история очищена');
      }

      return buildDemoPayload(selectedDate);
    } finally {
      setLoading(false);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function structuredCloneSafe(value) {
    if (typeof structuredClone === 'function') {
      return structuredClone(value);
    }
    return JSON.parse(JSON.stringify(value));
  }

  function updateDemoCounters(db) {
    const counterMap = new Map();
    db.students.forEach((student) => {
      counterMap.set(normalizeStudentId(student.studentId), { present: 0, absent: 0 });
    });

    Object.values(db.days).forEach((day) => {
      (day.records || []).forEach((record) => {
        const id = normalizeStudentId(record.studentId);
        if (!counterMap.has(id)) return;
        const counters = counterMap.get(id);
        if (record.status === 'absent') counters.absent += 1;
        else counters.present += 1;
      });
    });

    db.students = db.students.map((student) => {
      const counters = counterMap.get(normalizeStudentId(student.studentId)) || { present: 0, absent: 0 };
      return {
        ...student,
        presentCount: counters.present,
        absentCount: counters.absent
      };
    });
  }

  function buildDemoPayload(selectedDate, toast = '') {
    const db = window.__ATTENDANCE_DEMO_DB__;
    const day = db.days[selectedDate] || { lessonNote: '', records: [] };
    const history = Object.entries(db.days)
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, value]) => buildHistoryEntry(date, value));

    return {
      ok: true,
      user: {
        id: 'demo-user',
        first_name: 'Демо',
        last_name: 'Пользователь',
        username: 'demo',
        isAdmin: true
      },
      canEdit: true,
      date: selectedDate,
      students: structuredCloneSafe(db.students),
      records: structuredCloneSafe(day.records || []),
      lessonNote: day.lessonNote || '',
      dateHasRecords: Boolean((day.records || []).length),
      history,
      toast
    };
  }

  function buildHistoryEntry(date, day) {
    const records = day.records || [];
    const presentList = records.filter((record) => record.status !== 'absent');
    const absentList = records.filter((record) => record.status === 'absent');
    return {
      date,
      total: records.length,
      present: presentList.length,
      absent: absentList.length,
      presentList,
      absentList,
      lessonNote: day.lessonNote || ''
    };
  }

  function normalizeStudents(students) {
    return (Array.isArray(students) ? students : [])
      .map((student, index) => ({
        ...student,
        studentId: normalizeStudentId(student.studentId ?? student.id ?? index),
        fullName: normalizeString(student.fullName ?? student.name ?? student.studentName),
        sortOrder: Number.isFinite(Number(student.sortOrder)) ? Number(student.sortOrder) : index + 1,
        presentCount: Number(student.presentCount || 0),
        absentCount: Number(student.absentCount || 0)
      }))
      .filter((student) => student.studentId && student.fullName);
  }

  function normalizeHistory(history) {
    return (Array.isArray(history) ? history : [])
      .map((row) => ({
        ...row,
        date: normalizeString(row.date),
        total: Number(row.total || 0),
        present: Number(row.present || 0),
        absent: Number(row.absent || 0),
        lessonNote: normalizeString(row.lessonNote),
        presentList: Array.isArray(row.presentList) ? row.presentList : [],
        absentList: Array.isArray(row.absentList) ? row.absentList : []
      }))
      .filter((row) => row.date)
      .sort((a, b) => b.date.localeCompare(a.date));
  }

  function normalizeRecords(students, serverRecords, fillMissingRecords = true) {
    const map = new Map();

    (Array.isArray(serverRecords) ? serverRecords : []).forEach((rec) => {
      const studentId = normalizeStudentId(rec.studentId ?? rec.id);
      if (!studentId) return;

      map.set(studentId, {
        studentId,
        studentName: normalizeString(rec.studentName ?? rec.fullName),
        status: rec.status === 'absent' ? 'absent' : 'present',
        reason: normalizeString(rec.reason),
        comment: normalizeString(rec.comment)
      });
    });

    if (fillMissingRecords) {
      students.forEach((student) => {
        const studentId = normalizeStudentId(student.studentId);
        if (!map.has(studentId)) {
          map.set(studentId, {
            studentId,
            studentName: student.fullName,
            status: 'present',
            reason: '',
            comment: ''
          });
        }
      });
    }

    return map;
  }

  function applyPayload(payload) {
    const normalizedStudents = normalizeStudents(payload.students);
    const serverSaysCanEdit = Boolean(payload.canEdit || payload.user?.isAdmin);
    const localFallbackCanEdit = isLocalAdminUser(payload.user || getTelegramUser());

    state.user = payload.user || getTelegramUser() || null;
    state.date = normalizeString(payload.date || state.date || todayLocalISO());
    state.students = normalizedStudents;
    state.history = normalizeHistory(payload.history);
    state.canEdit = Boolean(serverSaysCanEdit || localFallbackCanEdit || state.demoMode);
    state.dateHasRecords = Boolean(payload.dateHasRecords || (payload.records || []).length);
    state.lessonNote = normalizeString(payload.lessonNote);
    state.records = normalizeRecords(state.students, payload.records || [], state.canEdit);
    state.dirty = false;

    els.lessonDate.value = state.date;
    renderAll();

    if (payload.toast) showToast(payload.toast);
  }

  function renderAll() {
    renderAccessMode();
    renderLessonNote();
    renderStats();
    renderTabs();
    renderAttendance();
    renderStudentsAdmin();
    renderHistory();
    renderDirtyState();
    updateTelegramChrome();
  }

  function renderAccessMode() {
    document.body.classList.toggle('read-only-mode', !state.canEdit);
    document.body.classList.toggle('demo-mode', state.demoMode);

    const displayName = state.demoMode ? 'Демо-просмотр' : getTelegramDisplayName(state.user);
    els.userBadge.textContent = displayName;

    els.modeBadge.className = 'mode-chip';
    if (state.demoMode) {
      els.modeBadge.classList.add('demo');
      els.modeBadge.textContent = 'Демо';
    } else if (state.canEdit) {
      els.modeBadge.classList.add('admin');
      els.modeBadge.textContent = 'Админ';
    } else {
      els.modeBadge.classList.add('readonly');
      els.modeBadge.textContent = 'Просмотр';
    }

    if (state.demoMode) {
      els.accessNote.textContent = 'Демо-режим для проверки дизайна вне Telegram. Реальные данные не отправляются на сервер.';
    } else if (state.canEdit) {
      els.accessNote.textContent = 'Режим администратора: можно менять отметки, список учеников и историю сохранений.';
    } else {
      els.accessNote.textContent = 'Режим просмотра: можно смотреть текущий журнал и историю, но изменения доступны только администраторам.';
    }

    els.attendanceHelp.textContent = state.canEdit
      ? 'Выберите дату, отметьте отсутствующих и сохраните журнал. Несохранённые изменения подсвечиваются автоматически.'
      : 'Здесь видно, кто был на занятии за выбранную дату и кто отсутствовал.';

    els.studentsHelp.textContent = state.canEdit
      ? 'Добавляйте или удаляйте учеников. Счётчики показывают накопленные посещения и пропуски.'
      : 'Здесь открыт список учеников и их накопительная статистика.';

    els.historyHelp.textContent = state.canEdit
      ? 'Откройте точный список, удалите отдельную дату или очистите всю историю при необходимости.'
      : 'Откройте точный список, чтобы посмотреть посещение поимённо.';

    setElementHidden(els.markAllPresentBtn, !state.canEdit);
    setElementHidden(els.saveBtn, !state.canEdit);
    setElementHidden(els.saveBannerBtn, !state.canEdit);
    setElementHidden(els.addStudentForm, !state.canEdit);
    setElementHidden(els.clearHistoryBtn, !state.canEdit);
  }

  function setElementHidden(element, isHidden) {
    element.hidden = Boolean(isHidden);
  }

  function ensureCanEdit() {
    if (state.canEdit) return true;
    showToast('Сейчас открыт режим просмотра. Изменения доступны только администраторам.');
    haptic('warning');
    return false;
  }

  function renderLessonNote() {
    const noteText = normalizeString(state.lessonNote);

    if (document.activeElement !== els.lessonNoteInput) {
      els.lessonNoteInput.value = state.lessonNote || '';
    }

    setElementHidden(els.lessonNoteInput, !state.canEdit);
    setElementHidden(els.lessonNoteView, state.canEdit);

    if (!state.canEdit) {
      els.lessonNoteView.textContent = noteText
        ? noteText
        : (state.dateHasRecords ? 'Комментарий к занятию не указан.' : 'За эту дату журнал ещё не сохранён.');
    }
  }

  function getStats() {
    const values = Array.from(state.records.values());
    const absent = values.filter((item) => item.status === 'absent').length;
    const total = state.canEdit ? state.students.length : values.length;
    const present = Math.max(0, total - absent);
    const percent = total > 0 ? Math.round((present / total) * 100) : 0;
    return { total, present, absent, percent };
  }

  function renderStats() {
    const stats = getStats();
    els.statTotal.textContent = String(stats.total);
    els.statPresent.textContent = String(stats.present);
    els.statAbsent.textContent = String(stats.absent);
    els.attendanceProgress.style.width = `${stats.percent}%`;
    els.progressPercent.textContent = `${stats.percent}%`;
    els.progressLabel.textContent = stats.total
      ? `Присутствуют ${stats.present} из ${stats.total}`
      : 'Посещение не рассчитано';
  }

  function renderDirtyState() {
    const showBanner = state.canEdit && state.dirty;
    els.unsavedBanner.classList.toggle('hidden', !showBanner);
    els.saveBtn.textContent = state.dirty ? 'Сохранить изменения' : 'Сохранить';
    updateTelegramChrome();
  }

  function getOrderedStudents() {
    const searchValue = state.search.trim().toLocaleLowerCase('ru-RU');
    const sourceStudents = state.canEdit
      ? state.students.slice()
      : state.students.filter((student) => state.records.has(normalizeStudentId(student.studentId)));

    return sourceStudents
      .sort((a, b) => {
        const aRecord = state.records.get(normalizeStudentId(a.studentId));
        const bRecord = state.records.get(normalizeStudentId(b.studentId));
        const aAbsent = aRecord?.status === 'absent' ? 1 : 0;
        const bAbsent = bRecord?.status === 'absent' ? 1 : 0;
        if (aAbsent !== bAbsent) return bAbsent - aAbsent;
        const bySort = Number(a.sortOrder || 0) - Number(b.sortOrder || 0);
        if (bySort !== 0) return bySort;
        return a.fullName.localeCompare(b.fullName, 'ru');
      })
      .filter((student) => {
        const record = state.records.get(normalizeStudentId(student.studentId));
        const name = student.fullName.toLocaleLowerCase('ru-RU');
        const matchesSearch = !searchValue || name.includes(searchValue);
        const matchesFilter = state.filter === 'all'
          || (state.filter === 'absent' && record?.status === 'absent')
          || (state.filter === 'present' && record?.status !== 'absent');
        return matchesSearch && matchesFilter;
      });
  }

  function renderAttendance() {
    const students = getOrderedStudents();

    if (!students.length) {
      const message = !state.canEdit && !state.dateHasRecords
        ? 'За эту дату журнал ещё не сохранён.'
        : (state.students.length ? 'По этому поиску или фильтру никого нет.' : 'Список учеников пуст.');
      els.studentsList.innerHTML = renderEmptyState('Посещение', message);
      return;
    }

    els.studentsList.innerHTML = students.map((student) => renderAttendanceRow(student)).join('');
  }

  function renderAttendanceRow(student) {
    const studentId = normalizeStudentId(student.studentId);
    const record = state.records.get(studentId) || {
      studentId,
      status: 'present',
      reason: '',
      comment: ''
    };

    const isAbsent = record.status === 'absent';
    const subtitle = isAbsent ? 'Отсутствует' : 'Присутствует';
    const initials = getInitials(student.fullName);
    const counters = `Был(а): ${student.presentCount || 0} · Не был(а): ${student.absentCount || 0}`;
    const safeId = escapeHtml(studentId);

    const actions = state.canEdit ? `
      <div class="status-group" role="group" aria-label="Статус ${escapeHtml(student.fullName)}">
        <button class="status-btn ${!isAbsent ? 'active-present' : ''}" data-student-id="${safeId}" data-status="present" type="button">Был(а)</button>
        <button class="status-btn ${isAbsent ? 'active-absent' : ''}" data-student-id="${safeId}" data-status="absent" type="button">Не был(а)</button>
      </div>
      ${isAbsent ? `<button class="reason-btn" data-edit-reason="${safeId}" type="button">Причина</button>` : ''}
    ` : `
      <div class="view-status-pill ${isAbsent ? 'absent' : 'present'}">${isAbsent ? 'Не был(а)' : 'Был(а)'}</div>
    `;

    return `
      <article class="attendance-row ${isAbsent ? 'absent' : ''}" data-student-id="${safeId}">
        <div class="student-main">
          <div class="student-topline">
            <div class="avatar ${isAbsent ? 'absent' : ''}" aria-hidden="true">${escapeHtml(initials)}</div>
            <div class="name-stack">
              <div class="student-name">${escapeHtml(student.fullName)}</div>
              <div class="student-subtitle">${escapeHtml(subtitle)}</div>
              <div class="student-counter-line">${escapeHtml(counters)}</div>
            </div>
          </div>
          ${isAbsent ? renderReasonLine(record) : ''}
        </div>
        <div class="row-actions ${state.canEdit ? '' : 'view-only'}">${actions}</div>
      </article>
    `;
  }

  function renderReasonLine(record) {
    return `
      <div class="reason-line">
        <span class="reason-badge">${escapeHtml(record.reason || 'Причина не указана')}</span>
        ${record.comment ? `<span class="comment-text">${escapeHtml(record.comment)}</span>` : ''}
      </div>
    `;
  }

  function renderStudentsAdmin() {
    if (!state.students.length) {
      els.studentsAdminList.innerHTML = renderEmptyState('Ученики', 'Пока нет учеников. Администратор может добавить первого ученика.');
      return;
    }

    els.studentsAdminList.innerHTML = state.students
      .slice()
      .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.fullName.localeCompare(b.fullName, 'ru'))
      .map((student, index) => {
        const studentId = normalizeStudentId(student.studentId);
        return `
          <article class="admin-row">
            <div>
              <strong>${index + 1}. ${escapeHtml(student.fullName)}</strong>
              <div class="admin-counters">
                <span class="metric-pill success">Был(а): ${student.presentCount || 0}</span>
                <span class="metric-pill danger">Не был(а): ${student.absentCount || 0}</span>
              </div>
            </div>
            ${state.canEdit ? `<button class="danger-btn" data-delete-student="${escapeHtml(studentId)}" type="button">Удалить</button>` : ''}
          </article>
        `;
      }).join('');
  }

  function renderHistory() {
    if (!state.history.length) {
      els.historyList.innerHTML = renderEmptyState('История', 'История пока пуста. Сохраните хотя бы одну дату.');
      return;
    }

    els.historyList.innerHTML = state.history.map((row) => `
      <article class="history-row ${row.absent ? 'has-absent' : ''}">
        <div>
          <strong>${escapeHtml(formatDateRu(row.date))}</strong>
          <span>Всего отмечено: ${row.total}</span>
          <div class="history-metrics">
            <span class="metric-pill success">Были: ${row.present}</span>
            <span class="metric-pill danger">Не были: ${row.absent}</span>
          </div>
          ${row.lessonNote ? `<div class="history-note-line">${escapeHtml(row.lessonNote)}</div>` : ''}
        </div>
        <div class="history-actions-col">
          <button class="outline-btn" data-history-details="${escapeHtml(row.date)}" type="button">Точный список</button>
          ${state.canEdit ? `<button class="danger-btn" data-history-delete="${escapeHtml(row.date)}" type="button">Удалить дату</button>` : ''}
        </div>
      </article>
    `).join('');
  }

  function renderEmptyState(title, message) {
    return `
      <div class="empty-state">
        <div class="empty-state__badge">${escapeHtml(title)}</div>
        <div>${escapeHtml(message)}</div>
      </div>
    `;
  }

  function renderTabs() {
    document.querySelectorAll('.tab-btn').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === state.activeTab);
    });

    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `panel-${state.activeTab}`);
    });

    document.querySelectorAll('.filter-chip').forEach((button) => {
      button.classList.toggle('active', button.dataset.filter === state.filter);
    });

    updateTelegramChrome();
  }

  function collectRecordsForSave() {
    return state.students.map((student) => {
      const studentId = normalizeStudentId(student.studentId);
      const record = state.records.get(studentId) || {};
      const isAbsent = record.status === 'absent';
      return {
        studentId,
        studentName: student.fullName,
        status: isAbsent ? 'absent' : 'present',
        reason: isAbsent ? normalizeString(record.reason) : '',
        comment: isAbsent ? normalizeString(record.comment) : ''
      };
    });
  }

  function markDirty() {
    state.dirty = true;
    renderDirtyState();
  }

  function setStudentStatus(studentIdValue, status, options = {}) {
    if (!ensureCanEdit()) return;

    const studentId = normalizeStudentId(studentIdValue);
    const student = state.students.find((item) => normalizeStudentId(item.studentId) === studentId);
    if (!student) return;

    const currentRecord = state.records.get(studentId) || {
      studentId,
      studentName: student.fullName,
      status: 'present',
      reason: '',
      comment: ''
    };

    const nextRecord = {
      ...currentRecord,
      studentId,
      studentName: student.fullName,
      status: status === 'absent' ? 'absent' : 'present'
    };

    if (nextRecord.status === 'present') {
      nextRecord.reason = '';
      nextRecord.comment = '';
    } else if (!nextRecord.reason) {
      nextRecord.reason = REASONS[0];
    }

    state.records.set(studentId, nextRecord);
    markDirty();
    renderStats();
    renderAttendance();
    haptic();

    if (nextRecord.status === 'absent' && options.openModal !== false) {
      openReasonModal(studentId);
    }
  }

  function openReasonModal(studentIdValue) {
    if (!ensureCanEdit()) return;

    const studentId = normalizeStudentId(studentIdValue);
    const student = state.students.find((item) => normalizeStudentId(item.studentId) === studentId);
    const record = state.records.get(studentId);
    if (!student || !record) return;

    state.editingStudentId = studentId;
    els.modalStudentName.textContent = student.fullName;
    els.reasonSelect.innerHTML = REASONS.map((reason) => `
      <option value="${escapeHtml(reason)}" ${record.reason === reason ? 'selected' : ''}>${escapeHtml(reason)}</option>
    `).join('');
    els.reasonComment.value = record.comment || '';
    els.reasonModal.classList.remove('hidden');
    setTimeout(() => els.reasonSelect.focus({ preventScroll: true }), 40);
    updateTelegramChrome();
  }

  function closeReasonModal() {
    state.editingStudentId = null;
    els.reasonModal.classList.add('hidden');
    updateTelegramChrome();
  }

  function saveReasonFromModal() {
    if (!ensureCanEdit()) return;
    if (!state.editingStudentId) return;

    const record = state.records.get(state.editingStudentId);
    if (!record) return;

    state.records.set(state.editingStudentId, {
      ...record,
      status: 'absent',
      reason: normalizeString(els.reasonSelect.value),
      comment: normalizeString(els.reasonComment.value)
    });

    markDirty();
    closeReasonModal();
    renderStats();
    renderAttendance();
    haptic('success');
  }

  function markPresentFromModal() {
    if (!ensureCanEdit()) return;
    if (!state.editingStudentId) return;
    const studentId = state.editingStudentId;
    closeReasonModal();
    setStudentStatus(studentId, 'present', { openModal: false });
  }

  function openHistoryModal(dateValue) {
    const date = normalizeString(dateValue);
    const entry = state.history.find((item) => item.date === date);
    if (!entry) return;

    state.openedHistoryDate = date;
    els.historyModalTitle.textContent = formatDateRu(entry.date);

    const presentItems = normalizeHistoryList(entry.presentList)
      .map((item) => `<li>${escapeHtml(item.studentName)}</li>`)
      .join('') || '<li>Никого нет</li>';

    const absentItems = normalizeHistoryList(entry.absentList)
      .map((item) => `
        <li>
          <strong>${escapeHtml(item.studentName)}</strong>
          ${item.reason ? `<span>Причина: ${escapeHtml(item.reason)}</span>` : ''}
          ${item.comment ? `<span>Комментарий: ${escapeHtml(item.comment)}</span>` : ''}
        </li>
      `)
      .join('') || '<li>Никого нет</li>';

    els.historyModalBody.innerHTML = `
      <div class="history-modal-summary">
        <span class="metric-pill success">Были: ${entry.present}</span>
        <span class="metric-pill danger">Не были: ${entry.absent}</span>
      </div>
      ${entry.lessonNote ? `<div class="history-modal-note"><strong>Комментарий к занятию</strong><span>${escapeHtml(entry.lessonNote)}</span></div>` : ''}
      <div class="history-details-grid">
        <section class="history-details-block">
          <h4>Были</h4>
          <ul class="history-name-list">${presentItems}</ul>
        </section>
        <section class="history-details-block">
          <h4>Не были</h4>
          <ul class="history-name-list absent-list">${absentItems}</ul>
        </section>
      </div>
    `;

    els.historyModal.classList.remove('hidden');
    updateTelegramChrome();
  }

  function normalizeHistoryList(list) {
    return (Array.isArray(list) ? list : [])
      .map((item) => ({
        studentName: normalizeString(item.studentName ?? item.fullName ?? item.name),
        reason: normalizeString(item.reason),
        comment: normalizeString(item.comment)
      }))
      .filter((item) => item.studentName);
  }

  function closeHistoryModal() {
    state.openedHistoryDate = null;
    els.historyModal.classList.add('hidden');
    updateTelegramChrome();
  }

  async function loadInitial() {
    try {
      const payload = await api('init', { date: state.date }, 'Загружаем журнал…');
      applyPayload(payload);
    } catch (error) {
      showToast(error.message || 'Не удалось загрузить журнал');
      renderAccessMode();
      updateTelegramChrome();
    }
  }

  async function loadDay(date) {
    const payload = await api('getDay', { date }, 'Загружаем выбранную дату…');
    applyPayload(payload);
  }

  async function saveJournal() {
    if (!ensureCanEdit()) return;

    try {
      const payload = await api(
        'saveAttendance',
        {
          date: state.date,
          records: collectRecordsForSave(),
          lessonNote: normalizeString(state.lessonNote)
        },
        'Сохраняем журнал…'
      );
      applyPayload(payload);
      haptic('success');
    } catch (error) {
      haptic('error');
      showToast(error.message || 'Не удалось сохранить журнал');
    }
  }

  async function addStudent() {
    if (!ensureCanEdit()) return;

    const name = normalizeString(els.newStudentName.value);
    if (!name) {
      showToast('Введите имя нового ученика');
      return;
    }

    try {
      const payload = await api('addStudent', { name, date: state.date }, 'Добавляем ученика…');
      els.newStudentName.value = '';
      applyPayload(payload);
      setActiveTab('students');
      haptic('success');
    } catch (error) {
      haptic('error');
      showToast(error.message || 'Не удалось добавить ученика');
    }
  }

  async function deleteStudent(studentIdValue) {
    if (!ensureCanEdit()) return;

    const studentId = normalizeStudentId(studentIdValue);
    const student = state.students.find((item) => normalizeStudentId(item.studentId) === studentId);
    if (!student) return;

    const ok = await confirmAction({
      title: 'Удалить ученика?',
      text: `«${student.fullName}» будет удалён из списка. Если сервер удаляет строки физически, действие нельзя быстро отменить.`,
      acceptText: 'Удалить'
    });
    if (!ok) return;

    try {
      const payload = await api('deleteStudent', { studentId, date: state.date }, 'Удаляем ученика…');
      applyPayload(payload);
      haptic('success');
    } catch (error) {
      haptic('error');
      showToast(error.message || 'Не удалось удалить ученика');
    }
  }

  async function deleteHistoryDate(dateValue) {
    if (!ensureCanEdit()) return;

    const dateToDelete = normalizeString(dateValue);
    const ok = await confirmAction({
      title: 'Удалить дату?',
      text: `Сохранение за ${formatDateRu(dateToDelete)} будет удалено из истории.`,
      acceptText: 'Удалить дату'
    });
    if (!ok) return;

    try {
      const payload = await api('deleteHistoryDate', { date: state.date, dateToDelete }, 'Удаляем дату…');
      closeHistoryModal();
      applyPayload(payload);
      haptic('success');
    } catch (error) {
      haptic('error');
      showToast(error.message || 'Не удалось удалить дату');
    }
  }

  async function clearHistory() {
    if (!ensureCanEdit()) return;

    if (!state.history.length) {
      showToast('История уже пустая');
      return;
    }

    const first = await confirmAction({
      title: 'Очистить всю историю?',
      text: 'Будут удалены все сохранённые даты журнала. Список учеников останется.',
      acceptText: 'Очистить'
    });
    if (!first) return;

    const second = await confirmAction({
      title: 'Последнее подтверждение',
      text: 'Историю нельзя будет восстановить из интерфейса приложения.',
      acceptText: 'Да, очистить'
    });
    if (!second) return;

    try {
      const payload = await api('clearHistory', { date: state.date }, 'Очищаем историю…');
      closeHistoryModal();
      applyPayload(payload);
      haptic('success');
    } catch (error) {
      haptic('error');
      showToast(error.message || 'Не удалось очистить историю');
    }
  }

  function markAllPresent() {
    if (!ensureCanEdit()) return;

    state.students.forEach((student) => {
      const studentId = normalizeStudentId(student.studentId);
      state.records.set(studentId, {
        studentId,
        studentName: student.fullName,
        status: 'present',
        reason: '',
        comment: ''
      });
    });

    markDirty();
    renderStats();
    renderAttendance();
    haptic('success');
    showToast('Все отмечены как присутствующие');
  }

  async function confirmAction({ title, text, acceptText = 'Подтвердить', cancelText = 'Отмена' }) {
    if (state.pendingConfirmResolve) {
      state.pendingConfirmResolve(false);
      state.pendingConfirmResolve = null;
    }

    els.confirmTitle.textContent = title;
    els.confirmText.textContent = text;
    els.confirmAcceptBtn.textContent = acceptText;
    els.confirmCancelBtn.textContent = cancelText;
    els.confirmModal.classList.remove('hidden');
    updateTelegramChrome();

    return new Promise((resolve) => {
      state.pendingConfirmResolve = resolve;
    });
  }

  function resolveConfirm(value) {
    els.confirmModal.classList.add('hidden');
    if (state.pendingConfirmResolve) {
      state.pendingConfirmResolve(Boolean(value));
      state.pendingConfirmResolve = null;
    }
    updateTelegramChrome();
  }

  async function handleDateChange() {
    const nextDate = els.lessonDate.value || todayLocalISO();
    const previousDate = state.date;

    if (nextDate === previousDate) return;

    if (state.canEdit && state.dirty) {
      const ok = await confirmAction({
        title: 'Перейти без сохранения?',
        text: 'На текущей дате есть несохранённые изменения. При переходе они будут потеряны.',
        acceptText: 'Перейти'
      });

      if (!ok) {
        els.lessonDate.value = previousDate;
        return;
      }
    }

    state.date = nextDate;

    try {
      await loadDay(nextDate);
    } catch (error) {
      els.lessonDate.value = previousDate;
      state.date = previousDate;
      showToast(error.message || 'Не удалось загрузить дату');
    }
  }

  function setActiveTab(tab) {
    if (!['attendance', 'students', 'history'].includes(tab)) return;
    state.activeTab = tab;
    renderTabs();
    haptic();
  }

  function bindUI() {
    els.lessonDate.addEventListener('change', handleDateChange);

    els.lessonNoteInput.addEventListener('input', () => {
      if (!state.canEdit) return;
      state.lessonNote = els.lessonNoteInput.value || '';
      markDirty();
    });

    els.searchInput.addEventListener('input', () => {
      state.search = els.searchInput.value || '';
      renderAttendance();
    });

    els.filterRow.addEventListener('click', (event) => {
      const button = event.target.closest('[data-filter]');
      if (!button) return;
      state.filter = button.dataset.filter;
      renderTabs();
      renderAttendance();
      haptic();
    });

    document.querySelectorAll('.tab-btn').forEach((button) => {
      button.addEventListener('click', () => setActiveTab(button.dataset.tab));
    });

    els.studentsList.addEventListener('click', (event) => {
      const statusButton = event.target.closest('[data-status]');
      if (statusButton) {
        setStudentStatus(statusButton.dataset.studentId, statusButton.dataset.status, {
          openModal: statusButton.dataset.status === 'absent'
        });
        return;
      }

      const reasonButton = event.target.closest('[data-edit-reason]');
      if (reasonButton) {
        openReasonModal(reasonButton.dataset.editReason);
      }
    });

    els.studentsAdminList.addEventListener('click', (event) => {
      const deleteButton = event.target.closest('[data-delete-student]');
      if (!deleteButton) return;
      deleteStudent(deleteButton.dataset.deleteStudent);
    });

    els.historyList.addEventListener('click', (event) => {
      const detailsButton = event.target.closest('[data-history-details]');
      if (detailsButton) {
        openHistoryModal(detailsButton.dataset.historyDetails);
        return;
      }

      const deleteButton = event.target.closest('[data-history-delete]');
      if (deleteButton) {
        deleteHistoryDate(deleteButton.dataset.historyDelete);
      }
    });

    els.markAllPresentBtn.addEventListener('click', markAllPresent);
    els.saveBtn.addEventListener('click', saveJournal);
    els.saveBannerBtn.addEventListener('click', saveJournal);
    els.addStudentForm.addEventListener('submit', (event) => {
      event.preventDefault();
      addStudent();
    });
    els.clearHistoryBtn.addEventListener('click', clearHistory);

    els.closeModalBtn.addEventListener('click', closeReasonModal);
    els.saveReasonBtn.addEventListener('click', saveReasonFromModal);
    els.markPresentFromModalBtn.addEventListener('click', markPresentFromModal);
    els.reasonModal.addEventListener('click', (event) => {
      if (event.target === els.reasonModal) closeReasonModal();
    });

    els.closeHistoryModalBtn.addEventListener('click', closeHistoryModal);
    els.historyModal.addEventListener('click', (event) => {
      if (event.target === els.historyModal) closeHistoryModal();
    });

    els.confirmCancelBtn.addEventListener('click', () => resolveConfirm(false));
    els.confirmAcceptBtn.addEventListener('click', () => resolveConfirm(true));
    els.confirmModal.addEventListener('click', (event) => {
      if (event.target === els.confirmModal) resolveConfirm(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (!els.reasonModal.classList.contains('hidden')) closeReasonModal();
      else if (!els.historyModal.classList.contains('hidden')) closeHistoryModal();
      else if (!els.confirmModal.classList.contains('hidden')) resolveConfirm(false);
    });

    window.addEventListener('beforeunload', (event) => {
      if (!state.canEdit || !state.dirty) return;
      event.preventDefault();
      event.returnValue = '';
    });
  }

  function getInitials(name) {
    const parts = normalizeString(name).split(/\s+/).filter(Boolean);
    if (!parts.length) return '•';
    const first = parts[0]?.[0] || '';
    const second = parts.length > 1 ? parts[1]?.[0] || '' : '';
    return (first + second).toLocaleUpperCase('ru-RU');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatDateRu(isoDate) {
    const value = normalizeString(isoDate);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return value || 'Дата не указана';

    const date = new Date(`${value}T00:00:00`);
    return new Intl.DateTimeFormat('ru-RU', {
      day: '2-digit',
      month: 'long',
      year: 'numeric'
    }).format(date);
  }

  function bootstrap() {
    state.date = todayLocalISO();
    els.lessonDate.value = state.date;
    initTelegram();
    bindUI();
    renderAccessMode();
    renderStats();
    renderDirtyState();
    loadInitial();
  }

  bootstrap();
})();
