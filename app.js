/**
 * Telegram Mini App: Attendance Journal Front-End Logic
 */

// Базовые типы причин отсутствия
const ABSENCE_REASONS = [
  { id: 'sick', label: 'Болезнь', badge: 'danger' },
  { id: 'family', label: 'Семейные обст.', badge: 'warning' },
  { id: 'excused', label: 'Уважительная', badge: 'warning' },
  { id: 'unexcused', label: 'Без причины', badge: 'danger' }
];

// Исходный список учеников по умолчанию (если LocalStorage пуст)
const DEFAULT_STUDENTS = [
  { id: '1', name: 'Александров Александр', present: true, reason: '', comment: '', stats: { present: 14, absent: 2 } },
  { id: '2', name: 'Борисов Борис', present: true, reason: '', comment: '', stats: { present: 15, absent: 1 } },
  { id: '3', name: 'Васильев Василий', present: true, reason: '', comment: '', stats: { present: 16, absent: 0 } },
  { id: '4', name: 'Григорьев Григорий', present: true, reason: '', comment: '', stats: { present: 12, absent: 4 } },
  { id: '5', name: 'Дмитриев Дмитрий', present: true, reason: '', comment: '', stats: { present: 13, absent: 3 } }
];

class AttendanceApp {
  constructor() {
    this.tg = window.Telegram?.WebApp || null;
    this.students = [];
    this.history = [];
    this.currentDate = this.getTodayDateString();
    
    // Временное хранение изменений до сохранения
    this.currentAttendanceState = {}; // { studentId: { present: bool, reason: str, comment: str } }
    this.currentLessonNote = '';
    
    // Состояние фильтрации
    this.searchQuery = '';
    this.activeFilter = 'all'; // 'all', 'present', 'absent'

    // Ролевая модель доступа: 'admin', 'readonly', 'demo'
    this.userRole = 'admin'; 

    this.init();
  }

  init() {
    this.setupTelegram();
    this.loadData();
    this.detectRole();
    this.initDOM();
    this.bindEvents();
    
    // Установка даты на сегодня и загрузка состояния
    document.getElementById('lessonDate').value = this.currentDate;
    this.loadStateForDate(this.currentDate);
    
    this.render();
    this.showToast('Интерфейс инициализирован');
  }

  setupTelegram() {
    if (this.tg) {
      this.tg.ready();
      this.tg.expand();
      
      // Настройка цветов темы Telegram
      const themeColor = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
      this.tg.setHeaderColor(themeColor);
      this.tg.setBackgroundColor(themeColor);
    }
  }

  detectRole() {
    // Определение роли на основе query-параметров или Telegram-данных
    const urlParams = new URLSearchParams(window.location.search);
    const roleParam = urlParams.get('role');
    
    if (roleParam && ['admin', 'readonly', 'demo'].includes(roleParam)) {
      this.userRole = roleParam;
    } else if (window.config?.defaultRole) {
      this.userRole = window.config.defaultRole;
    } else {
      this.userRole = 'admin'; // Роль по умолчанию
    }

    // Применение класса темы в зависимости от роли
    const body = document.body;
    body.classList.remove('read-only-mode', 'demo-mode');
    if (this.userRole === 'readonly') {
      body.classList.add('read-only-mode');
    } else if (this.userRole === 'demo') {
      body.classList.add('demo-mode');
    }
  }

  getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    let mm = today.getMonth() + 1;
    let dd = today.getDate();
    if (mm < 10) mm = '0' + mm;
    if (dd < 10) dd = '0' + dd;
    return `${yyyy}-${mm}-${dd}`;
  }

  loadData() {
    const storedStudents = localStorage.getItem('attendance_students');
    if (storedStudents) {
      this.students = JSON.parse(storedStudents);
    } else {
      this.students = [...DEFAULT_STUDENTS];
      this.saveStudentsToStorage();
    }

    const storedHistory = localStorage.getItem('attendance_history');
    if (storedHistory) {
      this.history = JSON.parse(storedHistory);
    } else {
      this.history = [];
    }
  }

  saveStudentsToStorage() {
    localStorage.setItem('attendance_students', JSON.stringify(this.students));
  }

  saveHistoryToStorage() {
    localStorage.setItem('attendance_history', JSON.stringify(this.history));
  }

  initDOM() {
    // Индикация пользователя
    const userBadge = document.getElementById('userBadge');
    const modeBadge = document.getElementById('modeBadge');
    const accessNote = document.getElementById('accessNote');

    if (this.tg && this.tg.initDataUnsafe?.user) {
      const u = this.tg.initDataUnsafe.user;
      userBadge.textContent = u.first_name + (u.last_name ? ` ${u.last_name}` : '');
    } else {
      userBadge.textContent = 'Локальный режим';
    }

    // Текстовая настройка ролей
    if (this.userRole === 'admin') {
      modeBadge.textContent = 'Редактор';
      modeBadge.className = 'mode-chip admin';
      accessNote.textContent = 'Полный доступ на изменение и сохранение данных.';
    } else if (this.userRole === 'readonly') {
      modeBadge.textContent = 'Просмотр';
      modeBadge.className = 'mode-chip readonly';
      accessNote.textContent = 'Режим чтения. Сохранение и добавление отключены.';
    } else {
      modeBadge.textContent = 'Демо';
      modeBadge.className = 'mode-chip demo';
      accessNote.textContent = 'Имитация работы приложения без записи на сервер.';
    }

    // Генерация кнопок быстрого выбора причины
    const grid = document.getElementById('reasonOptionsGrid');
    grid.innerHTML = ABSENCE_REASONS.map(r => `
      <div class="reason-option-card" data-reason-id="${r.id}" role="radio" aria-checked="false">
        <span class="reason-option-card__title">${r.label}</span>
        <span class="reason-option-card__badge ${r.badge}">Причина</span>
      </div>
    `).join('');
  }

  bindEvents() {
    // Табы
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.switchTab(btn.getAttribute('data-tab'));
      });
    });

    // Фильтры
    document.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeFilter = chip.getAttribute('data-filter');
        this.renderStudentsList();
      });
    });

    // Поиск
    document.getElementById('searchInput').addEventListener('input', (e) => {
      this.searchQuery = e.target.value.toLowerCase();
      this.renderStudentsList();
    });

    // Дата занятия
    document.getElementById('lessonDate').addEventListener('change', (e) => {
      this.handleDateChange(e.target.value);
    });

    // Сохранение изменений
    document.getElementById('saveBtn').addEventListener('click', () => this.saveCurrentDay());
    document.getElementById('saveBannerBtn').addEventListener('click', () => this.saveCurrentDay());

    // Все присутствуют
    document.getElementById('markAllPresentBtn').addEventListener('click', () => this.markAllPresent());

    // Добавление ученика
    document.getElementById('addStudentForm').addEventListener('submit', (e) => {
      e.preventDefault();
      this.handleAddStudent();
    });

    // Очистка истории
    document.getElementById('clearHistoryBtn').addEventListener('click', () => {
      this.showConfirmModal('Удаление истории', 'Вы действительно хотите очистить всю локальную историю сохранений?', () => {
        this.history = [];
        this.saveHistoryToStorage();
        this.renderHistoryList();
        this.showToast('История успешно удалена');
      });
    });

    // Комментарий к занятию
    const noteInput = document.getElementById('lessonNoteInput');
    noteInput.addEventListener('input', (e) => {
      this.currentLessonNote = e.target.value;
      this.checkUnsavedChanges();
    });

    // Модальное окно причин отсутствия
    document.getElementById('closeModalBtn').addEventListener('click', () => this.closeModal('reasonModal'));
    document.getElementById('saveReasonBtn').addEventListener('click', () => this.submitReasonModal());
    document.getElementById('markPresentFromModalBtn').addEventListener('click', () => {
      if (this.selectedStudentId) {
        this.updateStudentAttendance(this.selectedStudentId, true);
        this.closeModal('reasonModal');
      }
    });

    // Клик на опции причины внутри модалки
    document.querySelectorAll('.reason-option-card').forEach(card => {
      card.addEventListener('click', () => {
        document.querySelectorAll('.reason-option-card').forEach(c => {
          c.classList.remove('selected');
          c.setAttribute('aria-checked', 'false');
        });
        card.classList.add('selected');
        card.setAttribute('aria-checked', 'true');
      });
    });

    // Остальные закрытия модалок
    document.getElementById('closeHistoryModalBtn').addEventListener('click', () => this.closeModal('historyModal'));
    
    // Подтверждения
    document.getElementById('confirmCancelBtn').addEventListener('click', () => this.closeModal('confirmModal'));
  }

  switchTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

    const activeBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    const activePanel = document.getElementById(`panel-${tabId}`);

    if (activeBtn && activePanel) {
      activeBtn.classList.add('active');
      activePanel.classList.add('active');
    }

    if (this.tg && this.tg.HapticFeedback) {
      this.tg.HapticFeedback.impactOccurred('light');
    }
  }

  loadStateForDate(dateStr) {
    // Попытка найти запись в истории для этой даты
    const savedRecord = this.history.find(h => h.date === dateStr);
    
    this.currentAttendanceState = {};
    if (savedRecord) {
      this.currentLessonNote = savedRecord.note || '';
      savedRecord.records.forEach(r => {
        this.currentAttendanceState[r.id] = {
          present: r.present,
          reason: r.reason || '',
          comment: r.comment || ''
        };
      });
    } else {
      this.currentLessonNote = '';
      this.students.forEach(s => {
        this.currentAttendanceState[s.id] = {
          present: true,
          reason: '',
          comment: ''
        };
      });
    }

    document.getElementById('lessonNoteInput').value = this.currentLessonNote;
    document.getElementById('lessonNoteView').textContent = this.currentLessonNote || 'Комментарий отсутствует.';
    
    this.checkUnsavedChanges();
    this.calculateStats();
  }

  handleDateChange(newDate) {
    if (this.hasUnsavedChanges()) {
      this.showConfirmModal(
        'Несохраненные изменения',
        'Вы переключаете дату. Несохраненные отметки будут потеряны. Продолжить?',
        () => {
          this.currentDate = newDate;
          this.loadStateForDate(newDate);
          this.render();
        },
        () => {
          document.getElementById('lessonDate').value = this.currentDate;
        }
      );
    } else {
      this.currentDate = newDate;
      this.loadStateForDate(newDate);
      this.render();
    }
  }

  hasUnsavedChanges() {
    const savedRecord = this.history.find(h => h.date === this.currentDate);
    
    if (savedRecord) {
      // Сравниваем примечание
      if ((savedRecord.note || '') !== this.currentLessonNote) return true;
      
      // Сравниваем каждого ученика
      for (const s of this.students) {
        const current = this.currentAttendanceState[s.id];
        const saved = savedRecord.records.find(r => r.id === s.id);
        if (!current || !saved) return true;
        if (current.present !== saved.present) return true;
        if (current.reason !== (saved.reason || '')) return true;
        if (current.comment !== (saved.comment || '')) return true;
      }
    } else {
      // Если записи не было, изменения считаются активными, если кто-то отмечен отсутствующим или есть текст
      if (this.currentLessonNote !== '') return true;
      for (const s of this.students) {
        const current = this.currentAttendanceState[s.id];
        if (current && !current.present) return true;
      }
    }
    return false;
  }

  checkUnsavedChanges() {
    const banner = document.getElementById('unsavedBanner');
    if (this.userRole !== 'readonly' && this.hasUnsavedChanges()) {
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
  }

  calculateStats() {
    const total = this.students.length;
    let present = 0;
    let absent = 0;

    this.students.forEach(s => {
      const state = this.currentAttendanceState[s.id];
      if (state && state.present) {
        present++;
      } else {
        absent++;
      }
    });

    document.getElementById('statTotal').textContent = total;
    document.getElementById('statPresent').textContent = present;
    document.getElementById('statAbsent').textContent = absent;

    const percent = total > 0 ? Math.round((present / total) * 100) : 0;
    document.getElementById('progressPercent').textContent = `${percent}%`;
    document.getElementById('attendanceProgress').style.width = `${percent}%`;

    const label = document.getElementById('progressLabel');
    if (total === 0) {
      label.textContent = 'Список пуст';
    } else {
      label.textContent = `Явка: ${present} из ${total}`;
    }
  }

  updateStudentAttendance(studentId, isPresent, reason = '', comment = '') {
    if (this.userRole === 'readonly') return;

    this.currentAttendanceState[studentId] = {
      present: isPresent,
      reason: isPresent ? '' : reason,
      comment: isPresent ? '' : comment
    };

    if (this.tg && this.tg.HapticFeedback) {
      this.tg.HapticFeedback.impactOccurred(isPresent ? 'light' : 'medium');
    }

    this.checkUnsavedChanges();
    this.calculateStats();
    this.renderStudentsList();
  }

  markAllPresent() {
    if (this.userRole === 'readonly') return;
    
    this.students.forEach(s => {
      this.currentAttendanceState[s.id] = {
        present: true,
        reason: '',
        comment: ''
      };
    });

    if (this.tg && this.tg.HapticFeedback) {
      this.tg.HapticFeedback.notificationOccurred('success');
    }

    this.showToast('Все ученики отмечены как присутствующие');
    this.checkUnsavedChanges();
    this.calculateStats();
    this.renderStudentsList();
  }

  saveCurrentDay() {
    if (this.userRole === 'readonly') {
      this.showToast('Действие недоступно в режиме просмотра');
      return;
    }

    this.showLoading(true, 'Сохранение данных...');

    setTimeout(() => {
      const records = this.students.map(s => {
        const state = this.currentAttendanceState[s.id] || { present: true, reason: '', comment: '' };
        return {
          id: s.id,
          name: s.name,
          present: state.present,
          reason: state.reason,
          comment: state.comment
        };
      });

      const total = this.students.length;
      const present = records.filter(r => r.present).length;
      const absent = total - present;

      // Обновление накопительной статистики учеников на основе новых отметок
      if (this.userRole !== 'demo') {
        this.students.forEach(s => {
          const state = this.currentAttendanceState[s.id];
          if (state) {
            if (state.present) {
              s.stats.present = (s.stats.present || 0) + 1;
            } else {
              s.stats.absent = (s.stats.absent || 0) + 1;
            }
          }
        });
        this.saveStudentsToStorage();
      }

      const newHistoryItem = {
        id: Date.now().toString(),
        date: this.currentDate,
        note: this.currentLessonNote,
        total,
        present,
        absent,
        records
      };

      // Перезапись существующего дня в истории или добавление нового
      const existingIndex = this.history.findIndex(h => h.date === this.currentDate);
      if (existingIndex > -1) {
        this.history[existingIndex] = newHistoryItem;
      } else {
        this.history.unshift(newHistoryItem);
      }

      if (this.userRole !== 'demo') {
        this.saveHistoryToStorage();
      }

      this.checkUnsavedChanges();
      this.showLoading(false);
      this.showToast('Журнал успешно сохранен');

      if (this.tg && this.tg.HapticFeedback) {
        this.tg.HapticFeedback.notificationOccurred('success');
      }

      this.render();
    }, 450);
  }

  handleAddStudent() {
    if (this.userRole === 'readonly') return;

    const input = document.getElementById('newStudentName');
    const name = input.value.trim();

    if (!name) {
      this.showToast('Заполните ФИО ученика');
      return;
    }

    const newStudent = {
      id: Date.now().toString(),
      name,
      present: true,
      reason: '',
      comment: '',
      stats: { present: 0, absent: 0 }
    };

    this.students.push(newStudent);
    
    // Добавление дефолтного состояния
    this.currentAttendanceState[newStudent.id] = {
      present: true,
      reason: '',
      comment: ''
    };

    if (this.userRole !== 'demo') {
      this.saveStudentsToStorage();
    }

    input.value = '';
    this.showToast(`Ученик ${name} добавлен`);
    this.calculateStats();
    this.render();
  }

  deleteStudent(id) {
    if (this.userRole === 'readonly') return;

    const student = this.students.find(s => s.id === id);
    if (!student) return;

    this.showConfirmModal('Удаление ученика', `Вы уверены, что хотите удалить ученика ${student.name} из базы данных?`, () => {
      this.students = this.students.filter(s => s.id !== id);
      delete this.currentAttendanceState[id];

      if (this.userRole !== 'demo') {
        this.saveStudentsToStorage();
      }

      this.showToast('Ученик успешно удален');
      this.calculateStats();
      this.render();
    });
  }

  openReasonModal(studentId) {
    if (this.userRole === 'readonly') return;

    this.selectedStudentId = studentId;
    const student = this.students.find(s => s.id === studentId);
    const state = this.currentAttendanceState[studentId] || { reason: '', comment: '' };

    document.getElementById('modalStudentName').textContent = student ? student.name : 'Ученик';
    document.getElementById('reasonComment').value = state.comment || '';

    // Сброс выбора
    document.querySelectorAll('.reason-option-card').forEach(card => {
      card.classList.remove('selected');
      card.setAttribute('aria-checked', 'false');
      if (card.getAttribute('data-reason-id') === state.reason) {
        card.classList.add('selected');
        card.setAttribute('aria-checked', 'true');
      }
    });

    this.openModal('reasonModal');
  }

  submitReasonModal() {
    if (!this.selectedStudentId) return;

    const selectedCard = document.querySelector('.reason-option-card.selected');
    const reason = selectedCard ? selectedCard.getAttribute('data-reason-id') : 'unexcused';
    const comment = document.getElementById('reasonComment').value.trim();

    this.updateStudentAttendance(this.selectedStudentId, false, reason, comment);
    this.closeModal('reasonModal');
  }

  openHistoryDetails(historyId) {
    const record = this.history.find(h => h.id === historyId);
    if (!record) return;

    const modalTitle = document.getElementById('historyModalTitle');
    const modalBody = document.getElementById('historyModalBody');

    modalTitle.textContent = `Занятие ${this.formatDateStr(record.date)}`;

    const presentList = record.records.filter(r => r.present);
    const absentList = record.records.filter(r => !r.present);

    let html = `
      <div class="history-details-grid">
        <div class="history-modal-summary">
          <span class="metric-pill">Всего: ${record.total}</span>
          <span class="metric-pill success">Были: ${record.present}</span>
          <span class="metric-pill danger">Не были: ${record.absent}</span>
        </div>
    `;

    if (record.note) {
      html += `
        <div class="history-modal-note">
          <strong>Комментарий к занятию:</strong>
          <span>${record.note}</span>
        </div>
      `;
    }

    html += `
        <div class="history-details-block">
          <strong>Присутствовали (${presentList.length}):</strong>
          ${presentList.length > 0 ? `
            <ul class="history-name-list">
              ${presentList.map(p => `<li>${p.name}</li>`).join('')}
            </ul>
          ` : '<span>Никого не было</span>'}
        </div>

        <div class="history-details-block absent-list">
          <strong>Отсутствовали (${absentList.length}):</strong>
          ${absentList.length > 0 ? `
            <ul class="history-name-list">
              ${absentList.map(a => {
                const reasonObj = ABSENCE_REASONS.find(r => r.id === a.reason);
                const rLabel = reasonObj ? reasonObj.label : 'Без причины';
                return `
                  <li>
                    ${a.name}
                    <span>Причина: ${rLabel} ${a.comment ? `(${a.comment})` : ''}</span>
                  </li>
                `;
              }).join('')}
            </ul>
          ` : '<span>Все присутствовали</span>'}
        </div>
      </div>
    `;

    modalBody.innerHTML = html;
    this.openModal('historyModal');
  }

  // --- Вспомогательные хелперы UI окон ---

  openModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
  }

  closeModal(modalId) {
    const modal = document.getElementById(modalId);
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  }

  showConfirmModal(title, text, onAccept, onCancel) {
    const modal = document.getElementById('confirmModal');
    document.getElementById('confirmTitle').textContent = title;
    document.getElementById('confirmText').textContent = text;

    const acceptBtn = document.getElementById('confirmAcceptBtn');
    const cancelBtn = document.getElementById('confirmCancelBtn');

    // Клонируем для удаления старых слушателей
    const newAccept = acceptBtn.cloneNode(true);
    const newCancel = cancelBtn.cloneNode(true);

    acceptBtn.parentNode.replaceChild(newAccept, acceptBtn);
    cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

    newAccept.addEventListener('click', () => {
      if (onAccept) onAccept();
      this.closeModal('confirmModal');
    });

    newCancel.addEventListener('click', () => {
      if (onCancel) onCancel();
      this.closeModal('confirmModal');
    });

    this.openModal('confirmModal');
  }

  showLoading(show, text = 'Загрузка...') {
    const overlay = document.getElementById('loadingOverlay');
    const loadText = document.getElementById('loadingText');
    if (show) {
      loadText.textContent = text;
      overlay.classList.remove('hidden');
    } else {
      overlay.classList.add('hidden');
    }
  }

  showToast(message) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }

  formatDateStr(str) {
    if (!str) return '';
    const parts = str.split('-');
    if (parts.length === 3) {
      return `${parts[2]}.${parts[1]}.${parts[0]}`;
    }
    return str;
  }

  // --- Функции рендеринга ---

  render() {
    this.renderStudentsList();
    this.renderAdminStudentsList();
    this.renderHistoryList();
  }

  renderStudentsList() {
    const list = document.getElementById('studentsList');
    list.innerHTML = '';

    // Применение фильтра и поиска
    const filtered = this.students.filter(s => {
      const matchSearch = s.name.toLowerCase().includes(this.searchQuery);
      const state = this.currentAttendanceState[s.id] || { present: true };
      
      if (this.activeFilter === 'present') {
        return matchSearch && state.present;
      }
      if (this.activeFilter === 'absent') {
        return matchSearch && !state.present;
      }
      return matchSearch;
    });

    if (filtered.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-state__badge">Группа пуста</span>
          <p class="section-desc">По данному запросу никто не найден.</p>
        </div>
      `;
      return;
    }

    filtered.forEach(s => {
      const state = this.currentAttendanceState[s.id] || { present: true, reason: '', comment: '' };
      const initials = s.name.split(' ').map(n => n[0]).slice(0, 2).join('').toUpperCase();
      
      const row = document.createElement('div');
      row.className = `attendance-row ${!state.present ? 'absent' : ''}`;
      row.setAttribute('data-id', s.id);

      const rObj = ABSENCE_REASONS.find(r => r.id === state.reason);
      const rLabel = rObj ? rObj.label : 'Без причины';

      row.innerHTML = `
        <div class="student-main">
          <div class="student-topline">
            <div class="avatar ${!state.present ? 'absent' : ''}">${initials}</div>
            <div class="name-stack">
              <div class="student-name">${s.name}</div>
              <div class="student-subtitle">Всего: пр. ${s.stats?.present || 0} / отс. ${s.stats?.absent || 0}</div>
            </div>
          </div>
          ${!state.present ? `
            <div class="reason-line">
              <span class="reason-badge">${rLabel}</span>
              ${state.comment ? `<span class="comment-text">${state.comment}</span>` : ''}
            </div>
          ` : ''}
        </div>
        <div class="row-actions">
          <div class="status-group">
            <button class="status-btn ${state.present ? 'active-present' : ''}" data-action="present" type="button">Была</button>
            <button class="status-btn ${!state.present ? 'active-absent' : ''}" data-action="absent" type="button">Н/Б</button>
          </div>
          ${!state.present ? `
            <button class="reason-btn" data-action="reason" type="button">Причина</button>
          ` : ''}
          <div class="view-status-pill ${state.present ? 'present' : 'absent'} view-only-indicator">
            ${state.present ? 'Был(а)' : 'Пропуск'}
          </div>
        </div>
      `;

      // Привязка событий внутри строки
      row.querySelector('[data-action="present"]').addEventListener('click', () => {
        this.updateStudentAttendance(s.id, true);
      });

      row.querySelector('[data-action="absent"]').addEventListener('click', () => {
        this.openReasonModal(s.id);
      });

      const reasonBtn = row.querySelector('[data-action="reason"]');
      if (reasonBtn) {
        reasonBtn.addEventListener('click', () => {
          this.openReasonModal(s.id);
        });
      }

      list.appendChild(row);
    });
  }

  renderAdminStudentsList() {
    const list = document.getElementById('studentsAdminList');
    list.innerHTML = '';

    if (this.students.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-state__badge">Архив пуст</span>
          <p class="section-desc">Добавьте своего первого ученика в форму выше.</p>
        </div>
      `;
      return;
    }

    this.students.forEach(s => {
      const row = document.createElement('div');
      row.className = 'admin-row';
      row.innerHTML = `
        <div>
          <strong>${s.name}</strong>
          <div class="admin-counters">
            <span class="metric-pill success">Присутствовал: ${s.stats?.present || 0}</span>
            <span class="metric-pill danger">Пропустил: ${s.stats?.absent || 0}</span>
          </div>
        </div>
        <div class="section-actions admin-only">
          <button class="danger-btn" data-action="delete" type="button">Удалить</button>
        </div>
      `;

      row.querySelector('[data-action="delete"]').addEventListener('click', () => {
        this.deleteStudent(s.id);
      });

      list.appendChild(row);
    });
  }

  renderHistoryList() {
    const list = document.getElementById('historyList');
    list.innerHTML = '';

    if (this.history.length === 0) {
      list.innerHTML = `
        <div class="empty-state">
          <span class="empty-state__badge">Истории нет</span>
          <p class="section-desc">Сохранения на текущие даты отсутствуют в памяти устройства.</p>
        </div>
      `;
      return;
    }

    this.history.forEach(h => {
      const row = document.createElement('div');
      row.className = `history-row ${h.absent > 0 ? 'has-absent' : ''}`;
      row.innerHTML = `
        <div>
          <strong>Занятие ${this.formatDateStr(h.date)}</strong>
          <div class="history-metrics">
            <span class="metric-pill">Всего: ${h.total}</span>
            <span class="metric-pill success">Были: ${h.present}</span>
            <span class="metric-pill danger">Пропустили: ${h.absent}</span>
          </div>
          ${h.note ? `<div class="history-note-line">${h.note}</div>` : ''}
        </div>
        <div class="history-actions-col">
          <button class="outline-btn" data-action="view" type="button">Посмотреть</button>
        </div>
      `;

      row.querySelector('[data-action="view"]').addEventListener('click', () => {
        this.openHistoryDetails(h.id);
      });

      list.appendChild(row);
    });
  }
}

// Запуск при готовности DOM
document.addEventListener('DOMContentLoaded', () => {
  window.appInstance = new AttendanceApp();
});
