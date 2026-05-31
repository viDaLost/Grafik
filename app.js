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
  lessonNoteInput: document.getElementById('lessonNoteInput'),
  lessonNoteView: document.getElementById('lessonNoteView'),
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
  closeHistoryModalBtn: document.getElementById('closeHistoryModalBtn'),
  bottomBar: document.getElementById('bottomBar')
};

function initTelegram() {
  if (!tg) return;
  tg.ready();
  tg.expand();
  
  // Цвета подстраиваются под нативную палитру клиента Telegram
  tg.setHeaderColor(tg.themeParams.secondary_bg_color || '#ffffff');
  tg.setBackgroundColor(tg.themeParams.bg_color || '#f4f5f7');

  const displayName = [
    tg.initDataUnsafe?.user?.first_name,
    tg.initDataUnsafe?.user?.last_name
  ].filter(Boolean).join(' ') || tg.initDataUnsafe?.user?.username || 'Пользователь';

  els.userBadge.textContent = displayName;
  
  // Инициализация нативной кнопки сохранения в Telegram
  if (tg.MainButton) {
    tg.MainButton.setText('Сохранить журнал');
    tg.MainButton.onClick(saveJournal);
  }
}

function updateTelegramMainButton() {
  if (!tg || !tg.MainButton) return;
  
  if (state.dirty && state.canEdit && state.activeTab === 'attendance') {
    tg.MainButton.show();
  } else {
    tg.MainButton.hide();
  }
}

function setDirty(isDirty) {
  state.dirty = isDirty;
  updateTelegramMainButton();
}

function setLoading(isLoading, text = 'Загрузка…') {
  els.loadingText.textContent = text;
  els.loadingOverlay.classList.toggle('hidden', !isLoading);
}

function showToast(message) {
  if (!message) return;
  els.toast.textContent = String(message).trim();
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    els.toast.classList.remove('show');
  }, 2500);
}

function todayLocalISO() {
  const now = new Date();
  const tzOffset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - tzOffset).toISOString().slice(0, 10);
}

async function api(action, extra = {}, loadingText = 'Загрузка…') {
  if (!state.apiUrl || state.apiUrl.includes('PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE')) {
    throw new Error('Укажите URL Apps Script в frontend/config.js');
  }
  setLoading(true, loadingText);
  const payload = { action, initData: tg ? tg.initData : '', ...extra };

  try {
    const response = await fetch(state.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ payload: JSON.stringify(payload) }).toString()
    });
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch (e) { throw new Error('Некорректный ответ сервера'); }
    if (!data.ok) throw new Error(data.error || 'Ошибка выполнения');
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

function applyPayload(payload) {
  state.user = payload.user || null;
  state.date = payload.date;
  state.students = payload.students || [];
  state.history = payload.history || [];
  state.canEdit = Boolean(payload.canEdit || payload.user?.isAdmin);
  state.dateHasRecords = Boolean(payload.dateHasRecords || (payload.records || []).length);
  state.lessonNote = String(payload.lessonNote || '');
  state.records = normalizeRecords(state.students, payload.records || [], state.canEdit);
  
  els.lessonDate.value = state.date;
  setDirty(false);
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
}

function renderAccessMode() {
  const isAdmin = state.canEdit;
  document.body.classList.toggle('read-only-mode', !isAdmin);

  if (els.accessNote) {
    els.accessNote.textContent = isAdmin
      ? 'Режим администратора (изменения разрешены).'
      : 'Режим просмотра (доступ только для чтения).';
  }

  // Скрытие нижнего интерфейса кнопок, если у пользователя нет прав админа
  const shouldShowBar = isAdmin && state.activeTab === 'attendance';
  els.bottomBar.style.display = shouldShowBar ? 'flex' : 'none';
  setElementHidden(els.clearHistoryBtn, !isAdmin);
  updateTelegramMainButton();
}

function renderLessonNote() {
  const noteText = String(state.lessonNote || '').trim();
  els.lessonNoteInput.value = noteText;
  setElementHidden(els.lessonNoteInput, !state.canEdit);
  setElementHidden(els.lessonNoteView, state.canEdit);
  if (!state.canEdit) {
    els.lessonNoteView.textContent = noteText || 'Заметка к занятию отсутствует.';
  }
}

function renderStats() {
  const values = Array.from(state.records.values());
  const absent = values.filter(item => item.status === 'absent').length;
  const total = state.students.length;
  const present = total - absent;

  els.statTotal.textContent = String(total);
  els.statPresent.textContent = String(Math.max(0, present));
  els.statAbsent.textContent = String(absent);
}

// ИСПРАВЛЕНО: Убрана деструктурирующая динамическая сортировка по отсутствию на лету, вызывавшая баги со сдвигом интерфейса
function getOrderedStudents() {
  const searchValue = state.search.trim().toLowerCase();
  const sourceStudents = state.canEdit
    ? state.students.slice()
    : state.students.filter(student => state.records.has(student.studentId));
    
  // Сортировка исключительно по исходному порядку в базе (алфавитному или ID), без прыжков строк вверх-вниз
  const students = sourceStudents.sort((a, b) => (a.sortOrder || 0) - (b.sortOrder || 0));

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
      : 'Список пуст.';
    els.studentsList.innerHTML = `<div class="empty-state" style="padding:20px;text-align:center;color:var(--hint);">${message}</div>`;
    return;
  }

  els.studentsList.innerHTML = students.map((student) => {
    const record = state.records.get(student.studentId) || { status: 'present', reason: '', comment: '' };
    const isAbsent = record.status === 'absent';
    const initials = student.fullName.trim().charAt(0).toUpperCase();
    const counters = `Посетил(а): ${student.presentCount || 0} · Пропуски: ${student.absentCount || 0}`;
    
    const actions = state.canEdit ? `
      <div class="status-group">
        <button class="status-btn ${!isAbsent ? 'active-present' : ''}" data-student-id="${student.studentId}" data-status="present">Был</button>
        <button class="status-btn ${isAbsent ? 'active-absent' : ''}" data-student-id="${student.studentId}" data-status="absent">Нет</button>
      </div>
      ${isAbsent ? `<button class="reason-btn" data-edit-reason="${student.studentId}">📝</button>` : ''}
    ` : `
      <div class="view-status-pill ${isAbsent ? 'absent' : 'present'}">${isAbsent ? 'Отсутствовал' : 'Был'}</div>
    `;

    return `
      <article class="attendance-row ${isAbsent ? 'absent' : ''}" data-student-id="${student.studentId}">
        <div class="student-main">
          <div class="avatar">${escapeHtml(initials)}</div>
          <div class="name-stack">
            <div class="student-name">${escapeHtml(student.fullName)}</div>
            <div class="student-counter-line">${escapeHtml(counters)}</div>
            ${isAbsent ? `
              <div class="reason-line">
                <span class="reason-badge">${escapeHtml(record.reason || 'Причина не указана')}</span>
                ${record.comment ? `<span class="comment-text">${escapeHtml(record.comment)}</span>` : ''}
              </div>
            ` : ''}
          </div>
        </div>
        <div class="row-actions">${actions}</div>
      </article>
    `;
  }).join('');
}

function renderStudentsAdmin() {
  if (!state.students.length) {
    els.studentsAdminList.innerHTML = '<div class="empty-state">Список пуст.</div>';
    return;
  }

  els.studentsAdminList.innerHTML = state.students.map((student, index) => `
    <div class="admin-row">
      <div>
        <strong>${index + 1}. ${escapeHtml(student.fullName)}</strong>
        <div class="admin-counters">
          <span class="metric-pill">Было: ${student.presentCount || 0}</span>
          <span class="metric-pill danger">Пропущено: ${student.absentCount || 0}</span>
        </div>
      </div>
      ${state.canEdit ? `<button class="danger-btn" style="padding:6px 12px; font-size:12px;" data-delete-student="${student.studentId}">Удалить</button>` : ''}
    </div>
  `).join('');
}

function renderHistory() {
  if (!state.history.length) {
    els.historyList.innerHTML = '<div class="empty-state">История сохранений пуста.</div>';
    return;
  }

  els.historyList.innerHTML = state.history.map((row) => `
    <div class="history-row">
      <div>
        <strong>${formatDateRu(row.date)}</strong>
        <div class="history-metrics">
          <span class="metric-pill">Присутствие: ${row.present}</span>
          <span class="metric-pill danger">Пропуски: ${row.absent}</span>
        </div>
        ${row.lessonNote ? `<div style="font-size:12px; color:var(--hint); margin-top:4px;">${escapeHtml(row.lessonNote)}</div>` : ''}
      </div>
      <div class="history-actions-col">
        <button class="outline-btn" data-history-details="${row.date}">Инфо</button>
        ${state.canEdit ? `<button class="danger-btn" data-history-delete="${row.date}">✕</button>` : ''}
      </div>
    </div>
  `).join('');
}

function renderTabs() {
  document.querySelectorAll('.segmented-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === state.activeTab);
  });
  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${state.activeTab}`);
  });
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    chip.classList.toggle('active', chip.dataset.filter === state.filter);
  });
  
  // Автоскрытие и показ нижнего тулбара в зависимости от вкладки
  const shouldShowBar = state.canEdit && state.activeTab === 'attendance';
  els.bottomBar.style.display = shouldShowBar ? 'flex' : 'none';
  updateTelegramMainButton();
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
  if (!state.canEdit) return;
  const record = state.records.get(studentId);
  if (!record) return;

  record.status = status;
  if (status === 'present') {
    record.reason = '';
    record.comment = '';
  } else if (!record.reason) {
    record.reason = REASONS[0];
  }

  state.records.set(studentId, record);
  setDirty(true);
  renderStats();
  renderAttendance();

  if (status === 'absent' && options.openModal !== false) {
    openReasonModal(studentId);
  }
}

function openReasonModal(studentId) {
  const student = state.students.find(item => item.studentId === studentId);
  const record = state.records.get(studentId);
  if (!student || !record) return;

  state.editingStudentId = studentId;
  els.modalStudentName.textContent = student.fullName;
  els.reasonSelect.innerHTML = REASONS.map(reason => `
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
  if (record) {
    record.status = 'absent';
    record.reason = els.reasonSelect.value;
    record.comment = els.reasonComment.value.trim();
    state.records.set(state.editingStudentId, record);
    setDirty(true);
    renderStats();
    renderAttendance();
  }
  closeReasonModal();
}

function markPresentFromModal() {
  if (state.editingStudentId) {
    setStudentStatus(state.editingStudentId, 'present', { openModal: false });
  }
  closeReasonModal();
}

function openHistoryModal(date) {
  const entry = state.history.find(item => item.date === date);
  if (!entry) return;

  state.openedHistoryDate = date;
  els.historyModalTitle.textContent = formatDateRu(entry.date);

  const presentItems = (entry.presentList || []).map(item => `<li>${escapeHtml(item.studentName)}</li>`).join('') || '<li>—</li>';
  const absentItems = (entry.absentList || []).map(item => `
    <li style="margin-bottom:6px;">
      <strong>${escapeHtml(item.studentName)}</strong>
      <div style="font-size:12px; color:var(--danger);">${escapeHtml(item.reason || 'Без причины')}</div>
      ${item.comment ? `<div style="font-size:11px; color:var(--hint);">${escapeHtml(item.comment)}</div>` : ''}
    </li>
  `).join('') || '<li>—</li>';

  els.historyModalBody.innerHTML = `
    <p style="margin:0 0 10px 0; font-size:13px; color:var(--hint);">Заметка: ${escapeHtml(entry.lessonNote || 'нет')}</p>
    <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
      <div><h4 style="margin:0 0 6px 0; font-size:14px; color:var(--success);">Были</h4><ul style="padding-left:14px; margin:0; font-size:13px;">${presentItems}</ul></div>
      <div><h4 style="margin:0 0 6px 0; font-size:14px; color:var(--danger);">Не были</h4><ul style="padding-left:14px; margin:0; font-size:13px;">${absentItems}</ul></div>
    </div>
  `;
  els.historyModal.classList.remove('hidden');
}

function closeHistoryModal() {
  els.historyModal.classList.add('hidden');
}

async function loadInitial() {
  try {
    const payload = await api('init', { date: state.date }, 'Загрузка данных…');
    applyPayload(payload);
  } catch (error) {
    showToast(error.message);
  }
}

async function saveJournal() {
  if (!state.canEdit) return;
  try {
    const payload = await api('saveAttendance', {
      date: state.date,
      records: collectRecordsForSave(),
      lessonNote: state.lessonNote.trim()
    }, 'Сохранение изменений…');
    applyPayload(payload);
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  } catch (error) {
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
    showToast(error.message);
  }
}

async function addStudent() {
  const name = els.newStudentName.value.trim();
  if (!name) return showToast('Введите имя ученика');
  try {
    const payload = await api('addStudent', { name, date: state.date }, 'Добавление ученика…');
    els.newStudentName.value = '';
    applyPayload(payload);
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteStudent(studentId) {
  const student = state.students.find(i => i.studentId === studentId);
  if (!student || !window.confirm(`Удалить ученика ${student.fullName}?`)) return;
  try {
    const payload = await api('deleteStudent', { studentId, date: state.date }, 'Удаление…');
    applyPayload(payload);
  } catch (error) {
    showToast(error.message);
  }
}

async function deleteHistoryDate(date) {
  if (!window.confirm(`Удалить журнал за ${formatDateRu(date)}?`)) return;
  try {
    const payload = await api('deleteHistoryDate', { date: state.date, dateToDelete: date }, 'Удаление записи…');
    closeHistoryModal();
    applyPayload(payload);
  } catch (error) {
    showToast(error.message);
  }
}

async function clearHistory() {
  if (!state.history.length) return showToast('История пуста');
  if (!window.confirm('Удалить всю историю журналов без возможности восстановления?')) return;
  try {
    const payload = await api('clearHistory', { date: state.date }, 'Очистка истории…');
    applyPayload(payload);
  } catch (error) {
    showToast(error.message);
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
  setDirty(true);
  renderStats();
  renderAttendance();
  showToast('Все отмечены как присутствующие');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

function formatDateRu(isoDate) {
  const date = new Date(`${isoDate}T00:00:00`);
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
}

function setElementHidden(el, isHidden) {
  if (el) el.hidden = isHidden;
}

function bindUI() {
  els.lessonDate.addEventListener('change', async () => {
    state.date = els.lessonDate.value;
    try {
      const payload = await api('getDay', { date: state.date }, 'Загрузка даты…');
      applyPayload(payload);
    } catch (error) { showToast(error.message); }
  });

  els.lessonNoteInput.addEventListener('input', () => {
    state.lessonNote = els.lessonNoteInput.value || '';
    setDirty(true);
  });

  els.searchInput.addEventListener('input', () => {
    state.search = els.searchInput.value || '';
    renderAttendance();
  });

  els.filterRow.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-filter]');
    if (!btn) return;
    state.filter = btn.dataset.filter;
    renderTabs();
    renderAttendance();
  });

  document.querySelectorAll('.segmented-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.activeTab = btn.dataset.tab;
      renderTabs();
    });
  });

  els.studentsList.addEventListener('click', (e) => {
    const statusBtn = e.target.closest('[data-status]');
    if (statusBtn) {
      setStudentStatus(statusBtn.dataset.studentId, statusBtn.dataset.status, { openModal: statusBtn.dataset.status === 'absent' });
      return;
    }
    const reasonBtn = e.target.closest('[data-edit-reason]');
    if (reasonBtn) openReasonModal(reasonBtn.dataset.editReason);
  });

  els.studentsAdminList.addEventListener('click', (e) => {
    const delBtn = e.target.closest('[data-delete-student]');
    if (delBtn) deleteStudent(delBtn.dataset.deleteStudent);
  });

  els.historyList.addEventListener('click', (e) => {
    const detBtn = e.target.closest('[data-history-details]');
    if (detBtn) { openHistoryModal(detBtn.dataset.historyDetails); return; }
    const delBtn = e.target.closest('[data-history-delete]');
    if (delBtn) deleteHistoryDate(delBtn.dataset.history-delete);
  });

  els.markAllPresentBtn.addEventListener('click', markAllPresent);
  els.saveBtn.addEventListener('click', saveJournal);
  els.addStudentBtn.addEventListener('click', addStudent);
  els.clearHistoryBtn.addEventListener('click', clearHistory);

  els.closeModalBtn.addEventListener('click', closeReasonModal);
  els.saveReasonBtn.addEventListener('click', saveReasonFromModal);
  els.markPresentFromModalBtn.addEventListener('click', markPresentFromModal);
  els.closeHistoryModalBtn.addEventListener('click', closeHistoryModal);
}

(function bootstrap() {
  state.date = todayLocalISO();
  els.lessonDate.value = state.date;
  initTelegram();
  bindUI();
  loadInitial();
})();
