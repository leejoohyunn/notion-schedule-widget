(function() {
// ==================== Google Calendar 설정 ====================
let googleScriptUrl = '';

// ==================== 모드 스위치 ====================
// Supabase 프로젝트가 삭제되어 로그인/원격저장을 끕니다.
// 나중에 Supabase를 새로 만들면 true로 바꾸고 아래 URL/KEY만 교체하면 원상복구됩니다.
const USE_SUPABASE = false;
const LS_SCRIPT_URL = 'notion-widget:googleScriptUrl';

// ==================== Supabase 설정 ====================
const SUPABASE_URL = 'https://gnhirzcrnufzetocwrii.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImduaGlyemNybnVmemV0b2N3cmlpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA2MTY5NDgsImV4cCI6MjA4NjE5Mjk0OH0.s9dcZPhhiOMalRPSYQ2MI5MzsaGTYrGut0-4NiDjyMQ';

// iframe 환경에서 localStorage 차단 대비 커스텀 스토리지
const memoryStorage = {};
const customStorage = {
  getItem: (key) => {
    try { return localStorage.getItem(key); }
    catch { return memoryStorage[key] || null; }
  },
  setItem: (key, value) => {
    try { localStorage.setItem(key, value); }
    catch { memoryStorage[key] = value; }
  },
  removeItem: (key) => {
    try { localStorage.removeItem(key); }
    catch { delete memoryStorage[key]; }
  }
};

let supabase;
try {
  if (USE_SUPABASE) supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: customStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false
    }
  });
} catch (e) {
  console.error('Supabase init error:', e);
}

// ==================== 상태 ====================
let currentUser = null;
let schedules = [];
let googleEvents = [];
let pendingAuthEmail = '';
let _confirmResolve = null;
let editingGoogleEvent = null;

// ==================== DOM 요소 ====================
const weeklyGrid = document.getElementById('weeklyGrid');
const modal = document.getElementById('scheduleModal');
const form = document.getElementById('scheduleForm');
const weekDisplay = document.querySelector('.week-display');
const authBtn = document.getElementById('authBtn');

// ==================== 설정값 ====================
const START_HOUR = 0;
const END_HOUR = 24;
const HOUR_HEIGHT = 60;
const ALLDAY_ROW_H = 18;   // 종일 일정 한 줄 높이(px)
const DAY_NAMES = ['월', '화', '수', '목', '금', '토', '일'];

// Google Calendar 색상 매핑 (hex ↔ colorId)
const COLOR_TO_GCAL = {
  '#D50000': '11', '#E67C73': '4', '#F4511E': '6', '#F6BF26': '5',
  '#33B679': '2', '#0B8043': '10', '#039BE5': '7', '#3F51B5': '9',
  '#7986CB': '1', '#8E24AA': '3', '#616161': '8'
};
const GCAL_TO_COLOR = {};
for (const [hex, id] of Object.entries(COLOR_TO_GCAL)) GCAL_TO_COLOR[id] = hex;

let currentWeekStart = getMonday(new Date());
let dayColumns = [];
let dayHeaders = [];

// 드래그 상태
let dragState = {
  active: false,
  type: null,
  scheduleId: null,
  isGoogle: false,
  startY: 0,
  startX: 0,
  originalTop: 0,
  originalHeight: 0,
  originalDayIndex: 0,
  element: null
};

// ==================== 초기화 ====================
async function init() {
  renderWeekDisplay();
  renderGrid();

  if (supabase) {
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      currentUser = session.user;
      updateAuthButton(true);
      await loadSchedules();
      await loadUserSettings();
    }

    supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed:', event);
      if (session) {
        currentUser = session.user;
        updateAuthButton(true);
        await loadSchedules();
        await loadUserSettings();
        loadGoogleCalendarEvents();
      } else {
        currentUser = null;
        schedules = [];
        googleScriptUrl = '';
        googleEvents = [];
        updateAuthButton(false);
        renderSchedules();
      }
    });
  }

  if (!USE_SUPABASE && authBtn) authBtn.style.display = 'none';
  await loadUserSettings();

  renderSchedules();
  loadGoogleCalendarEvents();
  renderCurrentTimeLine();
  setInterval(renderCurrentTimeLine, 60000);
}

// ==================== 인증 (이메일 OTP) ====================
function handleAuth() {
  if (!supabase) {
    showToast('Supabase 연결 오류');
    return;
  }

  if (currentUser) {
    supabase.auth.signOut();
    currentUser = null;
    schedules = [];
    googleScriptUrl = '';
    googleEvents = [];
    updateAuthButton(false);
    renderSchedules();
    showToast('로그아웃 되었습니다.');
  } else {
    openAuthModal();
  }
}

function openAuthModal() {
  const authModal = document.getElementById('authModal');
  document.getElementById('authStep1').style.display = 'block';
  document.getElementById('authStep2').style.display = 'none';
  document.getElementById('authEmail').value = '';
  document.getElementById('otpCode').value = '';
  authModal.classList.add('active');
}

function closeAuthModal() {
  document.getElementById('authModal').classList.remove('active');
}

async function sendOTP() {
  const email = document.getElementById('authEmail').value.trim();
  if (!email) {
    showToast('이메일을 입력해주세요.');
    return;
  }

  const btn = document.getElementById('sendOtpBtn');
  btn.disabled = true;
  btn.textContent = '발송 중...';

  const { error } = await supabase.auth.signInWithOtp({ email });

  btn.disabled = false;
  btn.textContent = '인증코드 발송';

  if (error) {
    console.error('OTP send error:', error);
    showToast('발송 실패: ' + error.message);
    return;
  }

  pendingAuthEmail = email;
  document.getElementById('authStep1').style.display = 'none';
  document.getElementById('authStep2').style.display = 'block';
  document.getElementById('authEmailDisplay').textContent = email + ' 으로 인증코드를 보냈습니다.';
  showToast('인증코드가 발송되었습니다.');
}

async function verifyOTP() {
  const code = document.getElementById('otpCode').value.trim();
  if (!code) {
    showToast('인증코드를 입력해주세요.');
    return;
  }

  const btn = document.getElementById('verifyOtpBtn');
  btn.disabled = true;
  btn.textContent = '확인 중...';

  const { error } = await supabase.auth.verifyOtp({
    email: pendingAuthEmail,
    token: code,
    type: 'email'
  });

  btn.disabled = false;
  btn.textContent = '확인';

  if (error) {
    console.error('OTP verify error:', error);
    showToast('인증 실패: ' + error.message);
    return;
  }

  closeAuthModal();
  showToast('로그인 성공!');
}

function updateAuthButton(isLoggedIn) {
  if (isLoggedIn) {
    authBtn.classList.add('connected');
    authBtn.querySelector('span').textContent = '로그아웃';
  } else {
    authBtn.classList.remove('connected');
    authBtn.querySelector('span').textContent = '로그인';
  }
}

// ==================== 사용자 설정 (Google Script URL) ====================
async function loadUserSettings() {
  if (!USE_SUPABASE) {
    googleScriptUrl = customStorage.getItem(LS_SCRIPT_URL) || '';
    return;
  }
  if (!supabase || !currentUser) return;

  const { data, error } = await supabase
    .from('user_settings')
    .select('google_script_url')
    .eq('user_id', currentUser.id)
    .single();

  if (error) {
    if (error.code !== 'PGRST116') console.error('Load settings error:', error);
    googleScriptUrl = '';
    return;
  }

  googleScriptUrl = data.google_script_url || '';
}

async function saveUserSettings(url) {
  if (!USE_SUPABASE) {
    customStorage.setItem(LS_SCRIPT_URL, url);
    googleScriptUrl = url;
    return true;
  }
  if (!supabase || !currentUser) return false;

  const { error } = await supabase
    .from('user_settings')
    .upsert({
      user_id: currentUser.id,
      google_script_url: url
    });

  if (error) {
    console.error('Save settings error:', error);
    return false;
  }

  googleScriptUrl = url;
  return true;
}

function openSettingsModal() {
  if (USE_SUPABASE && !currentUser) {
    showToast('로그인이 필요합니다.');
    return;
  }
  const settingsModal = document.getElementById('settingsModal');
  document.getElementById('googleScriptUrlInput').value = googleScriptUrl;
  settingsModal.classList.add('active');
}

function closeSettingsModal() {
  document.getElementById('settingsModal').classList.remove('active');
}

async function saveSettings() {
  const url = document.getElementById('googleScriptUrlInput').value.trim();
  const btn = document.getElementById('saveSettingsBtn');
  btn.disabled = true;
  btn.textContent = '저장 중...';

  const success = await saveUserSettings(url);

  btn.disabled = false;
  btn.textContent = '저장';

  if (success) {
    closeSettingsModal();
    showToast('설정이 저장되었습니다.');
    googleEvents = [];
    renderSchedules();
    loadGoogleCalendarEvents();
  } else {
    showToast('설정 저장에 실패했습니다.');
  }
}

// ==================== 토스트 / 확인 다이얼로그 ====================
function showToast(message) {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 2500);
}

function showConfirm(message) {
  return new Promise((resolve) => {
    _confirmResolve = resolve;
    const confirmModal = document.getElementById('confirmModal');
    confirmModal.querySelector('.confirm-message').textContent = message;
    confirmModal.classList.add('active');
  });
}

function resolveConfirm(result) {
  const confirmModal = document.getElementById('confirmModal');
  confirmModal.classList.remove('active');
  if (_confirmResolve) {
    _confirmResolve(result);
    _confirmResolve = null;
  }
}

// ==================== Google Calendar ====================
async function loadGoogleCalendarEvents() {
  if (!googleScriptUrl) return;

  try {
    const weekEnd = new Date(currentWeekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const params = new URLSearchParams({
      start: currentWeekStart.toISOString(),
      end: weekEnd.toISOString()
    });

    const res = await fetch(`${googleScriptUrl}?${params}`);
    googleEvents = await res.json();
    renderSchedules();
  } catch (e) {
    console.error('Google Calendar load error:', e);
  }
}

// ==================== 데이터베이스 ====================
async function loadSchedules() {
  if (!supabase || !currentUser) return;

  const { data, error } = await supabase
    .from('schedules')
    .select('*')
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Load schedules error:', error);
    return;
  }

  schedules = data.map(s => ({
    id: s.id,
    title: s.title,
    dateKey: s.date_key,
    startTime: s.start_time,
    endTime: s.end_time,
    color: s.color
  }));

  renderSchedules();
}

async function saveSchedule(schedule) {
  if (!supabase || !currentUser) return null;

  const { data, error } = await supabase
    .from('schedules')
    .insert({
      user_id: currentUser.id,
      title: schedule.title,
      date_key: schedule.dateKey,
      start_time: schedule.startTime,
      end_time: schedule.endTime,
      color: schedule.color
    })
    .select()
    .single();

  if (error) {
    console.error('Save schedule error:', error);
    return null;
  }

  return data;
}

async function updateSchedule(id, updates) {
  if (!supabase || !currentUser) return false;

  const { error } = await supabase
    .from('schedules')
    .update({
      title: updates.title,
      date_key: updates.dateKey,
      start_time: updates.startTime,
      end_time: updates.endTime,
      color: updates.color
    })
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Update schedule error:', error);
    return false;
  }

  return true;
}

async function deleteScheduleFromDB(id) {
  if (!supabase || !currentUser) return false;

  const { error } = await supabase
    .from('schedules')
    .delete()
    .eq('id', id)
    .eq('user_id', currentUser.id);

  if (error) {
    console.error('Delete schedule error:', error);
    return false;
  }

  return true;
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
  loadGoogleCalendarEvents();
  renderCurrentTimeLine();
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
  dayHeaders = [];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // 시간 컬럼
  const timeColumn = document.createElement('div');
  timeColumn.className = 'time-column';

  const timeHeader = document.createElement('div');
  timeHeader.className = 'day-header';
  timeColumn.appendChild(timeHeader);

  for (let hour = START_HOUR; hour < END_HOUR; hour++) {
    const label = document.createElement('div');
    label.className = 'time-label';
    label.textContent = `${hour.toString().padStart(2, '0')}:00`;
    timeColumn.appendChild(label);
  }
  weeklyGrid.appendChild(timeColumn);

  // 요일 컬럼
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
    dayHeaders.push(header);

    const slots = document.createElement('div');
    slots.className = 'day-slots';

    for (let hour = START_HOUR; hour < END_HOUR; hour++) {
      const slot = document.createElement('div');
      slot.className = 'time-slot';
      slot.dataset.hour = hour;
      slot.addEventListener('click', () => {
        if (!currentUser) {
          showToast('로그인이 필요합니다.');
          return;
        }
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
  document.querySelectorAll('.google-allday').forEach(el => el.remove());

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(currentWeekStart);
    date.setDate(date.getDate() + i);
    weekDates.push(formatDateKey(date));
  }

  // Google Calendar 종일 일정
  // 배지를 헤더에 바로 넣으면 그 요일 헤더만 높아져서 칸이 밀린다.
  // 7일 모두에 같은 높이의 슬롯을 만들고 그 안에 넣어 높이를 일치시킨다.
  const alldayByDay = Array.from({length: 7}, () => []);
  googleEvents.filter(e => e.allDay).forEach(event => {
    const dayIndex = weekDates.indexOf(event.date);
    if (dayIndex !== -1) alldayByDay[dayIndex].push(event);
  });
  const maxAllDay = Math.max(0, ...alldayByDay.map(a => a.length));

  dayHeaders.forEach((header, i) => {
    if (!header) return;
    let slot = header.querySelector('.allday-slot');
    if (!slot) {
      slot = document.createElement('div');
      slot.className = 'allday-slot';
      header.appendChild(slot);
    }
    slot.innerHTML = '';
    slot.style.height = maxAllDay ? (maxAllDay * ALLDAY_ROW_H) + 'px' : '0px';

    alldayByDay[i].forEach(event => {
      const badge = document.createElement('div');
      badge.className = 'google-allday';
      badge.textContent = event.title;
      badge.title = event.title;
      if (event.colorId && GCAL_TO_COLOR[event.colorId]) {
        badge.style.backgroundColor = GCAL_TO_COLOR[event.colorId];
      }
      slot.appendChild(badge);
    });
  });

  // Google Calendar 시간 일정의 키 세트 (중복 제거용)
  const googleEventKeys = new Set();
  googleEvents.filter(e => !e.allDay).forEach(event => {
    googleEventKeys.add(`${event.date}|${event.startTime}|${event.endTime}|${event.title}`);
  });

  // 모든 시간 일정을 요일별로 수집
  const eventsPerDay = Array.from({length: 7}, () => []);

  schedules.forEach(schedule => {
    const dayIndex = weekDates.indexOf(schedule.dateKey);
    if (dayIndex === -1) return;
    // Google Calendar에 같은 일정이 있으면 Supabase 일정은 스킵
    const key = `${schedule.dateKey}|${schedule.startTime}|${schedule.endTime}|${schedule.title}`;
    if (googleEventKeys.has(key)) return;
    const [sh, sm] = schedule.startTime.split(':').map(Number);
    const [eh, em] = schedule.endTime.split(':').map(Number);
    const top = (sh - START_HOUR) * HOUR_HEIGHT + (sm / 60) * HOUR_HEIGHT;
    const bottom = (eh - START_HOUR) * HOUR_HEIGHT + (em / 60) * HOUR_HEIGHT;
    eventsPerDay[dayIndex].push({
      type: 'supabase', data: schedule, dayIndex,
      top, bottom: Math.max(bottom, top + 24)
    });
  });

  googleEvents.filter(e => !e.allDay).forEach(event => {
    const dayIndex = weekDates.indexOf(event.date);
    if (dayIndex === -1) return;
    const [sh, sm] = event.startTime.split(':').map(Number);
    const [eh, em] = event.endTime.split(':').map(Number);
    const top = (sh - START_HOUR) * HOUR_HEIGHT + (sm / 60) * HOUR_HEIGHT;
    const bottom = (eh - START_HOUR) * HOUR_HEIGHT + (em / 60) * HOUR_HEIGHT;
    eventsPerDay[dayIndex].push({
      type: 'google', data: event, dayIndex,
      top, bottom: Math.max(bottom, top + 24)
    });
  });

  // 요일별 겹침 계산 후 렌더링
  eventsPerDay.forEach((dayEvents, dayIndex) => {
    if (dayEvents.length === 0) return;

    const column = dayColumns[dayIndex];
    if (!column) return;
    const slotsContainer = column.querySelector('.day-slots');

    // 시간순 정렬
    dayEvents.sort((a, b) => a.top - b.top || a.bottom - b.bottom);

    // 겹치는 일정 클러스터 그룹화
    const clusters = [];
    let cluster = [dayEvents[0]];
    for (let i = 1; i < dayEvents.length; i++) {
      const clusterEnd = Math.max(...cluster.map(e => e.bottom));
      if (dayEvents[i].top < clusterEnd) {
        cluster.push(dayEvents[i]);
      } else {
        clusters.push(cluster);
        cluster = [dayEvents[i]];
      }
    }
    clusters.push(cluster);

    // 각 클러스터 내 열 배정
    clusters.forEach(cl => {
      const cols = []; // cols[c] = 해당 열의 마지막 이벤트 bottom 값
      cl.forEach(ev => {
        let placed = false;
        for (let c = 0; c < cols.length; c++) {
          if (ev.top >= cols[c]) {
            cols[c] = ev.bottom;
            ev.col = c;
            placed = true;
            break;
          }
        }
        if (!placed) {
          ev.col = cols.length;
          cols.push(ev.bottom);
        }
      });
      const totalCols = cols.length;
      cl.forEach(ev => { ev.totalCols = totalCols; });
    });

    // 렌더링 (겹침 레이아웃 즉시 적용)
    dayEvents.forEach(ev => {
      let item;
      if (ev.type === 'supabase') {
        item = createScheduleElement(ev.data, ev.dayIndex);
      } else {
        item = createGoogleEventElement(ev.data);
      }

      // 겹치는 일정이면 나란히 배치
      if (ev.totalCols > 1) {
        const pct = 100 / ev.totalCols;
        item.style.left = (ev.col * pct) + '%';
        item.style.width = pct + '%';
      }

      slotsContainer.appendChild(item);
    });
  });
}

function createGoogleEventElement(event) {
  const [startHour, startMin] = event.startTime.split(':').map(Number);
  const [endHour, endMin] = event.endTime.split(':').map(Number);

  const startPos = (startHour - START_HOUR) * HOUR_HEIGHT + (startMin / 60) * HOUR_HEIGHT;
  const endPos = (endHour - START_HOUR) * HOUR_HEIGHT + (endMin / 60) * HOUR_HEIGHT;
  const height = Math.max(endPos - startPos, 24);

  const item = document.createElement('div');
  item.className = 'schedule-item google-event';
  item.style.top = `${startPos}px`;
  item.style.height = `${height}px`;
  if (event.id) item.dataset.googleId = event.id;

  // Google Calendar 색상 적용
  const eventColor = event.colorId ? (GCAL_TO_COLOR[event.colorId] || '#039BE5') : '#039BE5';
  item.style.backgroundColor = eventColor;
  item.style.borderLeftColor = eventColor;

  // dayIndex 찾기
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    weekDates.push(formatDateKey(d));
  }
  const dayIndex = weekDates.indexOf(event.date);
  item.dataset.dayIndex = dayIndex;

  item.innerHTML = `
    <div class="title">${escapeHtml(event.title)}</div>
    <div class="time">${event.startTime} - ${event.endTime}</div>
    <button class="delete-btn">&times;</button>
    <div class="resize-handle"></div>
  `;

  // 삭제
  item.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteGoogleEvent(event.id, event.title);
  });

  // 드래그 이동
  item.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('delete-btn') || e.target.classList.contains('resize-handle')) return;
    startDrag(e, event.id, 'move', item, dayIndex, true);
  });

  // 리사이즈
  item.querySelector('.resize-handle').addEventListener('mousedown', (e) => {
    e.stopPropagation();
    startDrag(e, event.id, 'resize', item, dayIndex, true);
  });

  // 더블클릭 수정
  item.addEventListener('dblclick', () => {
    openModalForGoogle(event);
  });

  return item;
}

async function createGoogleEvent(title, dateKey, startTime, endTime, color) {
  if (!googleScriptUrl) return;
  try {
    const colorId = COLOR_TO_GCAL[color] || '7';
    const params = new URLSearchParams({
      action: 'create',
      title,
      date: dateKey,
      startTime,
      endTime,
      colorId
    });
    await fetch(`${googleScriptUrl}?${params}`);
    await loadGoogleCalendarEvents();
  } catch (e) {
    console.error('Google event create error:', e);
  }
}

async function updateGoogleEvent(eventId, dateKey, startTime, endTime, title, colorId) {
  if (!googleScriptUrl || !eventId) return;
  try {
    const params = new URLSearchParams({
      action: 'update',
      id: eventId,
      date: dateKey,
      startTime,
      endTime
    });
    if (title) params.set('title', title);
    if (colorId) params.set('colorId', colorId);
    await fetch(`${googleScriptUrl}?${params}`);
    await loadGoogleCalendarEvents();
  } catch (e) {
    console.error('Google event update error:', e);
    showToast('수정 실패');
  }
}

async function deleteGoogleEvent(eventId, title) {
  if (!eventId) {
    showToast('이 일정은 삭제할 수 없습니다.');
    return;
  }
  const confirmed = await showConfirm(`"${title}" 일정을 Google Calendar에서 삭제하시겠습니까?`);
  if (!confirmed) return;

  try {
    const params = new URLSearchParams({ action: 'delete', id: eventId });
    await fetch(`${googleScriptUrl}?${params}`);
    showToast('삭제되었습니다.');
    await loadGoogleCalendarEvents();
  } catch (e) {
    console.error('Google event delete error:', e);
    showToast('삭제 실패');
  }
}

function createScheduleElement(schedule, dayIndex) {
  const [startHour, startMin] = schedule.startTime.split(':').map(Number);
  const [endHour, endMin] = schedule.endTime.split(':').map(Number);

  const startPos = (startHour - START_HOUR) * HOUR_HEIGHT + (startMin / 60) * HOUR_HEIGHT;
  const endPos = (endHour - START_HOUR) * HOUR_HEIGHT + (endMin / 60) * HOUR_HEIGHT;
  const height = Math.max(endPos - startPos, 24);

  const item = document.createElement('div');
  item.className = 'schedule-item';
  item.style.top = `${startPos}px`;
  item.style.height = `${height}px`;
  item.style.backgroundColor = schedule.color || '#4A90D9';
  item.dataset.id = schedule.id;
  item.dataset.dayIndex = dayIndex;

  item.innerHTML = `
    <div class="title">${escapeHtml(schedule.title)}</div>
    <div class="time">${schedule.startTime} - ${schedule.endTime}</div>
    <button class="delete-btn">&times;</button>
    <div class="resize-handle"></div>
  `;

  // 삭제 버튼
  item.querySelector('.delete-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteSchedule(schedule.id);
  });

  // 드래그 이동
  item.addEventListener('mousedown', (e) => {
    if (e.target.classList.contains('delete-btn') || e.target.classList.contains('resize-handle')) return;
    startDrag(e, schedule.id, 'move', item, dayIndex);
  });

  // 리사이즈
  item.querySelector('.resize-handle').addEventListener('mousedown', (e) => {
    e.stopPropagation();
    startDrag(e, schedule.id, 'resize', item, dayIndex);
  });

  // 더블클릭 수정
  item.addEventListener('dblclick', () => {
    openModal(schedule);
  });

  return item;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ==================== 드래그 ====================
function startDrag(e, scheduleId, type, element, dayIndex, isGoogle = false) {
  e.preventDefault();

  dragState = {
    active: true,
    type,
    scheduleId,
    isGoogle,
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

  const { element, scheduleId, originalTop, originalHeight, originalDayIndex } = dragState;
  element.classList.remove('dragging');
  document.body.style.cursor = '';

  const top = parseInt(element.style.top);
  const height = parseInt(element.style.height);
  const snappedTop = Math.round(top / 15) * 15;
  const snappedHeight = Math.max(Math.round(height / 15) * 15, 15);
  const currentDayIndex = parseInt(element.dataset.dayIndex);

  // 실제로 이동/리사이즈가 없으면 스킵 (더블클릭 등)
  const moved = snappedTop !== originalTop || snappedHeight !== originalHeight || currentDayIndex !== originalDayIndex;

  element.style.top = `${snappedTop}px`;
  element.style.height = `${snappedHeight}px`;

  if (moved) {
    const newDate = new Date(currentWeekStart);
    newDate.setDate(newDate.getDate() + currentDayIndex);
    const newDateKey = formatDateKey(newDate);
    const newStartTime = posToTime(snappedTop);
    const newEndTime = posToTime(snappedTop + snappedHeight);

    if (dragState.isGoogle) {
      await updateGoogleEvent(scheduleId, newDateKey, newStartTime, newEndTime);
    } else {
      const schedule = schedules.find(s => s.id === scheduleId);
      if (schedule) {
        schedule.dateKey = newDateKey;
        schedule.startTime = newStartTime;
        schedule.endTime = newEndTime;
        await updateSchedule(scheduleId, schedule);
      }
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
  if (!currentUser) {
    showToast('로그인이 필요합니다.');
    return;
  }

  modal.classList.add('active');
  const deleteBtn = document.getElementById('modalDeleteBtn');

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

    deleteBtn.style.display = 'block';
  } else {
    document.getElementById('modalTitle').textContent = '일정 추가';
    form.reset();
    document.getElementById('editId').value = '';
    document.getElementById('dayOfWeek').value = defaultDayIndex;
    document.getElementById('startTime').value = defaultTime;

    const [h, m] = defaultTime.split(':').map(Number);
    const endHour = Math.min(h + 1, END_HOUR);
    document.getElementById('endTime').value = `${endHour.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;

    deleteBtn.style.display = 'none';
  }
}

function openModalForGoogle(event) {
  editingGoogleEvent = event;
  modal.classList.add('active');

  document.getElementById('modalTitle').textContent = '일정 수정';
  document.getElementById('editId').value = '';
  document.getElementById('title').value = event.title;
  document.getElementById('startTime').value = event.startTime;
  document.getElementById('endTime').value = event.endTime;

  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(currentWeekStart);
    d.setDate(d.getDate() + i);
    weekDates.push(formatDateKey(d));
  }
  const dayIndex = weekDates.indexOf(event.date);
  document.getElementById('dayOfWeek').value = dayIndex >= 0 ? dayIndex : 0;

  const colorHex = event.colorId ? (GCAL_TO_COLOR[event.colorId] || '#039BE5') : '#039BE5';
  const colorRadio = document.querySelector(`input[name="color"][value="${colorHex}"]`);
  if (colorRadio) colorRadio.checked = true;

  document.getElementById('modalDeleteBtn').style.display = 'block';
}

async function deleteFromModal() {
  if (editingGoogleEvent) {
    closeModal();
    await deleteGoogleEvent(editingGoogleEvent.id, editingGoogleEvent.title);
  } else {
    const editId = document.getElementById('editId').value;
    if (editId) {
      closeModal();
      await deleteSchedule(editId);
    }
  }
}

function closeModal() {
  modal.classList.remove('active');
  editingGoogleEvent = null;
  document.getElementById('modalDeleteBtn').style.display = 'none';
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
    showToast('종료 시간은 시작 시간보다 늦어야 합니다.');
    return;
  }

  const date = new Date(currentWeekStart);
  date.setDate(date.getDate() + dayIndex);
  const dateKey = formatDateKey(date);

  const saveBtn = form.querySelector('.btn-save');
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';

  if (editingGoogleEvent) {
    // Google Calendar 일정 수정
    const colorId = COLOR_TO_GCAL[color] || '7';
    await updateGoogleEvent(editingGoogleEvent.id, dateKey, startTime, endTime, title, colorId);
    editingGoogleEvent = null;
  } else if (editId) {
    const schedule = schedules.find(s => s.id === editId);
    if (schedule) {
      schedule.title = title;
      schedule.dateKey = dateKey;
      schedule.startTime = startTime;
      schedule.endTime = endTime;
      schedule.color = color;

      await updateSchedule(editId, schedule);
    }
  } else {
    const newSchedule = {
      title,
      dateKey,
      startTime,
      endTime,
      color
    };

    const saved = await saveSchedule(newSchedule);
    if (saved) {
      schedules.push({
        id: saved.id,
        ...newSchedule
      });
    }
    await createGoogleEvent(title, dateKey, startTime, endTime, color);
  }

  saveBtn.disabled = false;
  saveBtn.textContent = '저장';

  renderSchedules();
  closeModal();
});

async function deleteSchedule(id) {
  const confirmed = await showConfirm('이 일정을 삭제하시겠습니까?');
  if (!confirmed) return;

  const success = await deleteScheduleFromDB(id);
  if (success) {
    schedules = schedules.filter(s => s.id !== id);
    renderSchedules();
  }
}

// ==================== 모달 이벤트 ====================
modal.addEventListener('click', (e) => {
  if (e.target === modal) closeModal();
});

document.getElementById('authModal').addEventListener('click', (e) => {
  if (e.target.id === 'authModal') closeAuthModal();
});

document.getElementById('confirmModal').addEventListener('click', (e) => {
  if (e.target.id === 'confirmModal') resolveConfirm(false);
});

document.getElementById('settingsModal').addEventListener('click', (e) => {
  if (e.target.id === 'settingsModal') closeSettingsModal();
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (modal.classList.contains('active')) closeModal();
    if (document.getElementById('authModal').classList.contains('active')) closeAuthModal();
    if (document.getElementById('confirmModal').classList.contains('active')) resolveConfirm(false);
    if (document.getElementById('settingsModal').classList.contains('active')) closeSettingsModal();
  }
});

// OTP 입력에서 Enter 키 처리
document.getElementById('otpCode').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') verifyOTP();
});

document.getElementById('authEmail').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendOTP();
});

// HTML onclick에서 접근할 수 있도록 전역에 노출
window.handleAuth = handleAuth;
window.changeWeek = changeWeek;
window.openModal = openModal;
window.closeModal = closeModal;
window.closeAuthModal = closeAuthModal;
window.sendOTP = sendOTP;
window.verifyOTP = verifyOTP;
window.resolveConfirm = resolveConfirm;
window.deleteFromModal = deleteFromModal;
window.openSettingsModal = openSettingsModal;
window.closeSettingsModal = closeSettingsModal;
window.saveSettings = saveSettings;

// ==================== 시작 ====================
init();
})();
