// ==================== 설정 ====================
const STORAGE_KEY = 'notion-weekly-schedule';
const CLIENT_ID_KEY = 'google-client-id';
const SCOPES = 'https://www.googleapis.com/auth/calendar.events';

// ==================== 상태 ====================
let schedules = JSON.parse(localStorage.getItem(STORAGE_KEY)) || [];
let googleEvents = [];
let accessToken = null;
let tokenClient = null;

// ==================== DOM 요소 ====================
const weeklyGrid = document.querySelector('.weekly-grid');
const modal = document.getElementById('scheduleModal');
const settingsModal = document.getElementById('settingsModal');
const form = document.getElementById('scheduleForm');
const weekDisplay = document.querySelector('.week-display');
const googleAuthBtn = document.getElementById('googleAuthBtn');

// ==================== 설정값 ====================
const START_HOUR = 6;
const END_HOUR = 24;
const HOUR_HEIGHT = 60;
const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];

let currentWeekStart = getMonday(new Date());
let dayColumns = [];

// 드래그 상태
let dragState = {
  active: false,
  type: null,
  scheduleId: null,
  startY: 0,
  startX: 0,
  originalTop: 0,
  originalHeight: 0,
  originalDayIndex: 0,
  element: null
};

// ==================== 초기화 ====================
function init() {
  renderWeekDisplay();
  renderGrid();
  renderSchedules();
  renderCurrentTimeLine();
  initGoogleAuth();

  setInterval(renderCurrentTimeLine, 60000);
}

// ==================== Google 인증 ====================
function initGoogleAuth() {
  console.log('initGoogleAuth called');
  const clientId = localStorage.getItem(CLIENT_ID_KEY);
  console.log('clientId:', clientId ? 'exists' : 'null');

  if (!clientId) {
    updateAuthButton('설정 필요', false);
    return;
  }

  // Google Identity Services 로드 대기
  if (typeof google === 'undefined' || !google.accounts) {
    console.log('Waiting for Google Identity Services...');
    setTimeout(initGoogleAuth, 100);
    return;
  }

  console.log('Google Identity Services loaded');

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: (response) => {
      console.log('OAuth callback:', response);
      if (response.access_token) {
        accessToken = response.access_token;
        console.log('Access token received');
        updateAuthButton('연동됨', true);
        fetchGoogleCalendarEvents();
      } else if (response.error) {
        console.error('OAuth error:', response.error);
        updateAuthButton('Google 연동', false);
      }
    },
  });

  updateAuthButton('Google 연동', false);
}

function handleGoogleAuth() {
  const clientId = localStorage.getItem(CLIENT_ID_KEY);

  if (!clientId) {
    openSettingsModal();
    return;
  }

  if (accessToken) {
    // 로그아웃
    accessToken = null;
    googleEvents = [];
    updateAuthButton('Google 연동', false);
    renderSchedules();
    return;
  }

  if (tokenClient) {
    googleAuthBtn.classList.add('loading');
    googleAuthBtn.querySelector('span').textContent = '연결 중...';
    tokenClient.requestAccessToken();
  }
}

function updateAuthButton(text, connected) {
  googleAuthBtn.classList.remove('loading');
  googleAuthBtn.classList.toggle('connected', connected);
  googleAuthBtn.querySelector('span').textContent = text;
}

// ==================== Google Calendar API ====================
async function fetchGoogleCalendarEvents() {
  console.log('fetchGoogleCalendarEvents called, accessToken:', accessToken ? 'exists' : 'null');
  if (!accessToken) return;

  const startOfWeek = new Date(currentWeekStart);
  const endOfWeek = new Date(currentWeekStart);
  endOfWeek.setDate(endOfWeek.getDate() + 7);

  const timeMin = startOfWeek.toISOString();
  const timeMax = endOfWeek.toISOString();

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events?` +
      `timeMin=${encodeURIComponent(timeMin)}&` +
      `timeMax=${encodeURIComponent(timeMax)}&` +
      `singleEvents=true&orderBy=startTime`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!response.ok) {
      if (response.status === 401) {
        accessToken = null;
        updateAuthButton('Google 연동', false);
      }
      throw new Error('Failed to fetch events');
    }

    const data = await response.json();
    console.log('Google Calendar events:', data.items);

    googleEvents = (data.items || [])
      .filter(event => event.start?.dateTime || event.start?.date) // 시간 또는 종일 이벤트
      .map(event => {
        // 종일 이벤트 처리
        if (event.start?.date) {
          return {
            id: event.id,
            title: event.summary || '(제목 없음)',
            startTime: '09:00',
            endTime: '10:00',
            dateKey: event.start.date,
            color: getGoogleEventColor(event.colorId),
            isGoogle: true,
            isAllDay: true
          };
        }

        return {
          id: event.id,
          title: event.summary || '(제목 없음)',
          startTime: formatTime(new Date(event.start.dateTime)),
          endTime: formatTime(new Date(event.end.dateTime)),
          dateKey: formatDateKey(new Date(event.start.dateTime)),
          color: getGoogleEventColor(event.colorId),
          isGoogle: true
        };
      });

    console.log('Parsed Google events:', googleEvents);
    renderSchedules();
  } catch (error) {
    console.error('Google Calendar fetch error:', error);
  }
}

function formatTime(date) {
  return `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
}

function getGoogleEventColor(colorId) {
  const colors = {
    '1': '#7986CB', '2': '#33B679', '3': '#8E24AA',
    '4': '#E67C73', '5': '#F6BF26', '6': '#F4511E',
    '7': '#039BE5', '8': '#616161', '9': '#3F51B5',
    '10': '#0B8043', '11': '#D50000'
  };
  return colors[colorId] || '#4285F4';
}

// ==================== Google Calendar 쓰기 ====================
async function createGoogleEvent(title, dateKey, startTime, endTime) {
  if (!accessToken) return null;

  const startDateTime = `${dateKey}T${startTime}:00`;
  const endDateTime = `${dateKey}T${endTime}:00`;

  // 타임존 가져오기
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const event = {
    summary: title,
    start: {
      dateTime: startDateTime,
      timeZone: timeZone
    },
    end: {
      dateTime: endDateTime,
      timeZone: timeZone
    }
  };

  try {
    const response = await fetch(
      'https://www.googleapis.com/calendar/v3/calendars/primary/events',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    if (!response.ok) {
      throw new Error('Failed to create event');
    }

    const data = await response.json();
    return data.id;
  } catch (error) {
    console.error('Google Calendar create error:', error);
    return null;
  }
}

async function updateGoogleEvent(eventId, title, dateKey, startTime, endTime) {
  if (!accessToken || !eventId) return false;

  const startDateTime = `${dateKey}T${startTime}:00`;
  const endDateTime = `${dateKey}T${endTime}:00`;
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const event = {
    summary: title,
    start: {
      dateTime: startDateTime,
      timeZone: timeZone
    },
    end: {
      dateTime: endDateTime,
      timeZone: timeZone
    }
  };

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(event)
      }
    );

    return response.ok;
  } catch (error) {
    console.error('Google Calendar update error:', error);
    return false;
  }
}

async function deleteGoogleEvent(eventId) {
  if (!accessToken || !eventId) return false;

  try {
    const response = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/primary/events/${eventId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${accessToken}`
        }
      }
    );

    return response.ok || response.status === 404;
  } catch (error) {
    console.error('Google Calendar delete error:', error);
    return false;
  }
}

// ==================== 설정 모달 ====================
function openSettingsModal() {
  settingsModal.classList.add('active');
  document.getElementById('clientId').value = localStorage.getItem(CLIENT_ID_KEY) || '';
}

function closeSettingsModal() {
  settingsModal.classList.remove('active');
}

function saveClientId() {
  const clientId = document.getElementById('clientId').value.trim();

  if (!clientId) {
    alert('Client ID를 입력해주세요.');
    return;
  }

  localStorage.setItem(CLIENT_ID_KEY, clientId);
  closeSettingsModal();
  initGoogleAuth();
}

// ==================== 날짜/시간 유틸 ====================
function getMonday(date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function formatDateKey(date) {
  const y = date.getFullYear();
  const m = (date.getMonth() + 1).toString().padStart(2, '0');
  const d = date.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function posToTime(pos) {
  const totalMinutes = (pos / HOUR_HEIGHT) * 60 + START_HOUR * 60;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.round(totalMinutes % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// ==================== 주 네비게이션 ====================
function changeWeek(delta) {
  currentWeekStart.setDate(currentWeekStart.getDate() + delta * 7);
  renderWeekDisplay();
  renderGrid();
  renderSchedules();
  renderCurrentTimeLine();

  if (accessToken) {
    fetchGoogleCalendarEvents();
  }
}

function renderWeekDisplay() {
  const endOfWeek = new Date(currentWeekStart);
  endOfWeek.setDate(endOfWeek.getDate() + 6);

  const startMonth = currentWeekStart.getMonth() + 1;
  const startDay = currentWeekStart.getDate();
  const endMonth = endOfWeek.getMonth() + 1;
  const endDay = endOfWeek.getDate();
  const year = currentWeekStart.getFullYear();

  if (startMonth === endMonth) {
    weekDisplay.textContent = `${year}년 ${startMonth}월 ${startDay}일 - ${endDay}일`;
  } else {
    weekDisplay.textContent = `${year}년 ${startMonth}/${startDay} - ${endMonth}/${endDay}`;
  }
}

// ==================== 그리드 렌더링 ====================
function renderGrid() {
  weeklyGrid.innerHTML = '';
  dayColumns = [];

  // 시간 컬럼
  const timeColumn = document.createElement('div');
  timeColumn.className = 'time-column';
  timeColumn.innerHTML = '<div class="day-header"></div>';

  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    const label = document.createElement('div');
    label.className = 'time-label';
    label.textContent = `${hour.toString().padStart(2, '0')}:00`;
    timeColumn.appendChild(label);
  }
  weeklyGrid.appendChild(timeColumn);

  // 요일 컬럼들
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + i);

    const column = document.createElement('div');
    column.className = 'day-column';
    column.dataset.dayIndex = i;

    const header = document.createElement('div');
    header.className = 'day-header';
    if (date.getTime() === today.getTime()) {
      header.classList.add('today');
    }
    header.innerHTML = `
      <span class="day-name">${DAY_NAMES[i]}</span>
      <span class="day-date">${date.getDate()}</span>
    `;
    column.appendChild(header);

    const slots = document.createElement('div');
    slots.className = 'day-slots';

    for (let hour = START_HOUR; hour < END_HOUR; hour++) {
      const slot = document.createElement('div');
      slot.className = 'time-slot';
      slot.dataset.hour = hour;
      slot.addEventListener('click', () => {
        openModal(null, i, `${hour.toString().padStart(2, '0')}:00`);
      });
      slots.appendChild(slot);
    }

    column.appendChild(slots);
    weeklyGrid.appendChild(column);
    dayColumns.push(column);
  }
}

// ==================== 스케줄 렌더링 ====================
function renderSchedules() {
  document.querySelectorAll('.schedule-item').forEach(el => el.remove());

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + i);
    weekDates.push(formatDateKey(date));
  }

  console.log('weekDates:', weekDates);
  console.log('googleEvents to render:', googleEvents.length);

  // 로컬 스케줄
  schedules.forEach(schedule => {
    const dayIndex = weekDates.indexOf(schedule.dateKey);
    if (dayIndex === -1) return;

    const column = dayColumns[dayIndex];
    if (!column) return;

    const slotsContainer = column.querySelector('.day-slots');
    const item = createScheduleElement(schedule, dayIndex, false);
    slotsContainer.appendChild(item);
  });

  // Google 이벤트
  googleEvents.forEach(event => {
    const dayIndex = weekDates.indexOf(event.dateKey);
    console.log(`Event "${event.title}" dateKey=${event.dateKey} dayIndex=${dayIndex}`);
    if (dayIndex === -1) {
      console.log(`  -> Skipped (not in current week)`);
      return;
    }

    const column = dayColumns[dayIndex];
    if (!column) {
      console.log(`  -> Skipped (no column)`);
      return;
    }

    const slotsContainer = column.querySelector('.day-slots');
    const item = createScheduleElement(event, dayIndex, true);
    slotsContainer.appendChild(item);
    console.log(`  -> Rendered!`);
  });
}

function createScheduleElement(schedule, dayIndex, isGoogle) {
  const [startHour, startMin] = schedule.startTime.split(':').map(Number);
  const [endHour, endMin] = schedule.endTime.split(':').map(Number);

  const startPos = (startHour - START_HOUR) * HOUR_HEIGHT + (startMin / 60) * HOUR_HEIGHT;
  const endPos = (endHour - START_HOUR) * HOUR_HEIGHT + (endMin / 60) * HOUR_HEIGHT;
  const height = Math.max(endPos - startPos, 24);

  const item = document.createElement('div');
  item.className = 'schedule-item' + (isGoogle ? ' google-event' : '');
  item.style.top = `${startPos}px`;
  item.style.height = `${height}px`;
  item.style.backgroundColor = schedule.color || '#4285F4';
  item.dataset.id = schedule.id;
  item.dataset.dayIndex = dayIndex;

  const googleIcon = isGoogle ? `
    <svg class="google-icon" viewBox="0 0 24 24" fill="white">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
    </svg>
  ` : '';

  // 모든 일정에 삭제 버튼과 리사이즈 핸들 추가
  item.innerHTML = `
    <div class="title">${escapeHtml(schedule.title)}</div>
    <div class="time">${schedule.startTime} - ${schedule.endTime}</div>
    <button class="delete-btn" data-id="${schedule.id}" data-google="${isGoogle}">&times;</button>
    <div class="resize-handle"></div>
    ${googleIcon}
  `;

  // 삭제 버튼 이벤트
  item.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    if (isGoogle) {
      deleteGoogleSchedule(schedule.id);
    } else {
      deleteSchedule(schedule.id, e);
    }
  });

  // 드래그 이동 (모든 일정)
  item.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('delete-btn') || e.target.classList.contains('resize-handle')) return;
    startDrag(e, schedule.id, 'move', item, dayIndex, isGoogle);
  });

  // 리사이즈
  const resizeHandle = item.querySelector('.resize-handle');
  if (resizeHandle) {
    resizeHandle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      startDrag(e, schedule.id, 'resize', item, dayIndex, isGoogle);
    });
  }

  // 더블클릭 수정
  item.addEventListener('dblclick', () => {
    if (isGoogle) {
      openModalForGoogle(schedule);
    } else {
      const s = schedules.find(s => s.id === item.dataset.id);
      openModal(s);
    }
  });

  return item;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Google 일정 삭제
async function deleteGoogleSchedule(eventId) {
  if (!confirm('이 일정을 삭제하시겠습니까?')) return;

  const success = await deleteGoogleEvent(eventId);
  if (success) {
    googleEvents = googleEvents.filter(e => e.id !== eventId);
    renderSchedules();
    // 다시 가져오기
    fetchGoogleCalendarEvents();
  } else {
    alert('삭제에 실패했습니다.');
  }
}

// Google 일정 수정 모달
function openModalForGoogle(schedule) {
  modal.classList.add('active');

  document.getElementById('modalTitle').textContent = '일정 수정 (Google)';
  document.getElementById('editId').value = schedule.id;
  document.getElementById('isGoogleEvent').value = 'true';
  document.getElementById('title').value = schedule.title;
  document.getElementById('startTime').value = schedule.startTime;
  document.getElementById('endTime').value = schedule.endTime;

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + i);
    weekDates.push(formatDateKey(date));
  }
  const dayIndex = weekDates.indexOf(schedule.dateKey);
  document.getElementById('dayOfWeek').value = dayIndex >= 0 ? dayIndex : 0;

  // 기본 색상 선택
  const colorRadio = document.querySelector('input[name="color"][value="#4A90D9"]');
  if (colorRadio) colorRadio.checked = true;
}

// ==================== 드래그 ====================
function startDrag(e, scheduleId, type, element, dayIndex, isGoogle = false) {
  e.preventDefault();

  dragState = {
    active: true,
    isGoogle,
    type,
    scheduleId,
    startY: e.clientY,
    startX: e.clientX,
    originalTop: parseInt(element.style.top),
    originalHeight: parseInt(element.style.height),
    originalDayIndex: dayIndex,
    element
  };

  element.classList.add('dragging');
  document.body.style.cursor = type === 'resize' ? 'ns-resize' : 'grabbing';
}

document.addEventListener('mousemove', (e) => {
  if (!dragState.active) return;

  const deltaY = e.clientY - dragState.startY;
  const deltaX = e.clientX - dragState.startX;
  const { type, element, originalTop, originalHeight } = dragState;

  if (type === 'move') {
    let newTop = originalTop + deltaY;
    const maxTop = (END_HOUR - START_HOUR) * HOUR_HEIGHT - parseInt(element.style.height);
    newTop = Math.max(0, Math.min(newTop, maxTop));
    element.style.top = `${newTop}px`;

    const columnWidth = dayColumns[0]?.offsetWidth || 100;
    const dayShift = Math.round(deltaX / columnWidth);
    const newDayIndex = Math.max(0, Math.min(6, dragState.originalDayIndex + dayShift));

    if (newDayIndex !== parseInt(element.dataset.dayIndex)) {
      const newColumn = dayColumns[newDayIndex]?.querySelector('.day-slots');
      if (newColumn) {
        newColumn.appendChild(element);
        element.dataset.dayIndex = newDayIndex;
      }
    }
  } else if (type === 'resize') {
    let newHeight = originalHeight + deltaY;
    const maxHeight = (END_HOUR - START_HOUR) * HOUR_HEIGHT - originalTop;
    newHeight = Math.max(24, Math.min(newHeight, maxHeight));
    element.style.height = `${newHeight}px`;
  }

  updateTimePreview(element);
});

document.addEventListener('mouseup', async () => {
  if (!dragState.active) return;

  const { element, scheduleId, isGoogle } = dragState;
  element.classList.remove('dragging');
  document.body.style.cursor = '';

  const top = parseInt(element.style.top);
  const height = parseInt(element.style.height);
  const snappedTop = Math.round(top / 15) * 15;
  const snappedHeight = Math.max(Math.round(height / 15) * 15, 15);

  element.style.top = `${snappedTop}px`;
  element.style.height = `${snappedHeight}px`;

  const newDayIndex = parseInt(element.dataset.dayIndex);
  const newDate = new Date(currentWeekStart);
  newDate.setDate(newDate.getDate() + newDayIndex);
  const newDateKey = formatDateKey(newDate);
  const newStartTime = posToTime(snappedTop);
  const newEndTime = posToTime(snappedTop + snappedHeight);

  if (isGoogle) {
    // Google 일정 업데이트
    const event = googleEvents.find(e => e.id === scheduleId);
    if (event) {
      await updateGoogleEvent(scheduleId, event.title, newDateKey, newStartTime, newEndTime);
      fetchGoogleCalendarEvents();
    }
  } else {
    // 로컬 일정 업데이트
    const schedule = schedules.find(s => s.id === scheduleId);
    if (schedule) {
      schedule.dateKey = newDateKey;
      schedule.startTime = newStartTime;
      schedule.endTime = newEndTime;

      // Google에도 업데이트
      if (schedule.googleEventId) {
        await updateGoogleEvent(schedule.googleEventId, schedule.title, newDateKey, newStartTime, newEndTime);
      }

      saveSchedules();
      renderSchedules();
    }
  }

  dragState.active = false;
});

function updateTimePreview(element) {
  const top = parseInt(element.style.top);
  const height = parseInt(element.style.height);
  const timeEl = element.querySelector('.time');
  if (timeEl) {
    timeEl.textContent = `${posToTime(top)} - ${posToTime(top + height)}`;
  }
}

// ==================== 현재 시간선 ====================
function renderCurrentTimeLine() {
  document.querySelectorAll('.current-time-line').forEach(el => el.remove());

  const now = new Date();
  const hours = now.getHours();
  const minutes = now.getMinutes();

  if (hours < START_HOUR || hours >= END_HOUR) return;

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + i);

    if (date.getTime() === today.getTime()) {
      const column = dayColumns[i];
      if (!column) return;

      const slots = column.querySelector('.day-slots');
      const top = (hours - START_HOUR) * HOUR_HEIGHT + (minutes / 60) * HOUR_HEIGHT;

      const line = document.createElement('div');
      line.className = 'current-time-line';
      line.style.top = `${top}px`;
      slots.appendChild(line);
      break;
    }
  }
}

// ==================== 모달 ====================
function openModal(schedule = null, defaultDayIndex = 0, defaultTime = '09:00') {
  modal.classList.add('active');
  document.getElementById('isGoogleEvent').value = 'false';

  if (schedule) {
    document.getElementById('modalTitle').textContent = '일정 수정';
    document.getElementById('editId').value = schedule.id;
    document.getElementById('title').value = schedule.title;
    document.getElementById('startTime').value = schedule.startTime;
    document.getElementById('endTime').value = schedule.endTime;

    const weekDates = [];
    for (let i = 0; i < 7; i++) {
      const date = new Date(currentWeekStart);
      date.setDate(date.getDate() + i);
      weekDates.push(formatDateKey(date));
    }
    const dayIndex = weekDates.indexOf(schedule.dateKey);
    document.getElementById('dayOfWeek').value = dayIndex >= 0 ? dayIndex : 0;

    const colorRadio = document.querySelector(`input[name="color"][value="${schedule.color}"]`);
    if (colorRadio) colorRadio.checked = true;
  } else {
    document.getElementById('modalTitle').textContent = '일정 추가';
    form.reset();
    document.getElementById('editId').value = '';
    document.getElementById('dayOfWeek').value = defaultDayIndex;
    document.getElementById('startTime').value = defaultTime;

    const [h, m] = defaultTime.split(':').map(Number);
    const endHour = Math.min(h + 1, END_HOUR);
    document.getElementById('endTime').value = `${endHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }
}

function closeModal() {
  modal.classList.remove('active');
  form.reset();
}

// ==================== 폼 처리 ====================
form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const editId = document.getElementById('editId').value;
  const title = document.getElementById('title').value.trim();
  const dayIndex = parseInt(document.getElementById('dayOfWeek').value);
  const startTime = document.getElementById('startTime').value;
  const endTime = document.getElementById('endTime').value;
  const color = document.querySelector('input[name="color"]:checked').value;

  if (startTime >= endTime) {
    alert('종료 시간은 시작 시간보다 늦어야 합니다.');
    return;
  }

  const date = new Date(currentWeekStart);
  date.setDate(date.getDate() + dayIndex);
  const dateKey = formatDateKey(date);

  // 버튼 비활성화
  const saveBtn = form.querySelector('.btn-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  const isGoogleEvent = document.getElementById('isGoogleEvent').value === 'true';

  if (editId && isGoogleEvent) {
    // Google 일정 수정
    await updateGoogleEvent(editId, title, dateKey, startTime, endTime);

    saveBtn.disabled = false;
    saveBtn.textContent = '저장';

    // 다시 가져오기
    await fetchGoogleCalendarEvents();
    closeModal();
    return;
  }

  if (editId) {
    // 로컬 일정 수정
    const index = schedules.findIndex(s => s.id === editId);
    if (index !== -1) {
      const schedule = schedules[index];

      // Google Calendar 업데이트
      if (accessToken && schedule.googleEventId) {
        await updateGoogleEvent(schedule.googleEventId, title, dateKey, startTime, endTime);
      }

      schedules[index] = { ...schedule, title, dateKey, startTime, endTime, color };
    }
  } else {
    // 새 일정
    let googleEventId = null;

    // Google Calendar에 추가
    if (accessToken) {
      googleEventId = await createGoogleEvent(title, dateKey, startTime, endTime);
    }

    schedules.push({
      id: Date.now().toString(),
      googleEventId,
      title,
      dateKey,
      startTime,
      endTime,
      color
    });
  }

  saveBtn.disabled = false;
  saveBtn.textContent = '저장';

  saveSchedules();

  // Google에서 다시 가져와서 동기화
  if (accessToken) {
    await fetchGoogleCalendarEvents();
  } else {
    renderSchedules();
  }

  closeModal();
});

async function deleteSchedule(id, event) {
  event.stopPropagation();

  if (!confirm('이 일정을 삭제하시겠습니까?')) return;

  const schedule = schedules.find(s => s.id === id);

  // Google Calendar에서도 삭제
  if (accessToken && schedule?.googleEventId) {
    await deleteGoogleEvent(schedule.googleEventId);
  }

  schedules = schedules.filter(s => s.id !== id);
  saveSchedules();

  // Google에서 다시 가져와서 동기화
  if (accessToken) {
    await fetchGoogleCalendarEvents();
  } else {
    renderSchedules();
  }
}

function saveSchedules() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(schedules));
}

// ==================== 모달 이벤트 ====================
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

settingsModal.addEventListener('click', (e) => {
  if (e.target === settingsModal) closeSettingsModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modal.classList.contains('active')) closeModal();
    if (settingsModal.classList.contains('active')) closeSettingsModal();
  }
});

// ==================== 시작 ====================
init();
