// ============================================================
//  oHtravel — app.js
//  Multi-trip planner dashboard
//  Firebase v10 (CDN ESM) + localStorage offline cache
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc,
  addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, getDoc
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Firebase 설정 (Vercel 환경 변수 동적 주입 또는 window.__ENV__) ──
function getFirebaseConfig() {
  // Vercel: next.config / vercel.json 의 env 를 index.html 에서
  //  <script>window.__ENV__={...}</script> 형태로 주입하거나,
  //  아래 직접 설정값을 채워 사용합니다.
  const env = (typeof window !== 'undefined' && window.__ENV__) || {};
  return {
    apiKey:            env.FIREBASE_API_KEY            || 'YOUR_API_KEY',
    authDomain:        env.FIREBASE_AUTH_DOMAIN        || 'YOUR_PROJECT.firebaseapp.com',
    projectId:         env.FIREBASE_PROJECT_ID         || 'YOUR_PROJECT_ID',
    storageBucket:     env.FIREBASE_STORAGE_BUCKET     || 'YOUR_PROJECT.appspot.com',
    messagingSenderId: env.FIREBASE_MESSAGING_SENDER_ID|| 'YOUR_SENDER_ID',
    appId:             env.FIREBASE_APP_ID             || 'YOUR_APP_ID',
  };
}

// ── 앱 초기화 ──
const firebaseApp = initializeApp(getFirebaseConfig());
const db = getFirestore(firebaseApp);

// ── 상태 ──
let currentTripId  = null;   // 타임라인 뷰에서 보고 있는 여행 ID
let isReadOnly     = false;   // 공유 모드
let isOnline       = navigator.onLine;
let unsubTrips     = null;   // trips onSnapshot 해제용
let unsubDays      = null;   // days onSnapshot 해제용
let editingDayId   = null;   // 편집 중인 날짜 카드 ID

// localStorage 키
const LS_TRIPS = 'ohtravel_trips';
const LS_DAYS  = (tripId) => `ohtravel_days_${tripId}`;

// ── 유틸 ──
function $(id) { return document.getElementById(id); }

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2400);
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function calcDDay(startStr, endStr) {
  const today = new Date();
  today.setHours(0,0,0,0);
  const start = new Date(startStr + 'T00:00:00');
  const end   = new Date(endStr   + 'T00:00:00');
  if (today < start) {
    const diff = Math.ceil((start - today) / 86400000);
    return { label: `D-${diff}`, type: 'upcoming' };
  } else if (today <= end) {
    const diff = Math.ceil((today - start) / 86400000) + 1;
    const total = Math.ceil((end - start) / 86400000) + 1;
    return { label: `진행 중 ${diff}/${total}일`, type: 'ongoing' };
  } else {
    return { label: '종료', type: 'past' };
  }
}

function generateDays(startStr, endStr) {
  const days = [];
  let cur = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  let idx = 1;
  while (cur <= end) {
    days.push({
      date: cur.toISOString().slice(0, 10),
      dayIndex: idx,
    });
    cur.setDate(cur.getDate() + 1);
    idx++;
  }
  return days;
}

function isToday(dateStr) {
  const today = new Date();
  return dateStr === today.toISOString().slice(0, 10);
}

// ── 온라인/오프라인 감지 ──
window.addEventListener('online',  () => { isOnline = true;  $('offline-banner').style.display = 'none'; });
window.addEventListener('offline', () => { isOnline = false; $('offline-banner').style.display = 'block'; });

// ── 다크 모드 토글 ──
function initDarkToggle() {
  const toggle = document.createElement('div');
  toggle.className = 'dark-toggle';
  toggle.title = '다크모드';
  toggle.onclick = () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('ohtravel_dark', document.body.classList.contains('dark') ? '1' : '0');
  };
  $('nav-end').appendChild(toggle);
  if (localStorage.getItem('ohtravel_dark') === '1') document.body.classList.add('dark');
}

// ══════════════════════════════════════
//  ROUTING
// ══════════════════════════════════════
function parseURL() {
  const params = new URLSearchParams(location.search);
  return {
    tripId: params.get('tripId'),
    view:   params.get('view'),
  };
}

function navigate(tripId, shareMode = false) {
  const url = tripId
    ? `?tripId=${tripId}${shareMode ? '&view=share' : ''}`
    : '?';
  history.pushState({}, '', url);
  boot();
}

window.addEventListener('popstate', boot);

function boot() {
  const { tripId, view } = parseURL();
  isReadOnly = view === 'share';

  if (tripId) {
    currentTripId = tripId;
    showTimelineView(tripId);
  } else {
    currentTripId = null;
    isReadOnly = false;
    showDashboardView();
  }
}

// ══════════════════════════════════════
//  대시보드 뷰
// ══════════════════════════════════════
function showDashboardView() {
  $('view-dashboard').style.display = '';
  $('view-timeline').style.display  = 'none';
  $('nav-end').innerHTML = '';
  initDarkToggle();

  // 대시보드 액션
  $('dashboard-actions').style.display = '';

  if (unsubDays) { unsubDays(); unsubDays = null; }

  if (!isOnline) {
    $('offline-banner').style.display = 'block';
    renderTripListFromCache();
  } else {
    $('offline-banner').style.display = 'none';
    listenTrips();
  }
}

function listenTrips() {
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }

  const tripsCol = collection(db, 'trips');
  const tripList = $('trip-list');
  tripList.innerHTML = '<div class="skeleton" style="height:120px;"></div><div class="skeleton" style="height:120px;margin-top:16px;"></div>';

  unsubTrips = onSnapshot(tripsCol, (snap) => {
    const trips = [];
    snap.forEach(d => trips.push({ id: d.id, ...d.data() }));
    trips.sort((a, b) => (a.startDate || '').localeCompare(b.startDate || ''));
    localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
    renderTripList(trips);
  }, () => {
    renderTripListFromCache();
  });
}

function renderTripListFromCache() {
  const raw = localStorage.getItem(LS_TRIPS);
  const trips = raw ? JSON.parse(raw) : [];
  renderTripList(trips);
}

function renderTripList(trips) {
  const tripList = $('trip-list');
  const emptyEl  = $('trip-list-empty');
  tripList.innerHTML = '';

  if (!trips || trips.length === 0) {
    emptyEl.style.display = '';
    return;
  }
  emptyEl.style.display = 'none';

  trips.forEach(trip => {
    const dd = calcDDay(trip.startDate, trip.endDate);
    const card = document.createElement('div');
    card.className = 'trip-card';
    card.dataset.tripId = trip.id;
    card.innerHTML = `
      <div class="trip-card-header">
        <div class="trip-card-title">${escHtml(trip.title || '제목 없음')}</div>
        <div class="trip-card-dday ${dd.type}">${dd.label}</div>
      </div>
      <div class="trip-card-date">
        ${formatDate(trip.startDate)} ~ ${formatDate(trip.endDate)}
      </div>
      <div class="trip-card-actions">
        <button class="btn sm icon-btn btn-share" data-id="${trip.id}" title="공유 링크 복사">🔗 공유</button>
        <button class="btn sm danger btn-delete-trip" data-id="${trip.id}" title="여행 삭제">삭제</button>
      </div>
    `;

    // 카드 클릭 → 타임라인
    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-share') || e.target.closest('.btn-delete-trip')) return;
      navigate(trip.id);
    });

    // 공유 링크 복사
    card.querySelector('.btn-share').addEventListener('click', (e) => {
      e.stopPropagation();
      const url = `${location.origin}${location.pathname}?tripId=${trip.id}&view=share`;
      navigator.clipboard.writeText(url).then(() => showToast('공유 링크가 복사되었습니다'));
    });

    // 삭제
    card.querySelector('.btn-delete-trip').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`"${trip.title}" 여행을 삭제할까요? 모든 일정 데이터가 삭제됩니다.`)) return;
      try {
        await deleteDoc(doc(db, 'trips', trip.id));
        showToast('여행이 삭제되었습니다');
      } catch {
        showToast('삭제 실패: 오프라인 상태입니다');
      }
    });

    tripList.appendChild(card);
  });
}

// ── 새 여행 등록 모달 ──
function openNewTripModal() {
  $('inp-trip-title').value = '';
  $('inp-trip-start').value = '';
  $('inp-trip-end').value   = '';
  $('modal-new-trip').classList.add('open');
  $('inp-trip-title').focus();
}

async function saveNewTrip() {
  const title = $('inp-trip-title').value.trim();
  const start = $('inp-trip-start').value;
  const end   = $('inp-trip-end').value;

  if (!title) { showToast('여행 제목을 입력하세요'); return; }
  if (!start || !end) { showToast('시작일과 종료일을 입력하세요'); return; }
  if (start > end) { showToast('종료일이 시작일보다 빠릅니다'); return; }

  try {
    const ref = await addDoc(collection(db, 'trips'), {
      title,
      startDate: start,
      endDate:   end,
      createdAt: serverTimestamp(),
    });
    $('modal-new-trip').classList.remove('open');
    showToast('여행이 등록되었습니다 🎉');
    navigate(ref.id);
  } catch {
    showToast('등록 실패: 오프라인 상태입니다');
  }
}

// ══════════════════════════════════════
//  타임라인 뷰
// ══════════════════════════════════════
async function showTimelineView(tripId) {
  $('view-dashboard').style.display = 'none';
  $('view-timeline').style.display  = '';
  $('nav-end').innerHTML = '';
  initDarkToggle();

  if (unsubTrips) { unsubTrips(); unsubTrips = null; }

  // 공유 모드 배너
  const timelineList = $('timeline-list');
  timelineList.innerHTML = '';

  if (isReadOnly) {
    const banner = document.createElement('div');
    banner.className = 'readonly-banner';
    banner.innerHTML = '🔒 읽기 전용 공유 모드 — 수정할 수 없습니다.';
    timelineList.before(banner);
    $('btn-back').style.display = 'none';
    $('timeline-header-actions').innerHTML = '';
  } else {
    document.querySelectorAll('.readonly-banner').forEach(el => el.remove());
    $('btn-back').style.display = '';
    $('timeline-header-actions').innerHTML = `
      <button class="btn sm" id="btn-copy-share">🔗 공유 링크 복사</button>
    `;
    $('btn-copy-share').addEventListener('click', () => {
      const url = `${location.origin}${location.pathname}?tripId=${tripId}&view=share`;
      navigator.clipboard.writeText(url).then(() => showToast('공유 링크가 복사되었습니다'));
    });
  }

  // 여행 정보 로드
  let trip = null;
  if (isOnline) {
    try {
      const snap = await getDoc(doc(db, 'trips', tripId));
      if (snap.exists()) {
        trip = { id: snap.id, ...snap.data() };
      }
    } catch { /* fallback to cache */ }
  }
  if (!trip) {
    const cached = localStorage.getItem(LS_TRIPS);
    if (cached) {
      trip = JSON.parse(cached).find(t => t.id === tripId);
    }
  }

  if (!trip) {
    $('trip-title-display').textContent = '여행을 찾을 수 없습니다';
    $('trip-date-range').textContent = '';
    return;
  }

  $('trip-title-display').textContent = trip.title || '제목 없음';
  $('trip-date-range').textContent = `${formatDate(trip.startDate)} ~ ${formatDate(trip.endDate)}`;

  // 날짜 목록 생성
  const days = generateDays(trip.startDate, trip.endDate);

  if (!isOnline) {
    const cached = localStorage.getItem(LS_DAYS(tripId));
    const dayData = cached ? JSON.parse(cached) : {};
    renderTimeline(days, dayData, tripId);
  } else {
    listenDays(tripId, days);
  }
}

function listenDays(tripId, days) {
  if (unsubDays) { unsubDays(); unsubDays = null; }

  const daysCol = collection(db, 'trips', tripId, 'days');
  $('timeline-list').innerHTML = days.map(() =>
    '<div class="skeleton" style="height:120px;margin-bottom:16px;"></div>'
  ).join('');

  unsubDays = onSnapshot(daysCol, (snap) => {
    const dayData = {};
    snap.forEach(d => { dayData[d.id] = d.data(); });
    localStorage.setItem(LS_DAYS(tripId), JSON.stringify(dayData));
    renderTimeline(days, dayData, tripId);
  }, () => {
    const cached = localStorage.getItem(LS_DAYS(tripId));
    renderTimeline(days, cached ? JSON.parse(cached) : {}, tripId);
  });
}

function renderTimeline(days, dayData, tripId) {
  const container = $('timeline-list');
  container.innerHTML = '';

  days.forEach(({ date, dayIndex }) => {
    const data = dayData[date] || {};
    const todayClass = isToday(date) ? 'today' : '';
    const card = document.createElement('div');
    card.className = `day-card ${todayClass}`;
    card.id = `day-${date}`;

    const editBtn = isReadOnly ? '' : `<button class="btn sm icon-btn day-edit-btn" onclick="openEditModal('${date}','${tripId}')">편집</button>`;

    // 교통
    const transportHtml = data.transport
      ? `<div class="transport-box">${escHtml(data.transport)}<button class="btn sm icon-btn copy-btn" onclick="copyText(this,'${date}')">복사</button></div>`
      : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">내용 없음</div>`;

    // 숙소
    let accomHtml = `<div class="t-cap" style="color:var(--text-3);font-style:italic;">내용 없음</div>`;
    if (data.accommodation) {
      const mapBtn = data.accommodationMap
        ? `<a href="${escHtml(data.accommodationMap)}" target="_blank" rel="noopener" class="accom-link">🗺 지도 보기</a>`
        : '';
      accomHtml = `<div class="accom-row">${escHtml(data.accommodation)} ${mapBtn}</div>`;
    }

    // To-Do
    const todos = data.todos || [];
    const todoItemsHtml = todos.map((todo, i) => `
      <li class="todo-item ${todo.done ? 'done' : ''}" id="todo-${date}-${i}">
        <input type="checkbox" ${todo.done ? 'checked' : ''} ${isReadOnly ? 'disabled' : ''}
          onchange="toggleTodo('${tripId}','${date}',${i},this.checked)" />
        <label>${escHtml(todo.text)}</label>
      </li>
    `).join('');

    const addTodoRow = isReadOnly ? '' : `
      <div class="todo-add-row">
        <input class="todo-add-inp" id="todo-inp-${date}" placeholder="할 일 추가..."
          onkeydown="if(event.key==='Enter')addTodo('${tripId}','${date}')" />
        <button class="btn sm icon-btn" onclick="addTodo('${tripId}','${date}')">+</button>
      </div>
    `;

    card.innerHTML = `
      <div class="day-card-header">
        <div class="day-label">
          Day ${dayIndex}
          <span>${formatDate(date)}</span>
        </div>
        ${editBtn}
      </div>

      <div class="day-section">
        <div class="day-section-label">✈️ 교통</div>
        ${transportHtml}
      </div>

      <div class="day-section">
        <div class="day-section-label">🏨 숙소</div>
        ${accomHtml}
      </div>

      <div class="day-section">
        <div class="day-section-label">✅ To-Do</div>
        <ul class="todo-list">${todoItemsHtml}</ul>
        ${addTodoRow}
      </div>
    `;

    container.appendChild(card);
  });

  // 오늘 날짜로 스크롤
  const todayCard = container.querySelector('.today');
  if (todayCard) setTimeout(() => todayCard.scrollIntoView({ behavior: 'smooth', block: 'start' }), 300);
}

// ══════════════════════════════════════
//  편집 모달
// ══════════════════════════════════════
window.openEditModal = function(date, tripId) {
  editingDayId = date;
  const cached = localStorage.getItem(LS_DAYS(tripId));
  const dayData = cached ? JSON.parse(cached) : {};
  const data = dayData[date] || {};

  $('modal-day-title').textContent = `${formatDate(date)} 편집`;
  $('inp-transport').value   = data.transport || '';
  $('inp-accom-name').value  = data.accommodation || '';
  $('inp-accom-map').value   = data.accommodationMap || '';
  $('inp-todos').value       = (data.todos || []).map(t => t.text).join('\n');
  $('modal-edit-day').classList.add('open');

  $('btn-save-day').onclick = () => saveDayEdit(tripId, date);
};

window.closeEditModal = function() {
  $('modal-edit-day').classList.remove('open');
  editingDayId = null;
};

async function saveDayEdit(tripId, date) {
  const transport       = $('inp-transport').value.trim();
  const accommodation   = $('inp-accom-name').value.trim();
  const accommodationMap= $('inp-accom-map').value.trim();
  const todosRaw        = $('inp-todos').value.trim();
  const todos = todosRaw
    ? todosRaw.split('\n').filter(l => l.trim()).map(text => {
        const cached = localStorage.getItem(LS_DAYS(tripId));
        const existing = cached ? JSON.parse(cached) : {};
        const prev = (existing[date]?.todos || []).find(t => t.text === text.trim());
        return { text: text.trim(), done: prev?.done || false };
      })
    : [];

  const payload = { transport, accommodation, accommodationMap, todos };

  // 로컬 캐시 즉시 갱신
  const cacheKey = LS_DAYS(tripId);
  const cached = localStorage.getItem(cacheKey);
  const dayData = cached ? JSON.parse(cached) : {};
  dayData[date] = payload;
  localStorage.setItem(cacheKey, JSON.stringify(dayData));

  closeEditModal();

  try {
    const dayRef = doc(db, 'trips', tripId, 'days', date);
    await updateDoc(dayRef, payload).catch(async () => {
      const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      await setDoc(dayRef, payload);
    });
    showToast('저장되었습니다 ✓');
  } catch {
    showToast('오프라인 — 로컬에 저장되었습니다');
  }

  // 타임라인 재렌더
  const trips = JSON.parse(localStorage.getItem(LS_TRIPS) || '[]');
  const trip = trips.find(t => t.id === tripId);
  if (trip) renderTimeline(generateDays(trip.startDate, trip.endDate), dayData, tripId);
}

// ══════════════════════════════════════
//  To-Do 인라인 관리
// ══════════════════════════════════════
window.toggleTodo = async function(tripId, date, index, done) {
  const cacheKey = LS_DAYS(tripId);
  const cached = localStorage.getItem(cacheKey);
  const dayData = cached ? JSON.parse(cached) : {};
  if (!dayData[date]?.todos) return;
  dayData[date].todos[index].done = done;
  localStorage.setItem(cacheKey, JSON.stringify(dayData));

  const item = document.getElementById(`todo-${date}-${index}`);
  if (item) item.classList.toggle('done', done);

  try {
    await updateDoc(doc(db, 'trips', tripId, 'days', date), { todos: dayData[date].todos });
  } catch { /* offline – cached only */ }
};

window.addTodo = async function(tripId, date) {
  const inp = $(`todo-inp-${date}`);
  if (!inp) return;
  const text = inp.value.trim();
  if (!text) return;

  const cacheKey = LS_DAYS(tripId);
  const cached = localStorage.getItem(cacheKey);
  const dayData = cached ? JSON.parse(cached) : {};
  if (!dayData[date]) dayData[date] = {};
  if (!dayData[date].todos) dayData[date].todos = [];
  dayData[date].todos.push({ text, done: false });
  localStorage.setItem(cacheKey, JSON.stringify(dayData));

  inp.value = '';

  try {
    await updateDoc(doc(db, 'trips', tripId, 'days', date), { todos: dayData[date].todos })
      .catch(async () => {
        const { setDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
        await setDoc(doc(db, 'trips', tripId, 'days', date), dayData[date]);
      });
  } catch { /* offline */ }

  // 해당 날짜 카드만 부분 업데이트
  const trips = JSON.parse(localStorage.getItem(LS_TRIPS) || '[]');
  const trip = trips.find(t => t.id === tripId);
  if (trip) renderTimeline(generateDays(trip.startDate, trip.endDate), dayData, tripId);
};

// ══════════════════════════════════════
//  교통 복사
// ══════════════════════════════════════
window.copyText = function(btn, date) {
  const box = btn.closest('.transport-box');
  const text = box.childNodes[0]?.textContent?.trim() || '';
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ 복사됨';
    setTimeout(() => btn.textContent = '복사', 1800);
  });
};

// ══════════════════════════════════════
//  XSS 방어
// ══════════════════════════════════════
function escHtml(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ══════════════════════════════════════
//  이벤트 바인딩
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  // 새 여행 등록
  $('btn-new-trip').addEventListener('click', openNewTripModal);
  $('btn-cancel-new-trip').addEventListener('click', () => $('modal-new-trip').classList.remove('open'));
  $('btn-save-new-trip').addEventListener('click', saveNewTrip);
  $('inp-trip-title').addEventListener('keydown', e => { if (e.key === 'Enter') saveNewTrip(); });

  // 뒤로 가기
  $('btn-back').addEventListener('click', () => {
    if (unsubDays) { unsubDays(); unsubDays = null; }
    navigate(null);
  });

  // 온라인/오프라인 초기 상태
  if (!isOnline) $('offline-banner').style.display = 'block';

  // 라우팅 실행
  boot();
});
