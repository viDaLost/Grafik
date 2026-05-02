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
  saveBtn: document.getElementById('saveBtn'),
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
  closeModalBtn: document.getElementById('closeModalBtn'),
  saveReasonBtn: document.getElementById('saveReasonBtn'),
  markPresentFromModalBtn: document.getElementById('markPresentFromModalBtn'),
  historyModal: document.getElementById('historyModal'),
  historyModalTitle: document.getElementById('historyModalTitle'),
  historyModalBody: document.getElementById('historyModalBody'),
  closeHistoryModalBtn: document.getElementById('closeHistoryModalBtn')
};

function initTelegram() {
  if (!tg) {
    showToast('Откройте приложение внутри Telegram Mini App');
    return;
  }

  tg.ready();
  tg.expand();
  tg.setHeaderColor('#eaf2ff');
  tg.setBackgroundColor('#eff3ff');

  const displayName = [
    tg.initDataUnsafe?.user?.first_name,
    tg.initDataUnsafe?.user?.last_name
  ].filter(Boolean).join(' ') || tg.initDataUnsafe?.user?.username || 'Пользователь';

  els.userBadge.textContent = 'Вход: ' + displayName;
}

function setLoading(isLoading, text = 'Загрузка…') {
  els.loadingText.textContent = text;
  els.loadingOverlay.classList.toggle('hidden', !isLoading);
}

function normalizeUiErrorMessage(message) {
  const text = String(message || '').trim();
  if (!text) return 'Произошла ошибка';
  if (text === 'Failed to fetch' || text === 'Load failed') return 'Ошибка сети или ответа сервера';
  return text;
}

function showToast(message) {
  if (!message) return;
  els.toast.textContent = normalizeUiErrorMessage(message);
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2800);
}

function todayLocalISO() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

async function api(action, extra = {}, loadingText = 'Загрузка…') {
  if (!state.apiUrl || state.apiUrl.includes('PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE')) {
    throw new Error('Укажите URL задеплоенного Apps Script в frontend/config.js');
  }
  if (!tg || !tg.initData) {
    throw new Error('Это приложение нужно открывать из Telegram');
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
      throw new Error('Сервер вернул некорректный ответ');
    }

    if (!data.ok) {
      throw new Error(data.error || 'Не удалось выполнить запрос');
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
}

function getCurrentUserDisplayName() {
  if (!state.user) return 'Пользователь';
  return [state.user.first_name, state.user.last_name].filter(Boolean).join(' ')
    || state.user.username
    || 'Пользователь';
}

function setElementHidden(element, isHidden) {
  if (!element) return;
  element.hidden = isHidden;
}

function renderAccessMode() {
  const isAdmin = state.canEdit;
  document.body.classList.toggle('read-only-mode', !isAdmin);

  if (els.userBadge) {
    const idText = state.user?.id ? ' · ID ' + state.user.id : '';
    els.userBadge.textContent = (isAdmin ? 'Админ: ' : 'Просмотр: ') + getCurrentUserDisplayName() + idText;
  }
  if (els.accessNote) {
    els.accessNote.textContent = isAdmin
      ? 'Режим администратора: отметки, ученики и история доступны для изменения.'
      : 'Режим просмотра: ты видишь журнал и историю занятий, изменения доступны только админам.';
  }
  if (els.attendanceHelp) {
    els.attendanceHelp.textContent = isAdmin
      ? 'Отмечайте посещение за выбранную дату. После проверки сохраните журнал.'
      : 'Здесь видно, кто был на занятии за выбранную дату и кто отсутствовал.';
  }
  if (els.studentsHelp) {
    els.studentsHelp.textContent = isAdmin
      ? 'Добавляйте новых участников и удаляйте лишних. Счётчики показывают посещения и пропуски.'
      : 'Здесь открыт список учеников и их счётчики посещений и пропусков.';
  }
  if (els.historyHelp) {
    els.historyHelp.textContent = isAdmin
      ? 'Здесь показываются все сохранённые даты. Точный список, удаление даты и очистка истории доступны админам.'
      : 'Здесь показываются все сохранённые даты. Открой точный список, чтобы посмотреть посещение поимённо.';
  }

  setElementHidden(els.markAllPresentBtn, !isAdmin);
  setElementHidden(els.saveBtn, !isAdmin);
  setElementHidden(els.addStudentBtn, !isAdmin);
  setElementHidden(els.newStudentName, !isAdmin);
  setElementHidden(els.clearHistoryBtn, !isAdmin);
}

function ensureCanEdit() {
  if (state.canEdit) return true;
  showToast('У тебя режим просмотра. Изменения доступны только админам.');
  return false;
}

function renderLessonNote() {
  if (!els.lessonNoteInput || !els.lessonNoteView) return;

  const noteText = String(state.lessonNote || '').trim();
  els.lessonNoteInput.value = noteText;

  setElementHidden(els.lessonNoteInput, !state.canEdit);
  setElementHidden(els.lessonNoteView, state.canEdit);

  if (!state.canEdit) {
    els.lessonNoteView.textContent = noteText
      ? noteText
      : (state.dateHasRecords ? 'Комментарий к занятию не указан.' : 'За эту дату журнал ещё не сохранён.');
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
    els.studentsList.innerHTML = `<div class="empty-state">${message}</div>`;
    return;
  }

  els.studentsList.innerHTML = students.map((student) => {
    const record = state.records.get(student.studentId) || {
      status: 'present',
      reason: '',
      comment: ''
    };

    const isAbsent = record.status === 'absent';
    const subtitle = isAbsent ? 'Отмечен как отсутствующий' : 'Отмечен как присутствующий';
    const initials = student.fullName.trim().charAt(0).toUpperCase();
    const counters = `Был(а): ${student.presentCount || 0} · Не был(а): ${student.absentCount || 0}`;
    const actions = state.canEdit ? `
          <div class="status-group">
            <button class="status-btn ${!isAbsent ? 'active-present' : ''}" data-student-id="${student.studentId}" data-status="present">Был(а)</button>
            <button class="status-btn ${isAbsent ? 'active-absent' : ''}" data-student-id="${student.studentId}" data-status="absent">Не был(а)</button>
          </div>
          ${isAbsent ? `<button class="reason-btn" data-edit-reason="${student.studentId}">Изменить причину</button>` : ''}
        ` : `
          <div class="view-status-pill ${isAbsent ? 'absent' : 'present'}">${isAbsent ? 'Не был(а)' : 'Был(а)'}</div>
        `;

    return `
      <article class="attendance-row ${isAbsent ? 'absent' : ''}" data-student-id="${student.studentId}">
        <div class="student-main">
          <div class="student-topline">
            <div class="avatar">${escapeHtml(initials)}</div>
            <div class="name-stack">
              <div class="student-name">${escapeHtml(student.fullName)}</div>
              <div class="student-subtitle">${escapeHtml(subtitle)}</div>
              <div class="student-counter-line">${escapeHtml(counters)}</div>
            </div>
          </div>
          ${isAbsent ? `
            <div class="reason-line">
              <span class="reason-badge">${escapeHtml(record.reason || 'Причина не указана')}</span>
              ${record.comment ? `<span class="comment-text">${escapeHtml(record.comment)}</span>` : ''}
            </div>
          ` : ''}
        </div>
        <div class="row-actions ${state.canEdit ? '' : 'view-only'}">
          ${actions}
        </div>
      </article>
    `;
  }).join('');
}

function renderStudentsAdmin() {
  if (!state.students.length) {
    els.studentsAdminList.innerHTML = '<div class="empty-state">Пока нет учеников.</div>';
    return;
  }

  els.studentsAdminList.innerHTML = state.students.map((student, index) => `
    <div class="admin-row">
      <div>
        <strong>${index + 1}. ${escapeHtml(student.fullName)}</strong>
        <div class="admin-counters">
          <span class="metric-pill">Был(а): ${student.presentCount || 0}</span>
          <span class="metric-pill danger">Не был(а): ${student.absentCount || 0}</span>
        </div>
      </div>
      ${state.canEdit ? `<button class="danger-btn" data-delete-student="${student.studentId}">Удалить</button>` : ''}
    </div>
  `).join('');
}

function renderHistory() {
  if (!state.history.length) {
    els.historyList.innerHTML = '<div class="empty-state">История пока пуста. Сохраните хотя бы одну дату.</div>';
    return;
  }

  els.historyList.innerHTML = state.history.map((row) => `
    <div class="history-row">
      <div>
        <strong>${formatDateRu(row.date)}</strong>
        <span>Всего отмечено: ${row.total}</span>
        <div class="history-metrics compact-left">
          <span class="metric-pill">Были: ${row.present}</span>
          <span class="metric-pill danger">Не были: ${row.absent}</span>
        </div>
        ${row.lessonNote ? `<div class="history-note-line">${escapeHtml(row.lessonNote)}</div>` : ''}
      </div>
      <div class="history-actions-col">
        <button class="outline-btn" data-history-details="${row.date}">Точный список</button>
        ${state.canEdit ? `<button class="danger-btn" data-history-delete="${row.date}">Удалить дату</button>` : ''}
      </div>
    </div>
  `).join('');
}

function renderTabs() {
  document.querySelectorAll('.segmented-btn').forEach((button) => {
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
  } else if (!record.reason) {
    record.reason = REASONS[0];
  }

  state.records.set(studentId, record);
  state.dirty = true;
  renderStats();
  renderAttendance();

  if (status === 'absent' && options.openModal !== false) {
    openReasonModal(studentId);
  }
}

function openReasonModal(studentId) {
  if (!ensureCanEdit()) return;
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
}

function closeReasonModal() {
  state.editingStudentId = null;
  els.reasonModal.classList.add('hidden');
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

  const presentItems = (entry.presentList || []).map((item) => `<li>${escapeHtml(item.studentName)}</li>`).join('') || '<li>Никого нет</li>';
  const absentItems = (entry.absentList || []).map((item) => `
    <li>
      <strong>${escapeHtml(item.studentName)}</strong>
      ${item.reason ? `<span>Причина: ${escapeHtml(item.reason)}</span>` : ''}
      ${item.comment ? `<span>Комментарий: ${escapeHtml(item.comment)}</span>` : ''}
    </li>
  `).join('') || '<li>Никого нет</li>';

  els.historyModalBody.innerHTML = `
    <div class="history-modal-summary">
      <span class="metric-pill">Были: ${entry.present}</span>
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
}

function closeHistoryModal() {
  state.openedHistoryDate = null;
  els.historyModal.classList.add('hidden');
}

async function loadInitial() {
  try {
    const payload = await api('init', { date: state.date }, 'Загружаем журнал…');
    applyPayload(payload);
  } catch (error) {
    showToast(error.message || 'Не удалось загрузить журнал');
  }
}

async function saveJournal() {
  if (!ensureCanEdit()) return;
  try {
    const payload = await api(
      'saveAttendance',
      { date: state.date, records: collectRecordsForSave(), lessonNote: state.lessonNote.trim() },
      'Сохраняем журнал…'
    );
    applyPayload(payload);
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } catch (error) {
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    showToast(error.message || 'Не удалось сохранить журнал');
  }
}

async function addStudent() {
  if (!ensureCanEdit()) return;
  const name = els.newStudentName.value.trim();
  if (!name) {
    showToast('Введите имя нового ученика');
    return;
  }

  try {
    const payload = await api('addStudent', { name, date: state.date }, 'Добавляем ученика…');
    els.newStudentName.value = '';
    applyPayload(payload);
    state.activeTab = 'students';
    renderTabs();
  } catch (error) {
    showToast(error.message || 'Не удалось добавить ученика');
  }
}

async function deleteStudent(studentId) {
  if (!ensureCanEdit()) return;
  const student = state.students.find((item) => item.studentId === studentId);
  if (!student) return;
  const ok = window.confirm(`Удалить ученика «${student.fullName}»? Он удалится и из таблицы.`);
  if (!ok) return;

  try {
    const payload = await api('deleteStudent', { studentId, date: state.date }, 'Удаляем ученика…');
    applyPayload(payload);
  } catch (error) {
    showToast(error.message || 'Не удалось удалить ученика');
  }
}

async function deleteHistoryDate(date) {
  if (!ensureCanEdit()) return;
  const ok = window.confirm(`Удалить сохранение за ${formatDateRu(date)}?`);
  if (!ok) return;

  try {
    const payload = await api('deleteHistoryDate', { date: state.date, dateToDelete: date }, 'Удаляем дату…');
    closeHistoryModal();
    applyPayload(payload);
  } catch (error) {
    showToast(error.message || 'Не удалось удалить дату');
  }
}

async function clearHistory() {
  if (!ensureCanEdit()) return;
  if (!state.history.length) {
    showToast('История уже пустая');
    return;
  }

  const first = window.confirm('Удалить всю историю журналов за все даты?');
  if (!first) return;
  const second = window.confirm('Подтвердите ещё раз: история будет удалена без возможности восстановления.');
  if (!second) return;

  try {
    const payload = await api('clearHistory', { date: state.date }, 'Очищаем историю…');
    closeHistoryModal();
    applyPayload(payload);
  } catch (error) {
    showToast(error.message || 'Не удалось очистить историю');
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
  showToast('Все отмечены как присутствующие');
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
      const payload = await api('getDay', { date: state.date }, 'Загружаем выбранную дату…');
      applyPayload(payload);
    } catch (error) {
      showToast(error.message || 'Не удалось загрузить дату');
    }
  });

  if (els.lessonNoteInput) {
    els.lessonNoteInput.addEventListener('input', () => {
      if (!state.canEdit) return;
      state.lessonNote = els.lessonNoteInput.value || '';
      state.dirty = true;
    });
  }

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
  });

  document.querySelectorAll('.segmented-btn').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTab = button.dataset.tab;
      renderTabs();
    });
  });

  els.studentsList.addEventListener('click', (event) => {
    const statusButton = event.target.closest('[data-status]');
    if (statusButton) {
      setStudentStatus(statusButton.dataset.studentId, statusButton.dataset.status, { openModal: statusButton.dataset.status === 'absent' });
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
  els.addStudentBtn.addEventListener('click', addStudent);
  els.clearHistoryBtn.addEventListener('click', clearHistory);

  els.newStudentName.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addStudent();
    }
  });

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
}

(function bootstrap() {
  state.date = todayLocalISO();
  els.lessonDate.value = state.date;
  initTelegram();
  bindUI();
  loadInitial();
})();
