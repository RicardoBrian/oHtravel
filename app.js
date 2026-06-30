// ============================================================
//  OHtravel — app.js
//  Features: Multi-trip · Transport · Weather · Budget · Packing · Expenses · Memo
//  Firebase v10 ESM CDN + localStorage offline cache
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc,
  addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ── Firebase 설정 ──
const firebaseConfig = {
  apiKey:            'AIzaSyADKY7IG3yG84qZ01H2T3S3xbzsd4XGqe4',
  authDomain:        'ohtravel-3540c.firebaseapp.com',
  projectId:         'ohtravel-3540c',
  storageBucket:     'ohtravel-3540c.firebasestorage.app',
  messagingSenderId: '796455069317',
  appId:             '1:796455069317:web:3c2c830ca85d3e26316bec',
};
const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ══════════════════════════════════════
//  상수 & 상태
// ══════════════════════════════════════
const TRANS_ICONS  = { flight:'✈️', train:'🚆', ship:'⛴️', bus:'🚌' };
const TRANS_LABELS = { flight:'비행기', train:'기차', ship:'배', bus:'버스' };
const EXP_LABELS   = { food:'🍜 식비', transport:'🚌 교통', lodging:'🏨 숙박', sightseeing:'🎡 관광', shopping:'🛍️ 쇼핑', etc:'📦 기타' };

const PACKING_TEMPLATES = {
  basic: ['여권','지갑 / 카드','핸드폰 충전기','이어폰','상비약','세면도구','선크림'],
  long:  ['여권','지갑 / 카드','핸드폰 충전기','이어폰','상비약','세면도구','선크림','노트북','어댑터','여분 의류','세탁 세제','비상금 (USD/EUR)','보조배터리'],
  biz:   ['여권','지갑 / 카드','명함','정장 / 비즈니스 캐주얼','노트북','충전기 세트','어댑터','보조배터리','상비약'],
};

const WC_EMOJI = {
  0:'☀️',1:'🌤️',2:'⛅',3:'☁️',
  45:'🌫️',48:'🌫️',
  51:'🌦️',53:'🌦️',55:'🌧️',
  61:'🌧️',63:'🌧️',65:'🌧️',
  71:'🌨️',73:'🌨️',75:'❄️',77:'❄️',
  80:'🌦️',81:'🌧️',82:'⛈️',
  85:'🌨️',86:'❄️',
  95:'⛈️',96:'⛈️',99:'⛈️',
};

const LS_TRIPS       = 'ohtravel_trips';
const LS_DAYS        = (id) => `ohtravel_days_${id}`;
const LS_TRANS       = (id) => `ohtravel_trans_${id}`;
const LS_WEATHER     = (id) => `ohtravel_weather_${id}`;

let currentTripId  = null;
let isReadOnly     = false;
let isOnline       = navigator.onLine;
let unsubTrips     = null;
let unsubDays      = null;
let unsubTrans     = null;
let editingDayId   = null;
let editingTransId = null;
let editingExpenses= [];
let currentTripRef = null; // { id, startDate, endDate, budget, packing, ... }

// ══════════════════════════════════════
//  유틸
// ══════════════════════════════════════
const $ = (id) => document.getElementById(id);

function showToast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric', weekday:'short' });
}

function fmtDateShort(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('ko-KR', { month:'numeric', day:'numeric', weekday:'short' });
}

function fmtMoney(n) { return Number(n).toLocaleString('ko-KR') + '원'; }

function isToday(dateStr) { return dateStr === new Date().toISOString().slice(0,10); }

function calcDDay(startStr, endStr) {
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(startStr + 'T00:00:00');
  const end   = new Date(endStr   + 'T00:00:00');
  if (today < start) return { label: `D-${Math.ceil((start-today)/86400000)}`, type: 'upcoming' };
  if (today <= end)  return { label: `진행 중 ${Math.ceil((today-start)/86400000)+1}/${Math.ceil((end-start)/86400000)+1}일`, type: 'ongoing' };
  return { label: '종료', type: 'past' };
}

function generateDays(startStr, endStr) {
  const days = [];
  let cur = new Date(startStr + 'T00:00:00');
  const end = new Date(endStr + 'T00:00:00');
  let i = 1;
  while (cur <= end) { days.push({ date: cur.toISOString().slice(0,10), dayIndex: i++ }); cur.setDate(cur.getDate()+1); }
  return days;
}

function genId() { return Math.random().toString(36).slice(2,10); }

// ══════════════════════════════════════
//  다크 모드 & 온라인 감지
// ══════════════════════════════════════
function initDarkToggle() {
  const navEnd = $('nav-end');
  navEnd.innerHTML = '';
  const t = document.createElement('div');
  t.className = 'dark-toggle'; t.title = '다크모드';
  t.onclick = () => {
    document.body.classList.toggle('dark');
    localStorage.setItem('ohtravel_dark', document.body.classList.contains('dark') ? '1' : '0');
  };
  navEnd.appendChild(t);
  if (localStorage.getItem('ohtravel_dark') === '1') document.body.classList.add('dark');
}

window.addEventListener('online',  () => { isOnline = true;  $('offline-banner').style.display = 'none'; });
window.addEventListener('offline', () => { isOnline = false; $('offline-banner').style.display = 'block'; });

// ══════════════════════════════════════
//  라우팅
// ══════════════════════════════════════
function parseURL() {
  const p = new URLSearchParams(location.search);
  return { tripId: p.get('tripId'), view: p.get('view') };
}

function navigate(tripId, shareMode = false) {
  history.pushState({}, '', tripId ? `?tripId=${tripId}${shareMode ? '&view=share' : ''}` : '?');
  boot();
}

window.addEventListener('popstate', boot);

function boot() {
  const { tripId, view } = parseURL();
  isReadOnly = view === 'share';
  if (tripId) { currentTripId = tripId; showTimelineView(tripId); }
  else        { currentTripId = null; isReadOnly = false; showDashboardView(); }
}

// ══════════════════════════════════════
//  대시보드
// ══════════════════════════════════════
function showDashboardView() {
  $('view-dashboard').style.display = '';
  $('view-timeline').style.display  = 'none';
  initDarkToggle();
  if (unsubDays)  { unsubDays();  unsubDays  = null; }
  if (unsubTrans) { unsubTrans(); unsubTrans = null; }
  if (!isOnline) { $('offline-banner').style.display = 'block'; renderTripListFromCache(); }
  else           { $('offline-banner').style.display = 'none';  listenTrips(); }
}

function listenTrips() {
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }
  $('trip-list').innerHTML = [1,2].map(() => `<div class="skeleton" style="height:120px;"></div>`).join('');
  unsubTrips = onSnapshot(collection(db,'trips'), (snap) => {
    const trips = [];
    snap.forEach(d => trips.push({ id: d.id, ...d.data() }));
    trips.sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
    localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
    renderTripList(trips);
  }, () => renderTripListFromCache());
}

function renderTripListFromCache() {
  const raw = localStorage.getItem(LS_TRIPS);
  renderTripList(raw ? JSON.parse(raw) : []);
}

function renderTripList(trips) {
  const list  = $('trip-list');
  const empty = $('trip-list-empty');
  list.innerHTML = '';
  if (!trips?.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  trips.forEach(trip => {
    const dd = calcDDay(trip.startDate, trip.endDate);
    const budgetBadge = trip.budget
      ? `<span class="badge neutral">예산 ${fmtMoney(trip.budget)}</span>`
      : '';

    const card = document.createElement('div');
    card.className = 'trip-card';
    card.innerHTML = `
      <div class="trip-card-header">
        <div class="trip-card-title">${escHtml(trip.title||'제목 없음')}</div>
        <div class="trip-card-dday ${dd.type}">${dd.label}</div>
      </div>
      <div class="trip-card-date">${fmtDate(trip.startDate)} ~ ${fmtDate(trip.endDate)}</div>
      ${budgetBadge ? `<div>${budgetBadge}</div>` : ''}
      <div class="trip-card-actions">
        <button class="btn sm icon-btn btn-share-card" data-id="${trip.id}">🔗 공유</button>
        <button class="btn sm danger btn-del-trip" data-id="${trip.id}">삭제</button>
      </div>`;

    card.addEventListener('click', (e) => {
      if (e.target.closest('.btn-share-card,.btn-del-trip')) return;
      navigate(trip.id);
    });
    card.querySelector('.btn-share-card').addEventListener('click', (e) => {
      e.stopPropagation();
      const url = `${location.origin}${location.pathname}?tripId=${trip.id}&view=share`;
      navigator.clipboard.writeText(url).then(() => showToast('공유 링크 복사됨'));
    });
    card.querySelector('.btn-del-trip').addEventListener('click', async (e) => {
      e.stopPropagation();
      if (!confirm(`"${trip.title}" 여행을 삭제할까요?`)) return;
      try { await deleteDoc(doc(db,'trips',trip.id)); showToast('삭제되었습니다'); }
      catch(err) { showToast('삭제 실패: ' + (err?.message||err)); }
    });
    list.appendChild(card);
  });
}

// ── 새 여행 등록 ──
function openNewTripModal() {
  $('inp-trip-title').value = $('inp-trip-start').value = $('inp-trip-end').value = '';
  $('modal-new-trip').classList.add('open');
  setTimeout(() => $('inp-trip-title').focus(), 100);
}

async function saveNewTrip() {
  const title = $('inp-trip-title').value.trim();
  const start = $('inp-trip-start').value;
  const end   = $('inp-trip-end').value;
  if (!title)        { showToast('여행 제목을 입력하세요'); return; }
  if (!start || !end){ showToast('날짜를 입력하세요'); return; }
  if (start > end)   { showToast('종료일이 시작일보다 빠릅니다'); return; }
  try {
    const ref = await addDoc(collection(db,'trips'), { title, startDate:start, endDate:end, createdAt:serverTimestamp() });
    $('modal-new-trip').classList.remove('open');
    showToast('여행이 등록되었습니다 🎉');
    navigate(ref.id);
  } catch(err) { showToast(`등록 실패: ${err?.message||err}`); }
}

// ══════════════════════════════════════
//  타임라인 뷰
// ══════════════════════════════════════
async function showTimelineView(tripId) {
  $('view-dashboard').style.display = 'none';
  $('view-timeline').style.display  = '';
  initDarkToggle();
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }
  document.querySelectorAll('.readonly-banner').forEach(el => el.remove());

  // 여행 데이터 로드
  let trip = null;
  if (isOnline) {
    try {
      const snap = await getDoc(doc(db,'trips',tripId));
      if (snap.exists()) { trip = { id:snap.id, ...snap.data() }; }
    } catch { /* fallthrough */ }
  }
  if (!trip) {
    const raw = localStorage.getItem(LS_TRIPS);
    trip = raw ? JSON.parse(raw).find(t => t.id === tripId) : null;
  }
  if (!trip) { $('trip-title-display').textContent = '여행을 찾을 수 없습니다'; return; }

  currentTripRef = trip;
  $('trip-title-display').textContent = trip.title || '제목 없음';
  $('trip-date-range').textContent = `${fmtDate(trip.startDate)} ~ ${fmtDate(trip.endDate)}`;

  // 헤더 액션
  const actions = $('timeline-header-actions');
  if (isReadOnly) {
    $('btn-back').style.display = 'none';
    actions.innerHTML = `<div class="readonly-banner" style="margin:0;">🔒 읽기 전용 공유 모드</div>`;
  } else {
    $('btn-back').style.display = '';
    actions.innerHTML = `
      <button class="btn sm" id="btn-add-transport">✈️ 교통 등록</button>
      <button class="btn sm" id="btn-packing">🎒 준비물</button>
      <button class="btn sm" id="btn-budget-open">💰 예산 설정</button>
      <button class="btn sm" id="btn-copy-share">🔗 공유</button>`;

    $('btn-add-transport').onclick = () => openTransportModal(null, tripId);
    $('btn-packing').onclick       = () => openPackingModal(tripId);
    $('btn-budget-open').onclick   = () => openBudgetModal(tripId);
    $('btn-copy-share').onclick    = () => {
      const url = `${location.origin}${location.pathname}?tripId=${tripId}&view=share`;
      navigator.clipboard.writeText(url).then(() => showToast('공유 링크 복사됨'));
    };
  }

  const days = generateDays(trip.startDate, trip.endDate);

  if (!isOnline) {
    const dayData   = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
    renderTimeline(days, dayData, transData, weather, tripId);
    updateBudgetBar(trip, dayData);
  } else {
    listenTimeline(tripId, days, trip);
  }
}

function listenTimeline(tripId, days, trip) {
  if (unsubDays)  { unsubDays();  unsubDays  = null; }
  if (unsubTrans) { unsubTrans(); unsubTrans = null; }

  $('timeline-list').innerHTML = days.slice(0,3).map(() =>
    `<div class="skeleton" style="height:130px;margin-bottom:16px;"></div>`).join('');

  let dayData = {}, transData = [];
  const weather = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');

  function redraw() {
    renderTimeline(days, dayData, transData, weather, tripId);
    updateBudgetBar(trip, dayData);
  }

  unsubDays = onSnapshot(collection(db,'trips',tripId,'days'), (snap) => {
    dayData = {};
    snap.forEach(d => { dayData[d.id] = d.data(); });
    localStorage.setItem(LS_DAYS(tripId), JSON.stringify(dayData));
    redraw();
    fetchWeatherForTrip(trip, dayData, tripId).then(w => {
      Object.assign(weather, w);
      localStorage.setItem(LS_WEATHER(tripId), JSON.stringify(weather));
      redraw();
    });
  }, () => {
    dayData = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
    redraw();
  });

  unsubTrans = onSnapshot(collection(db,'trips',tripId,'transports'), (snap) => {
    transData = [];
    snap.forEach(d => transData.push({ id:d.id, ...d.data() }));
    localStorage.setItem(LS_TRANS(tripId), JSON.stringify(transData));
    redraw();
  }, () => {
    transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
    redraw();
  });
}

// ── 예산 바 업데이트 ──
function updateBudgetBar(trip, dayData) {
  const budget = trip?.budget || 0;
  const spent  = Object.values(dayData).reduce((sum, d) => {
    return sum + (d.expenses||[]).reduce((s, e) => s + (Number(e.amount)||0), 0);
  }, 0);

  if (!budget) { $('budget-bar-wrap').style.display = 'none'; return; }
  $('budget-bar-wrap').style.display = '';
  const pct = Math.min(Math.round((spent/budget)*100), 100);
  $('budget-label-spent').textContent = `지출 ${fmtMoney(spent)}`;
  $('budget-label-total').textContent = `예산 ${fmtMoney(budget)}`;
  const fill = $('budget-bar-fill');
  fill.style.width = pct + '%';
  fill.classList.toggle('over', spent > budget);
}

// ══════════════════════════════════════
//  타임라인 렌더
// ══════════════════════════════════════
function renderTimeline(days, dayData, transData, weather, tripId) {
  const container = $('timeline-list');
  container.innerHTML = '';

  days.forEach(({ date, dayIndex }) => {
    const data    = dayData[date] || {};
    const dayTrans = transData.filter(t => t.departDate <= date && t.arriveDate >= date);
    const w       = weather[data.city]?.[date];
    const card    = buildDayCard(date, dayIndex, data, dayTrans, w, tripId);
    container.appendChild(card);
  });

  const todayCard = container.querySelector('.today');
  if (todayCard) setTimeout(() => todayCard.scrollIntoView({ behavior:'smooth', block:'start' }), 300);
}

function buildDayCard(date, dayIndex, data, dayTrans, weather, tripId) {
  const card = document.createElement('div');
  card.className = `day-card${isToday(date) ? ' today' : ''}`;

  // ── 헤더 ──
  const cityTag    = data.city ? `<span class="city-tag">📍 ${escHtml(data.city)}</span>` : '';
  const weatherBadge = weather
    ? `<span class="weather-badge">${WC_EMOJI[weather.code]||'🌡️'} ${weather.max}° / ${weather.min}°</span>`
    : '';
  const editBtn = isReadOnly ? '' : `<button class="btn sm icon-btn day-edit-btn" onclick="openEditModal('${date}','${tripId}')">편집</button>`;

  // ── 교통 섹션 ──
  const transHtml = dayTrans.length
    ? dayTrans.map(t => {
        const icon = TRANS_ICONS[t.type] || '🚗';
        const lbl  = TRANS_LABELS[t.type] || t.type;
        const isDepart = t.departDate === date;
        const isArrive = t.arriveDate === date;
        const transitBadge = (!isDepart && !isArrive) ? '<span class="transit-day-badge">이동 중</span>' : '';
        const timeStr = [
          isDepart && t.departTime ? `출발 ${t.departTime}` : '',
          isArrive && t.arriveTime ? `도착 ${t.arriveTime}` : '',
        ].filter(Boolean).join(' / ');

        const bookingStr = t.bookingNo ? `<div class="transport-booking">📋 ${escHtml(t.bookingNo)}</div>` : '';
        const memoStr    = t.memo      ? `<div class="transport-booking" style="color:var(--text-2)">${escHtml(t.memo)}</div>` : '';
        const editTransBtn = isReadOnly ? '' : `<button class="btn sm icon-btn transport-copy-btn" onclick="openTransportModal('${t.id}','${tripId}')">편집</button>`;
        const delTransBtn  = isReadOnly ? '' : `<button class="btn sm danger" style="position:absolute;top:8px;right:60px;font-size:.72rem;padding:3px 8px;" onclick="deleteTransport('${t.id}','${tripId}')">삭제</button>`;
        const copyBtn = `<button class="btn sm icon-btn" style="margin-top:4px;font-size:.72rem;" onclick="copyTransport(this,'${escHtml(t.fromCity)}','${escHtml(t.toCity)}','${escHtml(t.bookingNo||'')}')">복사</button>`;

        return `
          <div class="transport-item">
            <div class="transport-route">
              <span class="transport-type-icon">${icon}</span>
              <span>${lbl}</span>
              <strong>${escHtml(t.fromCity||'?')}</strong>
              <span class="arrow">→</span>
              <strong>${escHtml(t.toCity||'?')}</strong>
              ${transitBadge}
            </div>
            ${timeStr ? `<div class="transport-meta">${timeStr}</div>` : ''}
            ${bookingStr}${memoStr}
            ${copyBtn}
            ${editTransBtn}${delTransBtn}
          </div>`;
      }).join('')
    : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">등록된 교통 없음</div>`;

  // ── 숙소 ──
  let accomHtml = `<div class="t-cap" style="color:var(--text-3);font-style:italic;">미정</div>`;
  if (data.accommodation) {
    const mapBtn = data.accommodationMap
      ? ` <a href="${escHtml(data.accommodationMap)}" target="_blank" rel="noopener" class="accom-link">🗺 지도</a>`
      : '';
    accomHtml = `<div class="accom-row">${escHtml(data.accommodation)}${mapBtn}</div>`;
  }

  // ── 지출 ──
  const expenses = data.expenses || [];
  const expTotal = expenses.reduce((s,e) => s + (Number(e.amount)||0), 0);
  const expHtml = expenses.length
    ? `<div class="expense-list">${expenses.map(e =>
        `<div class="expense-row">
          <span class="expense-cat">${EXP_LABELS[e.category]||e.category}</span>
          <span class="expense-name">${escHtml(e.name)}</span>
          <span class="expense-amount">${fmtMoney(e.amount)}</span>
        </div>`
      ).join('')}</div><div class="expense-total">합계 ${fmtMoney(expTotal)}</div>`
    : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">지출 없음</div>`;

  // ── 메모 ──
  const memoHtml = data.memo
    ? `<div class="memo-box">${escHtml(data.memo)}</div>`
    : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">메모 없음</div>`;

  // ── To-Do ──
  const todos = data.todos || [];
  const todoItems = todos.map((todo, i) => `
    <li class="todo-item ${todo.done ? 'done' : ''}" id="td-${date}-${i}">
      <input type="checkbox" ${todo.done?'checked':''} ${isReadOnly?'disabled':''}
        onchange="toggleTodo('${tripId}','${date}',${i},this.checked)" />
      <label>${escHtml(todo.text)}</label>
    </li>`).join('');
  const addTodoRow = isReadOnly ? '' : `
    <div class="todo-add-row">
      <input class="todo-add-inp" id="ti-${date}" placeholder="할 일 추가..."
        onkeydown="if(event.key==='Enter')addTodo('${tripId}','${date}')" />
      <button class="btn sm icon-btn" onclick="addTodo('${tripId}','${date}')">+</button>
    </div>`;

  card.innerHTML = `
    <div class="day-card-header">
      <div class="day-label-group">
        <span class="day-label">Day ${dayIndex}</span>
        <span class="day-label-date">${fmtDateShort(date)}</span>
        ${cityTag}${weatherBadge}
      </div>
      ${editBtn}
    </div>

    <div class="day-section">
      <div class="day-section-label">✈️ 교통</div>
      ${transHtml}
    </div>

    <div class="day-section">
      <div class="day-section-label">🏨 숙소</div>
      ${accomHtml}
    </div>

    <div class="day-section">
      <div class="day-section-label">💰 지출</div>
      ${expHtml}
    </div>

    <div class="day-section">
      <div class="day-section-label">📝 메모</div>
      ${memoHtml}
    </div>

    <div class="day-section">
      <div class="day-section-label">✅ To-Do</div>
      <ul class="todo-list">${todoItems}</ul>
      ${addTodoRow}
    </div>`;

  return card;
}

// ══════════════════════════════════════
//  날씨 (Open-Meteo)
// ══════════════════════════════════════
async function fetchWeatherForTrip(trip, dayData, tripId) {
  const citySet = new Set(Object.values(dayData).map(d => d.city).filter(Boolean));
  const result  = {};

  await Promise.all([...citySet].map(async (city) => {
    try {
      // Geocoding
      const geoRes  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko`);
      const geoJson = await geoRes.json();
      if (!geoJson.results?.length) return;
      const { latitude: lat, longitude: lon } = geoJson.results[0];

      const today    = new Date().toISOString().slice(0,10);
      const maxDate  = new Date(Date.now() + 15*86400000).toISOString().slice(0,10);

      // forecast (오늘 ~ 16일)
      const forecastStart = trip.startDate > today ? trip.startDate : today;
      const forecastEnd   = trip.endDate   < maxDate ? trip.endDate : maxDate;

      if (forecastStart <= forecastEnd) {
        const fRes  = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${forecastStart}&end_date=${forecastEnd}`);
        const fJson = await fRes.json();
        if (!result[city]) result[city] = {};
        fJson.daily?.time?.forEach((d, i) => {
          result[city][d] = {
            code: fJson.daily.weathercode[i],
            max:  Math.round(fJson.daily.temperature_2m_max[i]),
            min:  Math.round(fJson.daily.temperature_2m_min[i]),
          };
        });
      }

      // archive (과거 날짜)
      const archiveEnd = trip.endDate < today ? trip.endDate : new Date(Date.now()-86400000).toISOString().slice(0,10);
      if (trip.startDate <= archiveEnd) {
        const aRes  = await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${trip.startDate}&end_date=${archiveEnd}`);
        const aJson = await aRes.json();
        if (!result[city]) result[city] = {};
        aJson.daily?.time?.forEach((d, i) => {
          result[city][d] = {
            code: aJson.daily.weathercode[i],
            max:  Math.round(aJson.daily.temperature_2m_max[i]),
            min:  Math.round(aJson.daily.temperature_2m_min[i]),
          };
        });
      }
    } catch { /* 날씨 실패는 무시 */ }
  }));

  return result;
}

// ══════════════════════════════════════
//  교통 모달
// ══════════════════════════════════════
window.openTransportModal = function(transId, tripId) {
  editingTransId = transId;
  $('modal-transport-title').textContent = transId ? '교통 편집' : '교통 등록';

  if (transId) {
    const list = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
    const t = list.find(x => x.id === transId) || {};
    $('inp-trans-type').value        = t.type        || 'flight';
    $('inp-trans-from-city').value   = t.fromCity    || '';
    $('inp-trans-to-city').value     = t.toCity      || '';
    $('inp-trans-depart-date').value = t.departDate  || '';
    $('inp-trans-depart-time').value = t.departTime  || '';
    $('inp-trans-arrive-date').value = t.arriveDate  || '';
    $('inp-trans-arrive-time').value = t.arriveTime  || '';
    $('inp-trans-booking').value     = t.bookingNo   || '';
    $('inp-trans-memo').value        = t.memo        || '';
  } else {
    ['inp-trans-type','inp-trans-from-city','inp-trans-to-city',
     'inp-trans-depart-date','inp-trans-depart-time',
     'inp-trans-arrive-date','inp-trans-arrive-time',
     'inp-trans-booking','inp-trans-memo'].forEach(id => { const el = $(id); if (el) el.value = el.tagName==='SELECT'?el.options[0].value:''; });

    // 출발일 기본값: 현재 여행 시작일
    if (currentTripRef) {
      $('inp-trans-depart-date').value = currentTripRef.startDate;
      $('inp-trans-arrive-date').value = currentTripRef.startDate;
    }
  }

  $('btn-save-transport').onclick = () => saveTransport(tripId);
  $('modal-transport').classList.add('open');
};

window.closeTransportModal = function() {
  $('modal-transport').classList.remove('open');
  editingTransId = null;
};

async function saveTransport(tripId) {
  const payload = {
    type:       $('inp-trans-type').value,
    fromCity:   $('inp-trans-from-city').value.trim(),
    toCity:     $('inp-trans-to-city').value.trim(),
    departDate: $('inp-trans-depart-date').value,
    departTime: $('inp-trans-depart-time').value,
    arriveDate: $('inp-trans-arrive-date').value,
    arriveTime: $('inp-trans-arrive-time').value,
    bookingNo:  $('inp-trans-booking').value.trim(),
    memo:       $('inp-trans-memo').value.trim(),
  };

  if (!payload.departDate || !payload.arriveDate) { showToast('날짜를 입력하세요'); return; }
  if (payload.departDate > payload.arriveDate)    { showToast('도착일이 출발일보다 빠릅니다'); return; }

  closeTransportModal();

  // 캐시 업데이트
  const list = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
  if (editingTransId) {
    const idx = list.findIndex(t => t.id === editingTransId);
    if (idx >= 0) list[idx] = { ...list[idx], ...payload };
  } else {
    list.push({ id: genId(), ...payload });
  }
  localStorage.setItem(LS_TRANS(tripId), JSON.stringify(list));

  try {
    if (editingTransId) {
      await updateDoc(doc(db,'trips',tripId,'transports',editingTransId), payload);
    } else {
      await addDoc(collection(db,'trips',tripId,'transports'), payload);
    }
    showToast('교통 저장됨 ✓');
  } catch(err) { showToast('오프라인 — 로컬 저장됨'); }
}

window.deleteTransport = async function(transId, tripId) {
  if (!confirm('이 교통 정보를 삭제할까요?')) return;
  const list = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]').filter(t => t.id !== transId);
  localStorage.setItem(LS_TRANS(tripId), JSON.stringify(list));
  try { await deleteDoc(doc(db,'trips',tripId,'transports',transId)); showToast('삭제됨'); }
  catch { showToast('오프라인 — 로컬 삭제됨'); }
};

window.copyTransport = function(btn, from, to, booking) {
  const text = [from && `출발: ${from}`, to && `도착: ${to}`, booking && `예약: ${booking}`].filter(Boolean).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    btn.textContent = '✓ 복사됨';
    setTimeout(() => btn.textContent = '복사', 1800);
  });
};

// ══════════════════════════════════════
//  예산 모달
// ══════════════════════════════════════
function openBudgetModal(tripId) {
  $('inp-budget').value = currentTripRef?.budget || '';
  $('modal-budget').classList.add('open');
  $('btn-save-budget').onclick = () => saveBudget(tripId);
}

async function saveBudget(tripId) {
  const budget = Number($('inp-budget').value);
  if (!budget || budget < 0) { showToast('올바른 금액을 입력하세요'); return; }
  $('modal-budget').classList.remove('open');
  currentTripRef = { ...currentTripRef, budget };

  // 캐시 업데이트
  const raw = localStorage.getItem(LS_TRIPS);
  if (raw) {
    const trips = JSON.parse(raw).map(t => t.id === tripId ? { ...t, budget } : t);
    localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
  }

  try {
    await updateDoc(doc(db,'trips',tripId), { budget });
    showToast(`예산 ${fmtMoney(budget)} 저장됨 ✓`);
  } catch { showToast('오프라인 — 로컬 저장됨'); }

  const dayData = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
  updateBudgetBar(currentTripRef, dayData);
}

// ══════════════════════════════════════
//  준비물 모달
// ══════════════════════════════════════
function openPackingModal(tripId) {
  $('modal-packing').classList.add('open');
  renderPackingList(tripId);
}

function getPackingList(tripId) {
  if (currentTripRef?.packing) return currentTripRef.packing;
  return [];
}

function renderPackingList(tripId) {
  const items = getPackingList(tripId);
  const done  = items.filter(i => i.done).length;
  const ul    = $('packing-list');
  ul.innerHTML = items.map((item, idx) => `
    <li class="todo-item ${item.done?'done':''}" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <input type="checkbox" ${item.done?'checked':''} onchange="togglePacking('${tripId}',${idx},this.checked)" />
        <label>${escHtml(item.text)}</label>
      </div>
      <button class="btn sm danger" style="padding:3px 8px;font-size:.72rem;" onclick="deletePacking('${tripId}',${idx})">×</button>
    </li>`).join('');
  $('packing-progress').textContent = `${done} / ${items.length} 완료`;
}

window.addPackingItem = function() {
  const inp = $('inp-packing-item');
  const text = inp.value.trim();
  if (!text) return;
  const tripId = currentTripId;
  if (!currentTripRef.packing) currentTripRef.packing = [];
  currentTripRef.packing.push({ text, done: false });
  inp.value = '';
  savePackingToFirestore(tripId);
  renderPackingList(tripId);
};

window.togglePacking = function(tripId, idx, done) {
  if (!currentTripRef.packing) return;
  currentTripRef.packing[idx].done = done;
  savePackingToFirestore(tripId);
  renderPackingList(tripId);
};

window.deletePacking = function(tripId, idx) {
  if (!currentTripRef.packing) return;
  currentTripRef.packing.splice(idx, 1);
  savePackingToFirestore(tripId);
  renderPackingList(tripId);
};

function applyPackingTemplate(key, tripId) {
  const tpl = PACKING_TEMPLATES[key] || [];
  if (!currentTripRef.packing) currentTripRef.packing = [];
  const existing = new Set(currentTripRef.packing.map(i => i.text));
  tpl.filter(t => !existing.has(t)).forEach(t => currentTripRef.packing.push({ text: t, done: false }));
  savePackingToFirestore(tripId);
  renderPackingList(tripId);
  showToast('템플릿 적용됨');
}

async function savePackingToFirestore(tripId) {
  const packing = currentTripRef.packing || [];
  const raw = localStorage.getItem(LS_TRIPS);
  if (raw) {
    const trips = JSON.parse(raw).map(t => t.id === tripId ? { ...t, packing } : t);
    localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
  }
  try { await updateDoc(doc(db,'trips',tripId), { packing }); }
  catch { /* offline */ }
}

// ══════════════════════════════════════
//  날짜 카드 편집 모달
// ══════════════════════════════════════
window.openEditModal = function(date, tripId) {
  editingDayId = date;
  const data = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}')?.[date] || {};

  $('modal-day-title').textContent = `${fmtDateShort(date)} 편집`;
  $('inp-city').value      = data.city          || '';
  $('inp-accom-name').value= data.accommodation || '';
  $('inp-accom-map').value = data.accommodationMap || '';
  $('inp-memo').value      = data.memo          || '';
  $('inp-todos').value     = (data.todos||[]).map(t => t.text).join('\n');

  editingExpenses = JSON.parse(JSON.stringify(data.expenses || []));
  renderEditExpenses();

  $('btn-save-day').onclick = () => saveDayEdit(tripId, date);
  $('modal-edit-day').classList.add('open');
};

window.closeEditModal = function() {
  $('modal-edit-day').classList.remove('open');
  editingDayId = null;
};

function renderEditExpenses() {
  const list = $('expense-list-edit');
  list.innerHTML = editingExpenses.map((e, i) => `
    <div class="expense-item-edit">
      <span class="exp-cat">${EXP_LABELS[e.category]||e.category}</span>
      <span class="exp-name">${escHtml(e.name)}</span>
      <span class="exp-amt">${fmtMoney(e.amount)}</span>
      <button class="btn sm danger" style="padding:3px 8px;font-size:.72rem;margin-left:auto;" onclick="removeEditExpense(${i})">×</button>
    </div>`).join('') || `<div class="t-cap" style="margin-bottom:6px;">없음</div>`;
}

window.removeEditExpense = function(idx) {
  editingExpenses.splice(idx, 1);
  renderEditExpenses();
};

function addEditExpense() {
  const cat    = $('inp-exp-cat').value;
  const name   = $('inp-exp-name').value.trim();
  const amount = Number($('inp-exp-amount').value);
  if (!name || !amount) { showToast('항목명과 금액을 입력하세요'); return; }
  editingExpenses.push({ id: genId(), category: cat, name, amount });
  $('inp-exp-name').value = ''; $('inp-exp-amount').value = '';
  renderEditExpenses();
}

async function saveDayEdit(tripId, date) {
  const prevData = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}')?.[date] || {};
  const todosRaw = $('inp-todos').value.trim();
  const todos    = todosRaw
    ? todosRaw.split('\n').filter(l => l.trim()).map(text => {
        const prev = (prevData.todos||[]).find(t => t.text === text.trim());
        return { text: text.trim(), done: prev?.done || false };
      })
    : [];

  const payload = {
    city:             $('inp-city').value.trim(),
    accommodation:    $('inp-accom-name').value.trim(),
    accommodationMap: $('inp-accom-map').value.trim(),
    memo:             $('inp-memo').value.trim(),
    todos,
    expenses:         editingExpenses,
  };

  closeEditModal();

  // 로컬 즉시 반영
  const cacheKey = LS_DAYS(tripId);
  const dayData  = JSON.parse(localStorage.getItem(cacheKey) || '{}');
  dayData[date]  = payload;
  localStorage.setItem(cacheKey, JSON.stringify(dayData));

  try {
    const dayRef = doc(db,'trips',tripId,'days',date);
    try { await updateDoc(dayRef, payload); }
    catch { await setDoc(dayRef, payload); }
    showToast('저장됨 ✓');
  } catch { showToast('오프라인 — 로컬 저장됨'); }

  // 날씨 재조회 (도시 변경 시)
  if (currentTripRef) {
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
    fetchWeatherForTrip(currentTripRef, dayData, tripId).then(w => {
      Object.assign(weather, w);
      localStorage.setItem(LS_WEATHER(tripId), JSON.stringify(weather));
      renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
      updateBudgetBar(currentTripRef, dayData);
    });
    renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
    updateBudgetBar(currentTripRef, dayData);
  }
}

// ══════════════════════════════════════
//  To-Do 인라인
// ══════════════════════════════════════
window.toggleTodo = async function(tripId, date, idx, done) {
  const cacheKey = LS_DAYS(tripId);
  const dayData  = JSON.parse(localStorage.getItem(cacheKey) || '{}');
  if (!dayData[date]?.todos) return;
  dayData[date].todos[idx].done = done;
  localStorage.setItem(cacheKey, JSON.stringify(dayData));
  const el = $(`td-${date}-${idx}`);
  if (el) el.classList.toggle('done', done);
  try { await updateDoc(doc(db,'trips',tripId,'days',date), { todos: dayData[date].todos }); }
  catch { /* offline */ }
};

window.addTodo = async function(tripId, date) {
  const inp  = $(`ti-${date}`);
  const text = inp?.value.trim();
  if (!text) return;

  const cacheKey = LS_DAYS(tripId);
  const dayData  = JSON.parse(localStorage.getItem(cacheKey) || '{}');
  if (!dayData[date]) dayData[date] = {};
  if (!dayData[date].todos) dayData[date].todos = [];
  dayData[date].todos.push({ text, done: false });
  localStorage.setItem(cacheKey, JSON.stringify(dayData));
  inp.value = '';

  try {
    const dayRef = doc(db,'trips',tripId,'days',date);
    try { await updateDoc(dayRef, { todos: dayData[date].todos }); }
    catch { await setDoc(dayRef, dayData[date]); }
  } catch { /* offline */ }

  if (currentTripRef) {
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
    renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
  }
};

// ══════════════════════════════════════
//  이벤트 바인딩
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  if (!isOnline) $('offline-banner').style.display = 'block';

  // 새 여행
  $('btn-new-trip').addEventListener('click', openNewTripModal);
  $('btn-cancel-new-trip').addEventListener('click', () => $('modal-new-trip').classList.remove('open'));
  $('btn-save-new-trip').addEventListener('click', saveNewTrip);
  $('inp-trip-title').addEventListener('keydown', e => { if (e.key==='Enter') saveNewTrip(); });

  // 뒤로가기
  $('btn-back').addEventListener('click', () => {
    if (unsubDays)  { unsubDays();  unsubDays  = null; }
    if (unsubTrans) { unsubTrans(); unsubTrans = null; }
    currentTripRef = null;
    navigate(null);
  });

  // 지출 추가 버튼
  $('btn-add-expense').addEventListener('click', addEditExpense);
  $('inp-exp-amount').addEventListener('keydown', e => { if (e.key==='Enter') addEditExpense(); });

  // 준비물 템플릿
  $('tpl-basic').addEventListener('click', () => applyPackingTemplate('basic', currentTripId));
  $('tpl-long').addEventListener('click',  () => applyPackingTemplate('long',  currentTripId));
  $('tpl-biz').addEventListener('click',   () => applyPackingTemplate('biz',   currentTripId));

  // 완료 항목 삭제
  $('btn-clear-packing').addEventListener('click', () => {
    if (!currentTripRef?.packing) return;
    currentTripRef.packing = currentTripRef.packing.filter(i => !i.done);
    savePackingToFirestore(currentTripId);
    renderPackingList(currentTripId);
  });

  // 라우팅
  boot();
});
