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
  editingStudentId: null
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
  userBadge: document.getElementById('userBadge'),
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
  markPresentFromModalBtn: document.getElementById('markPresentFromModalBtn')
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
  }, 2600);
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
      throw new Error('Сервер вернул некорректный ответ: ' + text);
    }

    if (!data.ok) {
      throw new Error(data.error || 'Не удалось выполнить запрос');
    }

    return data;
  } finally {
    setLoading(false);
  }
}

function normalizeRecords(students, serverRecords) {
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

  return map;
}

function applyPayload(payload) {
  state.user = payload.user || null;
  state.date = payload.date;
  state.students = payload.students || [];
  state.records = normalizeRecords(state.students, payload.records || []);
  state.history = payload.history || [];
  state.dirty = false;
  els.lessonDate.value = state.date;
  renderAll();
  if (payload.toast) {
    showToast(payload.toast);
  }
}

function renderAll() {
  renderStats();
  renderTabs();
  renderAttendance();
  renderStudentsAdmin();
  renderHistory();
}

function renderStats() {
  const values = Array.from(state.records.values());
  const absent = values.filter((item) => item.status === 'absent').length;
  const total = state.students.length;
  const present = total - absent;

  els.statTotal.textContent = String(total);
  els.statPresent.textContent = String(Math.max(0, present));
  els.statAbsent.textContent = String(absent);
}

function getOrderedStudents() {
  const searchValue = state.search.trim().toLowerCase();
  const students = state.students.slice().sort((a, b) => {
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
    els.studentsList.innerHTML = `<div class="empty-state">${state.students.length ? 'По вашему фильтру никто не найден.' : 'Список учеников пуст.'}</div>`;
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

    return `
      <article class="attendance-row ${isAbsent ? 'absent' : ''}" data-student-id="${student.studentId}">
        <div class="student-main">
          <div class="student-topline">
            <div class="avatar">${escapeHtml(initials)}</div>
            <div class="name-stack">
              <div class="student-name">${escapeHtml(student.fullName)}</div>
              <div class="student-subtitle">${escapeHtml(subtitle)}</div>
            </div>
          </div>
          ${isAbsent ? `
            <div class="reason-line">
              <span class="reason-badge">${escapeHtml(record.reason || 'Причина не указана')}</span>
              ${record.comment ? `<span class="comment-text">${escapeHtml(record.comment)}</span>` : ''}
            </div>
          ` : ''}
        </div>
        <div class="row-actions">
          <div class="status-group">
            <button class="status-btn ${!isAbsent ? 'active-present' : ''}" data-student-id="${student.studentId}" data-status="present">Был(а)</button>
            <button class="status-btn ${isAbsent ? 'active-absent' : ''}" data-student-id="${student.studentId}" data-status="absent">Не был(а)</button>
          </div>
          ${isAbsent ? `<button class="reason-btn" data-edit-reason="${student.studentId}">Изменить причину</button>` : ''}
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
        <span>Внутренний ID: ${escapeHtml(student.studentId)}</span>
      </div>
      <button class="danger-btn" data-delete-student="${student.studentId}">Удалить</button>
    </div>
  `).join('');
}

function renderHistory() {
  if (!state.history.length) {
    els.historyList.innerHTML = '<div class="empty-state">За текущий месяц ещё нет сохранённых дат.</div>';
    return;
  }

  els.historyList.innerHTML = state.history.map((row) => `
    <div class="history-row">
      <div>
        <strong>${formatDateRu(row.date)}</strong>
        <span>Всего отмечено: ${row.total}</span>
      </div>
      <div class="history-metrics">
        <span class="metric-pill">Были: ${row.present}</span>
        <span class="metric-pill danger">Не были: ${row.absent}</span>
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
  if (!state.editingStudentId) return;
  setStudentStatus(state.editingStudentId, 'present', { openModal: false });
  closeReasonModal();
}

function loadDayFromServer(payload) {
  state.date = payload.date;
  state.records = normalizeRecords(state.students, payload.records || []);
  state.history = payload.history || [];
  state.dirty = false;
  els.lessonDate.value = state.date;
  renderAll();
}

async function refreshCurrentState(loadingText = 'Обновляем журнал…') {
  const payload = await api('init', { date: state.date }, loadingText);
  applyPayload(payload);
  return payload;
}

async function loadInitial() {
  try {
    await refreshCurrentState('Загружаем журнал…');
  } catch (error) {
    showToast(error.message || 'Не удалось загрузить журнал');
  }
}

async function saveJournal() {
  try {
    const payload = await api(
      'saveAttendance',
      { date: state.date, records: collectRecordsForSave() },
      'Сохраняем журнал…'
    );
    applyPayload(payload);
    await refreshCurrentState('Обновляем историю…');
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } catch (error) {
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    showToast(error.message || 'Не удалось сохранить журнал');
  }
}

async function addStudent() {
  const name = els.newStudentName.value.trim();
  if (!name) {
    showToast('Введите имя нового ученика');
    return;
  }

  try {
    const payload = await api('addStudent', { name, date: state.date }, 'Добавляем ученика…');
    els.newStudentName.value = '';
    applyPayload(payload);
    await refreshCurrentState('Обновляем список учеников…');
    state.activeTab = 'students';
    renderTabs();
  } catch (error) {
    showToast(error.message || 'Не удалось добавить ученика');
  }
}

async function deleteStudent(studentId) {
  const student = state.students.find((item) => item.studentId === studentId);
  if (!student) return;
  const ok = window.confirm(`Удалить ученика «${student.fullName}»? Он удалится и из таблицы.`);
  if (!ok) return;

  try {
    const payload = await api('deleteStudent', { studentId, date: state.date }, 'Удаляем ученика…');
    applyPayload(payload);
    await refreshCurrentState('Обновляем список учеников…');
  } catch (error) {
    showToast(error.message || 'Не удалось удалить ученика');
  }
}

function markAllPresent() {
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
      loadDayFromServer(payload);
    } catch (error) {
      showToast(error.message || 'Не удалось загрузить дату');
    }
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

  els.markAllPresentBtn.addEventListener('click', markAllPresent);
  els.saveBtn.addEventListener('click', saveJournal);
  els.addStudentBtn.addEventListener('click', addStudent);
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
    if (event.target === els.reasonModal) {
      closeReasonModal();
    }
  });
}

(function bootstrap() {
  state.date = todayLocalISO();
  els.lessonDate.value = state.date;
  initTelegram();
  bindUI();
  loadInitial();
})();
