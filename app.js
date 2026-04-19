const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
const state = {
  apiUrl: (window.APP_CONFIG && window.APP_CONFIG.API_URL) || '',
  user: null,
  date: '',
  students: [],
  records: new Map(),
  history: []
};

const REASONS = [
  'Болел(а)',
  'Семейные обстоятельства',
  'Уехал(а)',
  'Школа / экзамен',
  'Предупредил(а) заранее',
  'Без причины',
  'Другое'
];

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
  toast: document.getElementById('toast')
};

function initTelegram() {
  if (!tg) {
    showToast('Откройте приложение внутри Telegram Mini App');
    return;
  }

  tg.ready();
  tg.expand();
  tg.setHeaderColor('#10131c');
  tg.setBackgroundColor('#10131c');

  const displayName = [tg.initDataUnsafe?.user?.first_name, tg.initDataUnsafe?.user?.last_name].filter(Boolean).join(' ') || tg.initDataUnsafe?.user?.username || 'Пользователь';
  els.userBadge.textContent = 'Вход: ' + displayName;
}

function setLoading(isLoading, text = 'Загрузка…') {
  els.loadingText.textContent = text;
  els.loadingOverlay.classList.toggle('hidden', !isLoading);
}

function showToast(message) {
  if (!message) return;
  els.toast.textContent = message;
  els.toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 2400);
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

  const response = await fetch(state.apiUrl, {
    method: 'POST',
    body: new URLSearchParams({ payload: JSON.stringify(payload) })
  });

  const text = await response.text();
  let data;

  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error('Сервер вернул некорректный ответ: ' + text);
  } finally {
    setLoading(false);
  }

  if (!data.ok) {
    throw new Error(data.error || 'Не удалось выполнить запрос');
  }

  return data;
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
  state.user = payload.user;
  state.date = payload.date;
  state.students = payload.students || [];
  state.records = normalizeRecords(state.students, payload.records || []);
  state.history = payload.history || [];
  els.lessonDate.value = state.date;
  renderStats();
  renderAttendance();
  renderStudentsAdmin();
  renderHistory();
  if (payload.toast) showToast(payload.toast);
}

function renderStats() {
  const values = Array.from(state.records.values());
  const absent = values.filter((record) => record.status === 'absent').length;
  const total = state.students.length;
  const present = total - absent;
  els.statTotal.textContent = String(total);
  els.statPresent.textContent = String(present < 0 ? 0 : present);
  els.statAbsent.textContent = String(absent);
}

function renderAttendance() {
  if (!state.students.length) {
    els.studentsList.innerHTML = '<div class="empty-state">Список учеников пуст.</div>';
    return;
  }

  els.studentsList.innerHTML = state.students.map((student) => {
    const record = state.records.get(student.studentId);
    const isAbsent = record && record.status === 'absent';
    return `
      <article class="glass-card student-card ${isAbsent ? 'absent' : ''}" data-student-id="${student.studentId}">
        <div class="info">
          <h3>${escapeHtml(student.fullName)}</h3>
          <p>${isAbsent ? 'Отмечен как отсутствующий' : 'Отмечен как присутствующий'}</p>
        </div>

        <div class="status-toggle">
          <button class="status-option present ${!isAbsent ? 'active present' : ''}" data-action="present" data-student-id="${student.studentId}">Был(а)</button>
          <button class="status-option absent ${isAbsent ? 'active absent' : ''}" data-action="absent" data-student-id="${student.studentId}">Не был(а)</button>
        </div>

        <div class="absent-fields">
          <select data-role="reason" data-student-id="${student.studentId}">
            ${REASONS.map((reason) => `<option value="${escapeHtml(reason)}" ${record.reason === reason ? 'selected' : ''}>${escapeHtml(reason)}</option>`).join('')}
          </select>
          <textarea data-role="comment" data-student-id="${student.studentId}" placeholder="Комментарий или уточнение">${escapeHtml(record.comment || '')}</textarea>
        </div>
      </article>
    `;
  }).join('');

  bindAttendanceActions();
}

function bindAttendanceActions() {
  document.querySelectorAll('[data-action="present"]').forEach((btn) => {
    btn.onclick = () => setStudentStatus(btn.dataset.studentId, 'present');
  });
  document.querySelectorAll('[data-action="absent"]').forEach((btn) => {
    btn.onclick = () => setStudentStatus(btn.dataset.studentId, 'absent');
  });
  document.querySelectorAll('[data-role="reason"]').forEach((select) => {
    select.onchange = () => updateRecordField(select.dataset.studentId, 'reason', select.value);
  });
  document.querySelectorAll('[data-role="comment"]').forEach((area) => {
    area.oninput = () => updateRecordField(area.dataset.studentId, 'comment', area.value);
  });
}

function setStudentStatus(studentId, status) {
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
  renderStats();
  renderAttendance();
}

function updateRecordField(studentId, field, value) {
  const record = state.records.get(studentId);
  if (!record) return;
  record[field] = value;
  state.records.set(studentId, record);
}

function renderStudentsAdmin() {
  if (!state.students.length) {
    els.studentsAdminList.innerHTML = '<div class="empty-state">Нет учеников.</div>';
    return;
  }

  els.studentsAdminList.innerHTML = state.students.map((student, index) => `
    <div class="admin-row">
      <div>
        <strong>${index + 1}. ${escapeHtml(student.fullName)}</strong>
        <span>ID: ${escapeHtml(student.studentId)}</span>
      </div>
      <button class="danger-btn" data-delete-student="${student.studentId}">Удалить</button>
    </div>
  `).join('');

  document.querySelectorAll('[data-delete-student]').forEach((btn) => {
    btn.onclick = async () => {
      const studentId = btn.dataset.deleteStudent;
      const student = state.students.find((item) => item.studentId === studentId);
      if (!student) return;
      const ok = window.confirm(`Удалить ученика «${student.fullName}»? Он удалится и из Google Таблицы.`);
      if (!ok) return;
      try {
        const payload = await api('deleteStudent', { studentId, date: state.date }, 'Удаляем ученика…');
        applyPayload(payload);
      } catch (error) {
        showToast(error.message);
      }
    };
  });
}

function renderHistory() {
  if (!state.history.length) {
    els.historyList.innerHTML = '<div class="empty-state">В текущем месяце пока нет сохранённых дат.</div>';
    return;
  }

  els.historyList.innerHTML = state.history.map((row) => `
    <div class="history-row">
      <div>
        <strong>${formatDateRu(row.date)}</strong>
        <span>Всего: ${row.total}</span>
      </div>
      <div class="history-pill">Были: ${row.present} · Не были: ${row.absent}</div>
    </div>
  `).join('');
}

function collectRecordsForSave() {
  return state.students.map((student) => {
    const record = state.records.get(student.studentId);
    return {
      studentId: student.studentId,
      studentName: student.fullName,
      status: record && record.status === 'absent' ? 'absent' : 'present',
      reason: record && record.status === 'absent' ? (record.reason || '') : '',
      comment: record && record.status === 'absent' ? (record.comment || '') : ''
    };
  });
}

async function loadInitial() {
  try {
    const payload = await api('init', { date: state.date }, 'Загружаем журнал…');
    applyPayload(payload);
  } catch (error) {
    showToast(error.message);
  }
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
  const date = new Date(isoDate + 'T00:00:00');
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

function bindUI() {
  els.lessonDate.addEventListener('change', async () => {
    state.date = els.lessonDate.value;
    try {
      const payload = await api('getDay', { date: state.date }, 'Загружаем дату…');
      state.date = payload.date;
      state.records = normalizeRecords(state.students, payload.records || []);
      state.history = payload.history || [];
      renderStats();
      renderAttendance();
      renderHistory();
    } catch (error) {
      showToast(error.message);
    }
  });

  els.markAllPresentBtn.addEventListener('click', () => {
    state.students.forEach((student) => {
      state.records.set(student.studentId, {
        studentId: student.studentId,
        studentName: student.fullName,
        status: 'present',
        reason: '',
        comment: ''
      });
    });
    renderStats();
    renderAttendance();
    showToast('Все отмечены как присутствующие');
  });

  els.saveBtn.addEventListener('click', async () => {
    try {
      const payload = await api('saveAttendance', { date: state.date, records: collectRecordsForSave() }, 'Сохраняем журнал…');
      applyPayload(payload);
      if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
    } catch (error) {
      if (tg && tg.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');
      showToast(error.message);
    }
  });

  els.addStudentBtn.addEventListener('click', async () => {
    const name = els.newStudentName.value.trim();
    if (!name) {
      showToast('Введите имя ученика');
      return;
    }
    try {
      const payload = await api('addStudent', { name, date: state.date }, 'Добавляем ученика…');
      els.newStudentName.value = '';
      applyPayload(payload);
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.remove('active'));
      document.querySelectorAll('.tab-panel').forEach((item) => item.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

(function bootstrap() {
  state.date = todayLocalISO();
  initTelegram();
  bindUI();
  els.lessonDate.value = state.date;
  loadInitial();
})();
