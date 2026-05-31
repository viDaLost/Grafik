const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;

const REASONS = [
  'Болел(а)',
  'Семейные обстоятельства',
  'Уехал(а)',
  'Школа / экзамен',
  'Предупредил(а) заранее',
  'Без причины',
  'Другое'
];

const state = {
  apiUrl: (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '',
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
  lessonNote: ''
};

const els = {
  lessonDate: document.getElementById('lessonDate'),
  studentsList: document.getElementById('studentsList'),
  studentsAdminList: document.getElementById('studentsAdminList'),
  historyList: document.getElementById('historyList'),
  statTotal: document.getElementById('statTotal'),
  statPresent: document.getElementById('statPresent'),
  statAbsent: document.getElementById('statAbsent'),
  addStudentBtn: document.getElementById('addStudentBtn'),
  newStudentName: document.getElementById('newStudentName'),
  markAllPresentBtn: document.getElementById('markAllPresentBtn'),
  clearHistoryBtn: document.getElementById('clearHistoryBtn'),
  userBadge: document.getElementById('userBadge'),
  accessNote: document.getElementById('accessNote'),
  attendanceHelp: document.getElementById('attendanceHelp'),
  lessonNoteInput: document.getElementById('lessonNoteInput'),
  lessonNoteView: document.getElementById('lessonNoteView'),
  studentsHelp: document.getElementById('studentsHelp'),
  historyHelp: document.getElementById('historyHelp'),
  loadingOverlay: document.getElementById('loadingOverlay'),
  loadingText: document.getElementById('loadingText'),
  toast: document.getElementById('toast'),
  searchInput: document.getElementById('searchInput'),
  filterRow: document.getElementById('filterRow'),
  reasonModal: document.getElementById('reasonModal'),
  modalStudentName: document.getElementById('modalStudentName'),
  reasonSelect: document.getElementById('reasonSelect'),
  reasonComment: document.getElementById('reasonComment'),
  saveReasonBtn: document.getElementById('saveReasonBtn'),
  markPresentFromModalBtn: document.getElementById('markPresentFromModalBtn'),
  historyModal: document.getElementById('historyModal'),
  historyModalTitle: document.getElementById('historyModalTitle'),
  historyModalBody: document.getElementById('historyModalBody'),
  addStudentControls: document.getElementById('addStudentControls')
};

function initTelegram() {
  if (!tg) {
    showToast('Приложение запущено вне Telegram. Доступен демо-режим.');
    return;
  }

  tg.ready();
  tg.expand();
  
  // Привязка цветов к системной теме Telegram
  updateTelegramThemeColors();

  const displayName = [
    tg.initDataUnsafe?.user?.first_name,
    tg.initDataUnsafe?.user?.last_name
  ].filter(Boolean).join(' ') || tg.initDataUnsafe?.user?.username || 'Пользователь';

  els.userBadge.textContent = displayName;
  
  // Инициализация обработчиков нативных кнопок Telegram
  if (tg.MainButton) {
    tg.MainButton.onClick(saveJournal);
  }
  if (tg.BackButton) {
    tg.BackButton.onClick(handleNativeBackButtonClick);
  }
}

function updateTelegramThemeColors() {
  if (!tg) return;
  const headerColor = tg.themeParams.header_bg_color || '#eff3ff';
  const bgColor = tg.themeParams.bg_color || '#eff3ff';
  tg.setHeaderColor(headerColor);
  tg.setBackgroundColor(bgColor);
}

function handleNativeBackButtonClick() {
  triggerHaptic('light');
  if (state.editingStudentId) {
    closeReasonModal();
  } else if (state.openedHistoryDate) {
    closeHistoryModal();
  }
}

function triggerHaptic(style = 'light') {
  if (!tg || !tg.HapticFeedback) return;
  switch(style) {
    case 'light': tg.HapticFeedback.impactOccurred('light'); break;
    case 'medium': tg.HapticFeedback.impactOccurred('medium'); break;
    case 'success': tg.HapticFeedback.notificationOccurred('success'); break;
    case 'error': tg.HapticFeedback.notificationOccurred('error'); break;
  }
}

function updateNativeMainButton() {
  if (!tg || !tg.MainButton) return;

  if (state.canEdit && state.dirty && state.activeTab === 'attendance') {
    tg.MainButton.setText('Сохранить изменения');
    tg.MainButton.show();
    tg.MainButton.enable();
  } else {
    tg.MainButton.hide();
  }
}

function setLoading(isLoading, text = 'Синхронизация…') {
  els.loadingText.textContent = text;
  els.loadingOverlay.classList.toggle('hidden', !isLoading);
}

function normalizeUiErrorMessage(message) {
  const text = String(message || '').trim();
  if (!text) return 'Непредвиденная ошибка';
  if (text === 'Failed to fetch' || text === 'Load failed') return 'Отсутствует подключение к сети';
  return text;
}

function showToast(message) {
  if (!message) return;
  els.toast.textContent = normalizeUiErrorMessage(message);
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 3000);
}

function todayLocalISO() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

async function api(action, extra = {}, loadingText = 'Загрузка…') {
  if (!state.apiUrl || state.apiUrl.includes('PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE')) {
    throw new Error('Укажите корректный API URL в конфигурационном файле config.js');
  }
  if (!tg || !tg.initData) {
    throw new Error('Авторизация не удалась. Откройте приложение внутри Telegram');
  }

  setLoading(true, loadingText);

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
      body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
    });

    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (error) {
      throw new Error('Критический сбой: Сервер вернул некорректный формат данных');
    }

    if (!data.ok) {
      throw new Error(data.error || 'Ошибка выполнения серверного сценария');
    }

    return data;
  } finally {
    setLoading(false);
  }
}

function normalizeRecords(students, serverRecords, fillMissingRecords = true) {
  const map = new Map();

  (serverRecords || []).forEach((rec) => {
    map.set(rec.studentId, {
      studentId: rec.studentId,
      studentName: rec.studentName,
      status: rec.status === 'absent' ? 'absent' : 'present',
      reason: rec.reason || '',
      comment: rec.comment || ''
    });
  });

  if (fillMissingRecords) {
    students.forEach((student) => {
      if (!map.has(student.studentId)) {
        map.set(student.studentId, {
          studentId: student.studentId,
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

function getLocalAdminTelegramIds() {
  const ids = window.APP_CONFIG && Array.isArray(window.APP_CONFIG.ADMIN_TELEGRAM_IDS)
    ? window.APP_CONFIG.ADMIN_TELEGRAM_IDS
    : [];
  return ids.map((item) => String(item || '').trim()).filter(Boolean);
}

function isLocalAdminUser(user) {
  if (!user || !user.id) return false;
  return getLocalAdminTelegramIds().includes(String(user.id).trim());
}

function applyPayload(payload) {
  state.user = payload.user || null;
  state.date = payload.date;
  state.students = payload.students || [];
  state.history = payload.history || [];
  
  const serverSaysCanEdit = Boolean(payload.canEdit || payload.user?.isAdmin);
  const localFallbackCanEdit = isLocalAdminUser(payload.user || null);
  state.canEdit = serverSaysCanEdit || localFallbackCanEdit;
  
  state.dateHasRecords = Boolean(payload.dateHasRecords || (payload.records || []).length);
  state.lessonNote = String(payload.lessonNote || '');
  state.records = normalizeRecords(state.students, payload.records || [], state.canEdit);
  state.dirty = false;
  
  els.lessonDate.value = state.date;
  renderAll();
  
  if (payload.toast) {
    showToast(payload.toast);
  }
}

function renderAll() {
  renderAccessMode();
  renderLessonNote();
  renderStats();
  renderTabs();
  renderAttendance();
  renderStudentsAdmin();
  renderHistory();
  updateNativeMainButton();
}

function getCurrentUserDisplayName() {
  if (!state.user) return 'Пользователь';
  return [state.user.first_name, state.user.last_name].filter(Boolean).join(' ')
    || state.user.username
    || 'Пользователь';
}

function renderAccessMode() {
  const isAdmin = state.canEdit;
  document.body.classList.toggle('read-only-mode', !isAdmin);

  if (els.userBadge) {
    els.userBadge.textContent = (isAdmin ? 'Админ: ' : 'Просмотр: ') + getCurrentUserDisplayName();
  }
  if (els.accessNote) {
    els.accessNote.textContent = isAdmin
      ? 'Режим редактирования: вам доступны любые изменения данных.'
      : 'Режим просмотра: изменения заблокированы администратором.';
  }
  if (els.attendanceHelp) {
    els.attendanceHelp.textContent = isAdmin
      ? 'Управляйте статусами посещения. Изменения сохраняются нативной кнопкой внизу.'
      : 'Архивная выписка посещаемости за выбранную календарную дату.';
  }
  if (els.studentsHelp) {
    els.studentsHelp.textContent = isAdmin
      ? 'Добавляйте новые профили или производите безвозвратное удаление участников.'
      : 'Актуальный список зарегистрированных участников учебного процесса.';
  }
  if (els.historyHelp) {
    els.historyHelp.textContent = isAdmin
      ? 'История сохранений. Доступен детальный просмотр и удаление контрольных точек.'
      : 'Просмотр логов посещаемости по дням.';
  }

  // Скрытие управляющих элементов при отсутствии прав
  els.markAllPresentBtn.classList.toggle('hidden', !isAdmin);
  els.clearHistoryBtn.classList.toggle('hidden', !isAdmin);
  if (els.addStudentControls) {
    els.addStudentControls.classList.toggle('hidden', !isAdmin);
  }
}

function ensureCanEdit() {
  if (state.canEdit) return true;
  triggerHaptic('error');
  showToast('Действие запрещено. У вас активирован режим просмотра.');
  return false;
}

function renderLessonNote() {
  if (!els.lessonNoteInput || !els.lessonNoteView) return;

  const noteText = String(state.lessonNote || '').trim();
  els.lessonNoteInput.value = noteText;

  els.lessonNoteInput.classList.toggle('hidden', !state.canEdit);
  els.lessonNoteView.classList.toggle('hidden', state.canEdit);

  if (!state.canEdit) {
    els.lessonNoteView.textContent = noteText
      ? noteText
      : (state.dateHasRecords ? 'Комментарий к занятию отсутствует.' : 'Журнал на выбранную дату ещё не сформирован.');
  }
}

function renderStats() {
  const values = Array.from(state.records.values());

  if (!state.canEdit) {
    const absent = values.filter((item) => item.status === 'absent').length;
    const present = values.filter((item) => item.status !== 'absent').length;
    els.statTotal.textContent = String(values.length);
    els.statPresent.textContent = String(present);
    els.statAbsent.textContent = String(absent);
    return;
  }

  const absent = values.filter((item) => item.status === 'absent').length;
  const total = state.students.length;
  const present = total - absent;

  els.statTotal.textContent = String(total);
  els.statPresent.textContent = String(Math.max(0, present));
  els.statAbsent.textContent = String(absent);
}

function getOrderedStudents() {
  const searchValue = state.search.trim().toLowerCase();
  const sourceStudents = state.canEdit
    ? state.students.slice()
    : state.students.filter((student) => state.records.has(student.studentId));
    
  const students = sourceStudents.sort((a, b) => {
    const aAbsent = state.records.get(a.studentId)?.status === 'absent' ? 1 : 0;
    const bAbsent = state.records.get(b.studentId)?.status === 'absent' ? 1 : 0;
    if (aAbsent !== bAbsent) return bAbsent - aAbsent;
    return (a.sortOrder || 0) - (b.sortOrder || 0);
  });

  return students.filter((student) => {
    const record = state.records.get(student.studentId);
    const matchesSearch = !searchValue || student.fullName.toLowerCase().includes(searchValue);
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
      : (state.students.length ? 'По вашему фильтру никто не найден.' : 'Список учеников пуст.');
    els.studentsList.innerHTML = `<div class="empty-state-card">${message}</div>`;
    return;
  }

  els.studentsList.innerHTML = students.map((student) => {
    const record = state.records.get(student.studentId) || {
      status: 'present',
      reason: '',
      comment: ''
    };

    const isAbsent = record.status === 'absent';
    const initials = student.fullName.trim().charAt(0).toUpperCase();
    const counters = `Присутствие: ${student.presentCount || 0} · Пропуски: ${student.absentCount || 0}`;
    
    let actionMarkup = '';
    if (state.canEdit) {
      actionMarkup = `
        <div class="card-action-row">
          <button class="tma-toggle-btn btn-state-present ${!isAbsent ? 'selected' : ''}" data-student-id="${student.studentId}" data-status="present">Был(а)</button>
          <button class="tma-toggle-btn btn-state-absent ${isAbsent ? 'selected' : ''}" data-student-id="${student.studentId}" data-status="absent">Н/Я</button>
        </div>
      `;
    } else {
      actionMarkup = `
        <div class="badge-status-static ${isAbsent ? 'type-absent' : 'type-present'}">
          ${isAbsent ? 'Отсутствовал(а)' : 'Присутствовал(а)'}
        </div>
      `;
    }

    return `
      <article class="student-profile-card ${isAbsent ? 'status-absent-mode' : ''}" data-student-id="${student.studentId}">
        <div class="card-main-content">
          <div class="avatar-circle">${escapeHtml(initials)}</div>
          <div class="profile-details">
            <h4 class="profile-name">${escapeHtml(student.fullName)}</h4>
            <div class="profile-statistics-line">${escapeHtml(counters)}</div>
            ${isAbsent ? `
              <div class="reason-container-sub" data-edit-reason="${student.studentId}">
                <span class="reason-tag">${escapeHtml(record.reason || 'Причина отсутствует')}</span>
                ${record.comment ? `<p class="comment-subtext">«${escapeHtml(record.comment)}»</p>` : ''}
                ${state.canEdit ? '<span class="edit-reason-trigger-text">Изменить причину</span>' : ''}
              </div>
            ` : ''}
          </div>
        </div>
        <div class="card-control-wrapper">
          ${actionMarkup}
        </div>
      </article>
    `;
  }).join('');
}

function renderStudentsAdmin() {
  if (!state.students.length) {
    els.studentsAdminList.innerHTML = '<div class="empty-state-card">Список учащихся пуст.</div>';
    return;
  }

  els.studentsAdminList.innerHTML = state.students.map((student, index) => `
    <div class="list-row-item">
      <div class="item-info">
        <span class="item-index">${index + 1}.</span>
        <strong class="item-title">${escapeHtml(student.fullName)}</strong>
        <div class="counters-row">
          <span class="micro-badge color-success">Посетил(а): ${student.presentCount || 0}</span>
          <span class="micro-badge color-danger">Пропустил(а): ${student.absentCount || 0}</span>
        </div>
      </div>
      ${state.canEdit ? `<button class="btn-action-destructive" data-delete-student="${student.studentId}">Удалить</button>` : ''}
    </div>
  `).join('');
}

function renderHistory() {
  if (!state.history.length) {
    els.historyList.innerHTML = '<div class="empty-state-card">Архив пуст. Сохраните журнал, чтобы создать запись.</div>';
    return;
  }

  els.historyList.innerHTML = state.history.map((row) => `
    <div class="list-row-item item-vertical-align">
      <div class="item-info">
        <strong class="item-title-large">${formatDateRu(row.date)}</strong>
        <div class="counters-row margin-tight">
          <span class="micro-badge">Всего: ${row.total}</span>
          <span class="micro-badge color-success">Были: ${row.present}</span>
          <span class="micro-badge color-danger">Н/Я: ${row.absent}</span>
        </div>
        ${row.lessonNote ? `<div class="history-log-note-preview">${escapeHtml(row.lessonNote)}</div>` : ''}
      </div>
      <div class="item-actions-cluster">
        <button class="btn-action-outline" data-history-details="${row.date}">Детально</button>
        ${state.canEdit ? `<button class="btn-action-destructive" data-history-delete="${row.date}">Удалить</button>` : ''}
      </div>
    </div>
  `).join('');
}

function renderTabs() {
  document.querySelectorAll('.nav-tab-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.tab === state.activeTab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${state.activeTab}`);
  });
  document.querySelectorAll('.filter-chip').forEach((button) => {
    button.classList.toggle('active', button.dataset.filter === state.filter);
  });
}

function collectRecordsForSave() {
  return state.students.map((student) => {
    const record = state.records.get(student.studentId) || {};
    const isAbsent = record.status === 'absent';
    return {
      studentId: student.studentId,
      studentName: student.fullName,
      status: isAbsent ? 'absent' : 'present',
      reason: isAbsent ? (record.reason || '') : '',
      comment: isAbsent ? (record.comment || '') : ''
    };
  });
}

function setStudentStatus(studentId, status, options = {}) {
  if (!ensureCanEdit()) return;
  const record = state.records.get(studentId);
  const student = state.students.find((item) => item.studentId === studentId);
  if (!record || !student) return;

  record.status = status;
  if (status === 'present') {
    record.reason = '';
    record.comment = '';
    triggerHaptic('light');
  } else if (!record.reason) {
    record.reason = REASONS[0];
    triggerHaptic('medium');
  }

  state.records.set(studentId, record);
  state.dirty = true;
  
  renderStats();
  renderAttendance();
  updateNativeMainButton();

  if (status === 'absent' && options.openModal !== false) {
    openReasonModal(studentId);
  }
}

function openReasonModal(studentId) {
  const student = state.students.find((item) => item.studentId === studentId);
  const record = state.records.get(studentId);
  if (!student || !record) return;

  state.editingStudentId = studentId;
  els.modalStudentName.textContent = student.fullName;
  els.reasonSelect.innerHTML = REASONS.map((reason) => `
    <option value="${escapeHtml(reason)}" ${record.reason === reason ? 'selected' : ''}>${escapeHtml(reason)}</option>
  `).join('');
  els.reasonComment.value = record.comment || '';
  
  els.reasonModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  
  if (tg && tg.BackButton) {
    tg.BackButton.show();
  }
}

function closeReasonModal() {
  state.editingStudentId = null;
  els.reasonModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  
  if (tg && tg.BackButton && !state.openedHistoryDate) {
    tg.BackButton.hide();
  }
}

function saveReasonFromModal() {
  if (!ensureCanEdit()) return;
  if (!state.editingStudentId) return;
  
  const record = state.records.get(state.editingStudentId);
  if (!record) return;
  
  record.status = 'absent';
  record.reason = els.reasonSelect.value;
  record.comment = els.reasonComment.value.trim();
  
  state.records.set(state.editingStudentId, record);
  state.dirty = true;
  
  closeReasonModal();
  renderStats();
  renderAttendance();
  updateNativeMainButton();
  triggerHaptic('success');
}

function markPresentFromModal() {
  if (!ensureCanEdit()) return;
  if (!state.editingStudentId) return;
  setStudentStatus(state.editingStudentId, 'present', { openModal: false });
  closeReasonModal();
}

function openHistoryModal(date) {
  const entry = state.history.find((item) => item.date === date);
  if (!entry) return;

  state.openedHistoryDate = date;
  els.historyModalTitle.textContent = formatDateRu(entry.date);

  const presentItems = (entry.presentList || []).map((item) => `<li>${escapeHtml(item.studentName)}</li>`).join('') || '<li>Список пуст</li>';
  const absentItems = (entry.absentList || []).map((item) => `
    <li>
      <strong class="item-name-block">${escapeHtml(item.studentName)}</strong>
      ${item.reason ? `<span class="reason-text-block">Причина: ${escapeHtml(item.reason)}</span>` : ''}
      ${item.comment ? `<span class="comment-text-block">Комментарий: ${escapeHtml(item.comment)}</span>` : ''}
    </li>
  `).join('') || '<li>Список пуст</li>';

  els.historyModalBody.innerHTML = `
    <div class="summary-pill-container">
      <span class="ui-status-badge present-badge">Присутствовали: ${entry.present}</span>
      <span class="ui-status-badge absent-badge">Отсутствовали: ${entry.absent}</span>
    </div>
    ${entry.lessonNote ? `<div class="history-context-box"><strong>Заметки к уроку:</strong><p>${escapeHtml(entry.lessonNote)}</p></div>` : ''}
    <div class="split-history-lists">
      <section class="history-column-list">
        <h5>Были на занятии</h5>
        <ul class="native-render-list">${presentItems}</ul>
      </section>
      <section class="history-column-list border-danger-left">
        <h5>Не явились</h5>
        <ul class="native-render-list type-absent-list">${absentItems}</ul>
      </section>
    </div>
  `;

  els.historyModal.classList.remove('hidden');
  document.body.classList.add('modal-open');
  
  if (tg && tg.BackButton) {
    tg.BackButton.show();
  }
}

function closeHistoryModal() {
  state.openedHistoryDate = null;
  els.historyModal.classList.add('hidden');
  document.body.classList.remove('modal-open');
  
  if (tg && tg.BackButton && !state.editingStudentId) {
    tg.BackButton.hide();
  }
}

async function loadInitial() {
  try {
    const payload = await api('init', { date: state.date }, 'Загрузка данных...');
    applyPayload(payload);
  } catch (error) {
    showToast(error.message || 'Ошибка первичной синхронизации данных');
  }
}

async function saveJournal() {
  if (!ensureCanEdit()) return;
  try {
    const payload = await api(
      'saveAttendance',
      { date: state.date, records: collectRecordsForSave(), lessonNote: state.lessonNote.trim() },
      'Сохранение данных...'
    );
    applyPayload(payload);
    triggerHaptic('success');
  } catch (error) {
    triggerHaptic('error');
    showToast(error.message || 'Не удалось сохранить изменения в облако');
  }
}

async function addStudent() {
  if (!ensureCanEdit()) return;
  const name = els.newStudentName.value.trim();
  if (!name) {
    triggerHaptic('error');
    showToast('Заполните поле с именем ученика');
    return;
  }

  try {
    const payload = await api('addStudent', { name, date: state.date }, 'Добавление ученика...');
    els.newStudentName.value = '';
    applyPayload(payload);
    state.activeTab = 'students';
    renderTabs();
    triggerHaptic('success');
  } catch (error) {
    showToast(error.message || 'Не удалось добавить запись');
  }
}

async function deleteStudent(studentId) {
  if (!ensureCanEdit()) return;
  const student = state.students.find((item) => item.studentId === studentId);
  if (!student) return;
  
  const ok = window.confirm(`Вы действительно хотите удалить ученика «${student.fullName}»? Это действие сотрет всю его историю посещений.`);
  if (!ok) return;

  try {
    const payload = await api('deleteStudent', { studentId, date: state.date }, 'Удаление профиля...');
    applyPayload(payload);
    triggerHaptic('success');
  } catch (error) {
    showToast(error.message || 'Ошибка удаления записи');
  }
}

async function deleteHistoryDate(date) {
  if (!ensureCanEdit()) return;
  const ok = window.confirm(`Удалить архивные данные за ${formatDateRu(date)}?`);
  if (!ok) return;

  try {
    const payload = await api('deleteHistoryDate', { date: state.date, dateToDelete: date }, 'Удаление логов...');
    closeHistoryModal();
    applyPayload(payload);
    triggerHaptic('success');
  } catch (error) {
    showToast(error.message || 'Не удалось удалить архивную точку');
  }
}

async function clearHistory() {
  if (!ensureCanEdit()) return;
  if (!state.history.length) {
    showToast('Архив уже пуст');
    return;
  }

  const first = window.confirm('Внимание! Вы собираетесь очистить абсолютно ВСЮ историю журналов. Продолжить?');
  if (!first) return;
  const second = window.confirm('Повторное подтверждение: данные будут утеряны безвозвратно. Вы уверены?');
  if (!second) return;

  try {
    const payload = await api('clearHistory', { date: state.date }, 'Сброс архива...');
    closeHistoryModal();
    applyPayload(payload);
    triggerHaptic('success');
  } catch (error) {
    showToast(error.message || 'Ошибка глобальной очистки базы данных');
  }
}

function markAllPresent() {
  if (!ensureCanEdit()) return;
  state.students.forEach((student) => {
    state.records.set(student.studentId, {
      studentId: student.studentId,
      studentName: student.fullName,
      status: 'present',
      reason: '',
      comment: ''
    });
  });
  state.dirty = true;
  renderStats();
  renderAttendance();
  updateNativeMainButton();
  triggerHaptic('medium');
  showToast('Все учащиеся отмечены как присутствующие');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDateRu(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
    year: 'numeric'
  }).format(date);
}

function bindUI() {
  els.lessonDate.addEventListener('change', async () => {
    state.date = els.lessonDate.value;
    try {
      const payload = await api('getDay', { date: state.date }, 'Синхронизация даты...');
      applyPayload(payload);
    } catch (error) {
      showToast(error.message || 'Не удалось загрузить данные за указанный день');
    }
  });

  if (els.lessonNoteInput) {
    els.lessonNoteInput.addEventListener('input', () => {
      if (!state.canEdit) return;
      state.lessonNote = els.lessonNoteInput.value || '';
      state.dirty = true;
      updateNativeMainButton();
    });
  }

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value || '';
    renderAttendance();
  });

  els.filterRow.addEventListener('click', (event) => {
    const button = event.target.closest('[data-filter]');
    if (!button) return;
    triggerHaptic('light');
    state.filter = button.dataset.filter;
    renderTabs();
    renderAttendance();
  });

  document.querySelectorAll('.nav-tab-item').forEach((button) => {
    button.addEventListener('click', () => {
      triggerHaptic('light');
      state.activeTab = button.dataset.tab;
      renderTabs();
      updateNativeMainButton();
    });
  });

  els.studentsList.addEventListener('click', (event) => {
    const statusButton = event.target.closest('[data-status]');
    if (statusButton) {
      const studentId = statusButton.dataset.studentId;
      const newStatus = statusButton.dataset.status;
      setStudentStatus(studentId, newStatus, { openModal: newStatus === 'absent' });
      return;
    }

    const reasonButton = event.target.closest('[data-edit-reason]');
    if (reasonButton) {
      triggerHaptic('light');
      openReasonModal(reasonButton.dataset.editReason);
    }
  });

  els.studentsAdminList.addEventListener('click', (event) => {
    const deleteButton = event.target.closest('[data-delete-student]');
    if (!deleteButton) return;
    triggerHaptic('medium');
    deleteStudent(deleteButton.dataset.deleteStudent);
  });

  els.historyList.addEventListener('click', (event) => {
    const detailsButton = event.target.closest('[data-history-details]');
    if (detailsButton) {
      triggerHaptic('light');
      openHistoryModal(detailsButton.dataset.historyDetails);
      return;
    }
    const deleteButton = event.target.closest('[data-history-delete]');
    if (deleteButton) {
      triggerHaptic('medium');
      deleteHistoryDate(deleteButton.dataset.historyDelete);
    }
  });

  els.markAllPresentBtn.addEventListener('click', markAllPresent);
  els.clearHistoryBtn.addEventListener('click', clearHistory);
  els.addStudentBtn.addEventListener('click', addStudent);

  els.newStudentName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addStudent();
    }
  });

  els.saveReasonBtn.addEventListener('click', saveReasonFromModal);
  els.markPresentFromModalBtn.addEventListener('click', markPresentFromModal);
  
  els.reasonModal.addEventListener('click', (event) => {
    if (event.target === els.reasonModal) closeReasonModal();
  });
  els.historyModal.addEventListener('click', (event) => {
    if (event.target === els.historyModal) closeHistoryModal();
  });
}

(function bootstrap() {
  state.date = todayLocalISO();
  els.lessonDate.value = state.date;
  initTelegram();
  bindUI();
  loadInitial();
})();
