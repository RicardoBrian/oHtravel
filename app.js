// ============================================================
//  OHtravel — app.js
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getFirestore, collection, doc,
  addDoc, setDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, getDoc,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

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
//  상수
// ══════════════════════════════════════
const TRANS_ICONS  = { flight:'✈️', train:'🚆', ship:'⛴️', bus:'🚌' };
const TRANS_LABELS = { flight:'비행기', train:'기차', ship:'배', bus:'버스' };
const EXP_LABELS   = { food:'🍜 식비', transport:'🚌 교통', lodging:'🏨 숙박', sightseeing:'🎡 관광', shopping:'🛍️ 쇼핑', etc:'📦 기타' };
const EXP_KEYS     = ['food','transport','lodging','sightseeing','shopping','etc'];
const CURRENCIES   = { KRW:{s:'₩',n:'원'}, USD:{s:'$',n:'달러'}, JPY:{s:'¥',n:'엔'}, EUR:{s:'€',n:'유로'}, THB:{s:'฿',n:'바트'}, VND:{s:'₫',n:'동'}, SGD:{s:'S$',n:'싱가포르달러'}, GBP:{s:'£',n:'파운드'} };

const PACKING_TEMPLATES = {
  basic: ['여권','지갑 / 카드','핸드폰 충전기','이어폰','상비약','세면도구','선크림'],
  long:  ['여권','지갑 / 카드','핸드폰 충전기','이어폰','상비약','세면도구','선크림','노트북','어댑터','여분 의류','세탁 세제','비상금 (USD/EUR)','보조배터리'],
  biz:   ['여권','지갑 / 카드','명함','정장 / 비즈니스 캐주얼','노트북','충전기 세트','어댑터','보조배터리','상비약'],
};

const WC_EMOJI = {0:'☀️',1:'🌤️',2:'⛅',3:'☁️',45:'🌫️',48:'🌫️',51:'🌦️',53:'🌦️',55:'🌧️',61:'🌧️',63:'🌧️',65:'🌧️',71:'🌨️',73:'🌨️',75:'❄️',77:'❄️',80:'🌦️',81:'🌧️',82:'⛈️',85:'🌨️',86:'❄️',95:'⛈️',96:'⛈️',99:'⛈️'};

const LS_TRIPS   = 'ohtravel_trips';
const LS_DAYS    = id => `ohtravel_days_${id}`;
const LS_TRANS   = id => `ohtravel_trans_${id}`;
const LS_WEATHER = id => `ohtravel_weather_${id}`;
const LS_FX      = 'ohtravel_fx';

// ══════════════════════════════════════
//  상태
// ══════════════════════════════════════
let currentTripId  = null;
let isReadOnly     = false;
let isOnline       = navigator.onLine;
let unsubTrips     = null;
let unsubDays      = null;
let unsubTrans     = null;
let editingTransId = null;
let editingExpenses= [];
let currentTripRef = null;
let fxRates        = null; // USD 기준 환율

// ══════════════════════════════════════
//  유틸
// ══════════════════════════════════════
const $ = id => document.getElementById(id);

function showToast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('show'), 2600);
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function fmtDate(d) {
  if (!d) return '';
  return new Date(d+'T00:00:00').toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
}
function fmtDateShort(d) {
  if (!d) return '';
  return new Date(d+'T00:00:00').toLocaleDateString('ko-KR',{month:'numeric',day:'numeric',weekday:'short'});
}
function fmtMoney(n) { return Number(n).toLocaleString('ko-KR') + '원'; }
function isToday(d) { return d === new Date().toISOString().slice(0,10); }
function genId()    { return Math.random().toString(36).slice(2,10); }

function calcDDay(s, e) {
  const today = new Date(); today.setHours(0,0,0,0);
  const start = new Date(s+'T00:00:00'), end = new Date(e+'T00:00:00');
  if (today < start) return { label:`D-${Math.ceil((start-today)/86400000)}`, type:'upcoming' };
  if (today <= end)  return { label:`진행 중 ${Math.ceil((today-start)/86400000)+1}/${Math.ceil((end-start)/86400000)+1}일`, type:'ongoing' };
  return { label:'종료', type:'past' };
}

function generateDays(s, e) {
  const days = []; let cur = new Date(s+'T00:00:00'); const end = new Date(e+'T00:00:00'); let i = 1;
  while (cur <= end) { days.push({ date: cur.toISOString().slice(0,10), dayIndex: i++ }); cur.setDate(cur.getDate()+1); }
  return days;
}

// ── 환율 ──
async function loadFxRates() {
  const cached = localStorage.getItem(LS_FX);
  if (cached) { const p = JSON.parse(cached); if (p.expires > Date.now()) { fxRates = p.rates; return; } }
  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await res.json();
    fxRates = data.rates;
    localStorage.setItem(LS_FX, JSON.stringify({ rates: fxRates, expires: Date.now() + 86400000 }));
  } catch { /* 환율 없이 진행 */ }
}

function toKRW(amount, currency) {
  if (!currency || currency === 'KRW' || !fxRates) return Number(amount);
  const usd = Number(amount) / (fxRates[currency] || 1);
  return Math.round(usd * (fxRates['KRW'] || 1300));
}

function fmtExpenseAmount(amount, currency) {
  const c = CURRENCIES[currency] || CURRENCIES.KRW;
  if (!currency || currency === 'KRW') return fmtMoney(amount);
  const krw = toKRW(amount, currency);
  return `${c.s}${Number(amount).toLocaleString()} <span class="expense-krw">(≈${fmtMoney(krw)})</span>`;
}

// ══════════════════════════════════════
//  다크 모드 & 온라인
// ══════════════════════════════════════
function initDarkToggle() {
  const ne = $('nav-end'); ne.innerHTML = '';
  const t = document.createElement('div'); t.className = 'dark-toggle'; t.title = '다크모드';
  t.onclick = () => { document.body.classList.toggle('dark'); localStorage.setItem('ohtravel_dark', document.body.classList.contains('dark')?'1':'0'); };
  ne.appendChild(t);
  if (localStorage.getItem('ohtravel_dark') === '1') document.body.classList.add('dark');
}
window.addEventListener('online',  () => { isOnline = true;  $('offline-banner').style.display='none'; });
window.addEventListener('offline', () => { isOnline = false; $('offline-banner').style.display='block'; });

// ══════════════════════════════════════
//  라우팅
// ══════════════════════════════════════
function parseURL() { const p = new URLSearchParams(location.search); return { tripId: p.get('tripId'), view: p.get('view') }; }
function navigate(tripId, shareMode=false) {
  history.pushState({}, '', tripId ? `?tripId=${tripId}${shareMode?'&view=share':''}` : '?');
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
  $('view-dashboard').style.display = ''; $('view-timeline').style.display = 'none';
  initDarkToggle();
  if (unsubDays)  { unsubDays();  unsubDays  = null; }
  if (unsubTrans) { unsubTrans(); unsubTrans = null; }
  if (!isOnline) { $('offline-banner').style.display='block'; renderTripListFromCache(); }
  else           { $('offline-banner').style.display='none';  listenTrips(); }
}

function listenTrips() {
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }
  $('trip-list').innerHTML = [1,2].map(()=>`<div class="skeleton" style="height:120px;"></div>`).join('');
  unsubTrips = onSnapshot(collection(db,'trips'), snap => {
    const trips = []; snap.forEach(d => trips.push({id:d.id,...d.data()}));
    trips.sort((a,b) => (a.startDate||'').localeCompare(b.startDate||''));
    localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
    renderTripList(trips);
  }, () => renderTripListFromCache());
}

function renderTripListFromCache() { const r = localStorage.getItem(LS_TRIPS); renderTripList(r ? JSON.parse(r) : []); }

function renderTripList(trips) {
  const list = $('trip-list'), empty = $('trip-list-empty');
  list.innerHTML = '';
  if (!trips?.length) { empty.style.display = ''; return; }
  empty.style.display = 'none';
  trips.forEach(trip => {
    const dd = calcDDay(trip.startDate, trip.endDate);
    const budgetBadge = trip.budget ? `<span class="badge neutral">예산 ${fmtMoney(trip.budget)}</span>` : '';
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
        <button class="btn sm icon-btn btn-packing-card" data-id="${trip.id}">🎒 준비물</button>
        <button class="btn sm icon-btn btn-share-card" data-id="${trip.id}">🔗 공유</button>
        <button class="btn sm danger btn-del-trip" data-id="${trip.id}">삭제</button>
      </div>`;
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-packing-card,.btn-share-card,.btn-del-trip')) return;
      navigate(trip.id);
    });
    card.querySelector('.btn-packing-card').addEventListener('click', e => {
      e.stopPropagation();
      currentTripRef = trip; currentTripId = trip.id;
      openPackingModal(trip.id);
    });
    card.querySelector('.btn-share-card').addEventListener('click', e => {
      e.stopPropagation();
      const url = `${location.origin}${location.pathname}?tripId=${trip.id}&view=share`;
      navigator.clipboard.writeText(url).then(() => showToast('공유 링크 복사됨'));
    });
    card.querySelector('.btn-del-trip').addEventListener('click', async e => {
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
  const title = $('inp-trip-title').value.trim(), start = $('inp-trip-start').value, end = $('inp-trip-end').value;
  if (!title)       { showToast('여행 제목을 입력하세요'); return; }
  if (!start||!end) { showToast('날짜를 입력하세요'); return; }
  if (start > end)  { showToast('종료일이 시작일보다 빠릅니다'); return; }
  try {
    const ref = await addDoc(collection(db,'trips'), {title, startDate:start, endDate:end, createdAt:serverTimestamp()});
    $('modal-new-trip').classList.remove('open');
    showToast('여행이 등록되었습니다 🎉');
    navigate(ref.id);
  } catch(err) { showToast(`등록 실패: ${err?.message||err}`); }
}

// ── 여행 편집 ──
function openEditTripModal(tripId) {
  $('inp-edit-trip-title').value = currentTripRef?.title || '';
  $('inp-edit-trip-start').value = currentTripRef?.startDate || '';
  $('inp-edit-trip-end').value   = currentTripRef?.endDate   || '';
  $('btn-save-edit-trip').onclick = () => saveEditTrip(tripId);
  $('modal-edit-trip').classList.add('open');
}
async function saveEditTrip(tripId) {
  const title = $('inp-edit-trip-title').value.trim();
  const start = $('inp-edit-trip-start').value;
  const end   = $('inp-edit-trip-end').value;
  if (!title)       { showToast('제목을 입력하세요'); return; }
  if (!start||!end) { showToast('날짜를 입력하세요'); return; }
  if (start > end)  { showToast('종료일이 시작일보다 빠릅니다'); return; }
  $('modal-edit-trip').classList.remove('open');
  currentTripRef = { ...currentTripRef, title, startDate:start, endDate:end };
  $('trip-title-display').textContent = title;
  $('trip-date-range').textContent = `${fmtDate(start)} ~ ${fmtDate(end)}`;
  const raw = localStorage.getItem(LS_TRIPS);
  if (raw) { const trips = JSON.parse(raw).map(t => t.id===tripId ? {...t,title,startDate:start,endDate:end} : t); localStorage.setItem(LS_TRIPS, JSON.stringify(trips)); }
  try { await updateDoc(doc(db,'trips',tripId), {title, startDate:start, endDate:end}); showToast('여행 정보 저장됨 ✓'); }
  catch { showToast('오프라인 — 로컬 저장됨'); }
  // 날짜 변경 시 타임라인 재렌더
  const dayData   = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
  const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
  const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
  renderTimeline(generateDays(start, end), dayData, transData, weather, tripId);
  updateBudgetBar(currentTripRef, dayData);
}

// ══════════════════════════════════════
//  타임라인 뷰
// ══════════════════════════════════════
async function showTimelineView(tripId) {
  $('view-dashboard').style.display = 'none'; $('view-timeline').style.display = '';
  initDarkToggle();
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }

  // 여행 데이터 로드
  let trip = null;
  if (isOnline) { try { const s = await getDoc(doc(db,'trips',tripId)); if (s.exists()) trip = {id:s.id,...s.data()}; } catch {} }
  if (!trip)    { const r = localStorage.getItem(LS_TRIPS); trip = r ? JSON.parse(r).find(t=>t.id===tripId) : null; }
  if (!trip)    { $('trip-title-display').textContent = '여행을 찾을 수 없습니다'; return; }

  currentTripRef = trip;
  $('trip-title-display').textContent = trip.title || '제목 없음';
  $('trip-date-range').textContent = `${fmtDate(trip.startDate)} ~ ${fmtDate(trip.endDate)}`;

  const editTripBtn = $('btn-edit-trip');
  const actions     = $('timeline-header-actions');

  if (isReadOnly) {
    $('btn-back').style.display = 'none';
    editTripBtn.style.display   = 'none';
    actions.innerHTML = `<div class="readonly-banner">🔒 읽기 전용 공유 모드</div>`;
  } else {
    $('btn-back').style.display = '';
    editTripBtn.style.display   = '';
    editTripBtn.onclick = () => openEditTripModal(tripId);
    actions.innerHTML = `
      <button class="btn sm" id="btn-add-transport">✈️ 교통 등록</button>
      <button class="btn sm" id="btn-bulk-accom">🏨 숙소 일괄</button>
      <button class="btn sm" id="btn-packing">🎒 준비물</button>
      <button class="btn sm" id="btn-budget-open">💰 예산 설정</button>
      <button class="btn sm" id="btn-stats">📊 통계</button>
      <button class="btn sm" id="btn-copy-share">🔗 공유</button>`;
    $('btn-add-transport').onclick = () => openTransportModal(null, tripId);
    $('btn-bulk-accom').onclick    = () => openBulkAccomModal(tripId);
    $('btn-packing').onclick       = () => openPackingModal(tripId);
    $('btn-budget-open').onclick   = () => openBudgetModal(tripId);
    $('btn-stats').onclick         = () => openStatsModal(tripId);
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
  $('timeline-list').innerHTML = days.slice(0,3).map(()=>`<div class="skeleton" style="height:130px;margin-bottom:16px;"></div>`).join('');
  let dayData = {}, transData = [];
  const weather = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
  const redraw = () => { renderTimeline(days, dayData, transData, weather, tripId); updateBudgetBar(trip, dayData); };

  unsubDays = onSnapshot(collection(db,'trips',tripId,'days'), snap => {
    dayData = {}; snap.forEach(d => { dayData[d.id] = d.data(); });
    localStorage.setItem(LS_DAYS(tripId), JSON.stringify(dayData));
    redraw();
    fetchWeatherForTrip(trip, dayData, tripId).then(w => { Object.assign(weather, w); localStorage.setItem(LS_WEATHER(tripId), JSON.stringify(weather)); redraw(); });
  }, () => { dayData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}'); redraw(); });

  unsubTrans = onSnapshot(collection(db,'trips',tripId,'transports'), snap => {
    transData = []; snap.forEach(d => transData.push({id:d.id,...d.data()}));
    localStorage.setItem(LS_TRANS(tripId), JSON.stringify(transData));
    redraw();
  }, () => { transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]'); redraw(); });
}

// ── 예산 바 ──
function updateBudgetBar(trip, dayData) {
  const budget = trip?.budget || 0;
  const spent  = calcTotalSpentKRW(dayData);
  if (!budget) { $('budget-bar-wrap').style.display = 'none'; return; }
  $('budget-bar-wrap').style.display = '';
  const pct = Math.min(Math.round(spent/budget*100), 100);
  $('budget-label-spent').textContent = `지출 ${fmtMoney(spent)}`;
  $('budget-label-total').textContent = `예산 ${fmtMoney(budget)}`;
  const fill = $('budget-bar-fill'); fill.style.width = pct+'%'; fill.classList.toggle('over', spent > budget);
}

function calcTotalSpentKRW(dayData) {
  return Object.values(dayData).reduce((sum, d) =>
    sum + (d.expenses||[]).reduce((s,e) => s + toKRW(e.amount, e.currency), 0), 0);
}

// ══════════════════════════════════════
//  날짜 카드 렌더
// ══════════════════════════════════════
function renderTimeline(days, dayData, transData, weather, tripId) {
  const container = $('timeline-list'); container.innerHTML = '';
  days.forEach(({ date, dayIndex }) => {
    const data     = dayData[date] || {};
    const dayTrans = transData.filter(t => t.departDate <= date && t.arriveDate >= date);
    const w        = weather[data.city]?.[date];
    container.appendChild(buildDayCard(date, dayIndex, data, dayTrans, w, tripId));
  });
  const todayCard = container.querySelector('.today');
  if (todayCard) setTimeout(() => todayCard.scrollIntoView({behavior:'smooth',block:'start'}), 300);
}

function buildDayCard(date, dayIndex, data, dayTrans, weather, tripId) {
  const card = document.createElement('div');
  card.className = `day-card${isToday(date)?' today':''}`;

  // 헤더
  const cityTag      = data.city ? `<span class="city-tag">📍 ${escHtml(data.city)}</span>` : '';
  const weatherBadge = weather
    ? `<span class="weather-badge">${WC_EMOJI[weather.code]||'🌡️'} ${weather.max}° / ${weather.min}°</span>`
    : (data.city ? '' : `<span class="weather-hint">📍 도시 입력 시 날씨 표시</span>`);
  const editBtn = isReadOnly ? '' : `<button class="btn sm icon-btn day-edit-btn" onclick="openEditModal('${date}','${tripId}')">편집</button>`;

  // 교통
  const transHtml = dayTrans.length
    ? dayTrans.map(t => {
        const isDepart = t.departDate===date, isArrive = t.arriveDate===date;
        const badge = (!isDepart&&!isArrive) ? '<span class="transit-day-badge">이동 중</span>' : '';
        const timeStr = [isDepart&&t.departTime?`출발 ${t.departTime}`:'', isArrive&&t.arriveTime?`도착 ${t.arriveTime}`:''].filter(Boolean).join(' / ');
        const editBtn2 = isReadOnly?'':
          `<button class="btn sm icon-btn" onclick="openTransportModal('${t.id}','${tripId}')">편집</button>` +
          `<button class="btn sm danger" onclick="deleteTransport('${t.id}','${tripId}')">삭제</button>`;
        return `
          <div class="transport-item">
            <div class="transport-route">${TRANS_ICONS[t.type]||'🚗'} <b>${escHtml(t.fromCity||'?')}</b><span class="arrow">→</span><b>${escHtml(t.toCity||'?')}</b>${badge}</div>
            ${timeStr?`<div class="transport-meta">${timeStr}</div>`:''}
            ${t.bookingNo?`<div class="transport-booking">📋 ${escHtml(t.bookingNo)}</div>`:''}
            ${t.memo?`<div class="transport-booking" style="color:var(--text-2)">${escHtml(t.memo)}</div>`:''}
            <div class="transport-actions">
              <button class="btn sm icon-btn" onclick="copyTransport('${escHtml(t.fromCity||'')}','${escHtml(t.toCity||'')}','${escHtml(t.bookingNo||'')}')">복사</button>
              ${editBtn2}
            </div>
          </div>`;
      }).join('')
    : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">등록된 교통 없음</div>`;

  // 숙소
  let accomHtml = `<div class="t-cap" style="color:var(--text-3);font-style:italic;">미정</div>`;
  if (data.accommodation) {
    const mapBtn = data.accommodationMap ? ` <a href="${escHtml(data.accommodationMap)}" target="_blank" rel="noopener" class="accom-link">🗺 지도</a>` : '';
    accomHtml = `<div class="accom-row">${escHtml(data.accommodation)}${mapBtn}</div>`;
  }

  // 지출
  const expenses = data.expenses || [];
  const expTotalKRW = expenses.reduce((s,e) => s+toKRW(e.amount,e.currency), 0);
  const expHtml = expenses.length
    ? `<div class="expense-list">${expenses.map(e=>`
        <div class="expense-row">
          <span class="expense-cat">${EXP_LABELS[e.category]||e.category}</span>
          <span class="expense-name">${escHtml(e.name)}</span>
          <span class="expense-amount">${fmtExpenseAmount(e.amount,e.currency)}</span>
        </div>`).join('')}</div><div class="expense-total">합계 ${fmtMoney(expTotalKRW)}</div>`
    : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">지출 없음</div>`;

  // 메모
  const memoHtml = data.memo ? `<div class="memo-box">${escHtml(data.memo)}</div>` : `<div class="t-cap" style="color:var(--text-3);font-style:italic;">메모 없음</div>`;

  // To-Do
  const todos     = data.todos || [];
  const todoClass = isReadOnly ? 'class="todo-list readonly-todos"' : 'class="todo-list"';
  const todoItems = todos.map((todo,i) => `
    <li class="todo-item${todo.done?' done':''}" id="td-${date}-${i}">
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
    <div class="day-section"><div class="day-section-label">✈️ 교통</div>${transHtml}</div>
    <div class="day-section"><div class="day-section-label">🏨 숙소</div>${accomHtml}</div>
    <div class="day-section"><div class="day-section-label">💰 지출</div>${expHtml}</div>
    <div class="day-section"><div class="day-section-label">📝 메모</div>${memoHtml}</div>
    <div class="day-section"><div class="day-section-label">✅ To-Do</div><ul ${todoClass}>${todoItems}</ul>${addTodoRow}</div>`;
  return card;
}

// ══════════════════════════════════════
//  날씨
// ══════════════════════════════════════
async function fetchWeatherForTrip(trip, dayData, tripId) {
  const citySet = new Set(Object.values(dayData).map(d=>d.city).filter(Boolean));
  const result  = {};
  await Promise.all([...citySet].map(async city => {
    try {
      const geoRes  = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=ko`);
      const geoJson = await geoRes.json();
      if (!geoJson.results?.length) return;
      const { latitude:lat, longitude:lon } = geoJson.results[0];
      const today   = new Date().toISOString().slice(0,10);
      const maxDate = new Date(Date.now()+15*86400000).toISOString().slice(0,10);
      if (!result[city]) result[city] = {};

      // forecast
      const fs = trip.startDate > today ? trip.startDate : today;
      const fe = trip.endDate   < maxDate ? trip.endDate : maxDate;
      if (fs <= fe) {
        const fj = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${fs}&end_date=${fe}`)).json();
        fj.daily?.time?.forEach((d,i) => { result[city][d] = {code:fj.daily.weathercode[i],max:Math.round(fj.daily.temperature_2m_max[i]),min:Math.round(fj.daily.temperature_2m_min[i])}; });
      }
      // archive (past)
      const ae = trip.endDate < today ? trip.endDate : new Date(Date.now()-86400000).toISOString().slice(0,10);
      if (trip.startDate <= ae) {
        const aj = await (await fetch(`https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${trip.startDate}&end_date=${ae}`)).json();
        aj.daily?.time?.forEach((d,i) => { result[city][d] = {code:aj.daily.weathercode[i],max:Math.round(aj.daily.temperature_2m_max[i]),min:Math.round(aj.daily.temperature_2m_min[i])}; });
      }
    } catch { /* 날씨 실패 무시 */ }
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
    const t = (JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]')).find(x=>x.id===transId)||{};
    $('inp-trans-type').value        = t.type||'flight';
    $('inp-trans-from-city').value   = t.fromCity||'';
    $('inp-trans-to-city').value     = t.toCity||'';
    $('inp-trans-depart-date').value = t.departDate||'';
    $('inp-trans-depart-time').value = t.departTime||'';
    $('inp-trans-arrive-date').value = t.arriveDate||'';
    $('inp-trans-arrive-time').value = t.arriveTime||'';
    $('inp-trans-booking').value     = t.bookingNo||'';
    $('inp-trans-memo').value        = t.memo||'';
  } else {
    ['inp-trans-from-city','inp-trans-to-city','inp-trans-depart-time','inp-trans-arrive-time','inp-trans-booking','inp-trans-memo'].forEach(id => $(id).value='');
    $('inp-trans-type').value='flight';
    if (currentTripRef) { $('inp-trans-depart-date').value=$('inp-trans-arrive-date').value=currentTripRef.startDate; }
  }
  $('btn-save-transport').onclick = () => saveTransport(tripId);
  $('modal-transport').classList.add('open');
};
window.closeTransportModal = function() { $('modal-transport').classList.remove('open'); editingTransId=null; };

async function saveTransport(tripId) {
  const payload = {
    type:$('inp-trans-type').value, fromCity:$('inp-trans-from-city').value.trim(),
    toCity:$('inp-trans-to-city').value.trim(), departDate:$('inp-trans-depart-date').value,
    departTime:$('inp-trans-depart-time').value, arriveDate:$('inp-trans-arrive-date').value,
    arriveTime:$('inp-trans-arrive-time').value, bookingNo:$('inp-trans-booking').value.trim(),
    memo:$('inp-trans-memo').value.trim(),
  };
  if (!payload.departDate||!payload.arriveDate) { showToast('날짜를 입력하세요'); return; }
  if (payload.departDate > payload.arriveDate)  { showToast('도착일이 출발일보다 빠릅니다'); return; }
  closeTransportModal();
  const list = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
  if (editingTransId) { const i=list.findIndex(t=>t.id===editingTransId); if(i>=0) list[i]={...list[i],...payload}; }
  else list.push({id:genId(),...payload});
  localStorage.setItem(LS_TRANS(tripId), JSON.stringify(list));
  try {
    if (editingTransId) await updateDoc(doc(db,'trips',tripId,'transports',editingTransId), payload);
    else await addDoc(collection(db,'trips',tripId,'transports'), payload);
    showToast('교통 저장됨 ✓');
  } catch { showToast('오프라인 — 로컬 저장됨'); }
}

window.deleteTransport = async function(transId, tripId) {
  if (!confirm('이 교통 정보를 삭제할까요?')) return;
  const list = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]').filter(t=>t.id!==transId);
  localStorage.setItem(LS_TRANS(tripId), JSON.stringify(list));
  try { await deleteDoc(doc(db,'trips',tripId,'transports',transId)); showToast('삭제됨'); }
  catch { showToast('오프라인 — 로컬 삭제됨'); }
};

window.copyTransport = function(from, to, booking) {
  const text = [from&&`출발: ${from}`, to&&`도착: ${to}`, booking&&`예약: ${booking}`].filter(Boolean).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('복사됨'));
};

// ══════════════════════════════════════
//  숙소 일괄 등록
// ══════════════════════════════════════
function openBulkAccomModal(tripId) {
  $('inp-bulk-accom-name').value = '';
  $('inp-bulk-accom-map').value  = '';
  $('inp-bulk-start').value = currentTripRef?.startDate || '';
  $('inp-bulk-end').value   = currentTripRef?.endDate   || '';
  $('btn-save-bulk-accom').onclick = () => saveBulkAccom(tripId);
  $('modal-bulk-accom').classList.add('open');
}

async function saveBulkAccom(tripId) {
  const name  = $('inp-bulk-accom-name').value.trim();
  const map   = $('inp-bulk-accom-map').value.trim();
  const start = $('inp-bulk-start').value;
  const end   = $('inp-bulk-end').value;
  if (!name)        { showToast('숙소 이름을 입력하세요'); return; }
  if (!start||!end) { showToast('날짜를 입력하세요'); return; }
  if (start > end)  { showToast('종료일이 시작일보다 빠릅니다'); return; }
  $('modal-bulk-accom').classList.remove('open');

  const days    = generateDays(start, end);
  const cacheKey= LS_DAYS(tripId);
  const dayData = JSON.parse(localStorage.getItem(cacheKey)||'{}');

  const saves = days.map(async ({ date }) => {
    if (!dayData[date]) dayData[date] = {};
    dayData[date].accommodation    = name;
    dayData[date].accommodationMap = map;
    try {
      const ref = doc(db,'trips',tripId,'days',date);
      try { await updateDoc(ref, {accommodation:name, accommodationMap:map}); }
      catch { await setDoc(ref, dayData[date]); }
    } catch { /* offline */ }
  });

  await Promise.all(saves);
  localStorage.setItem(cacheKey, JSON.stringify(dayData));
  showToast(`${days.length}일치 숙소 등록 완료 ✓`);

  if (currentTripRef) {
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
    updateBudgetBar(currentTripRef, dayData);
  }
}

// ══════════════════════════════════════
//  예산
// ══════════════════════════════════════
function openBudgetModal(tripId) {
  $('inp-budget').value = currentTripRef?.budget || '';
  $('btn-save-budget').onclick = () => saveBudget(tripId);
  $('modal-budget').classList.add('open');
}
async function saveBudget(tripId) {
  const budget = Number($('inp-budget').value);
  if (!budget||budget<0) { showToast('올바른 금액을 입력하세요'); return; }
  $('modal-budget').classList.remove('open');
  currentTripRef = {...currentTripRef, budget};
  const raw = localStorage.getItem(LS_TRIPS);
  if (raw) { const trips=JSON.parse(raw).map(t=>t.id===tripId?{...t,budget}:t); localStorage.setItem(LS_TRIPS,JSON.stringify(trips)); }
  try { await updateDoc(doc(db,'trips',tripId),{budget}); showToast(`예산 ${fmtMoney(budget)} 저장됨 ✓`); }
  catch { showToast('오프라인 — 로컬 저장됨'); }
  updateBudgetBar(currentTripRef, JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}'));
}

// ══════════════════════════════════════
//  여행 통계
// ══════════════════════════════════════
function openStatsModal(tripId) {
  const dayData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}');
  const days    = generateDays(currentTripRef.startDate, currentTripRef.endDate);
  const today   = new Date().toISOString().slice(0,10);

  const elapsed   = days.filter(d => d.date <= today).length;
  const remaining = days.filter(d => d.date > today).length;
  const cities    = [...new Set(Object.values(dayData).map(d=>d.city).filter(Boolean))];
  const catTotals = {};
  let   totalKRW  = 0;

  Object.values(dayData).forEach(d => {
    (d.expenses||[]).forEach(e => {
      const krw = toKRW(e.amount, e.currency);
      totalKRW += krw;
      catTotals[e.category] = (catTotals[e.category]||0) + krw;
    });
  });

  const avgDaily    = elapsed > 0 ? Math.round(totalKRW/elapsed) : 0;
  const budget      = currentTripRef?.budget || 0;
  const maxCat      = Math.max(...Object.values(catTotals), 1);

  const catBarsHtml = EXP_KEYS.filter(k => catTotals[k]).map(k => `
    <div class="cat-bar-row">
      <span class="cat-bar-label">${EXP_LABELS[k]}</span>
      <div class="cat-bar-track"><div class="cat-bar-fill" style="width:${Math.round(catTotals[k]/maxCat*100)}%"></div></div>
      <span class="cat-bar-amt">${fmtMoney(catTotals[k])}</span>
    </div>`).join('') || '<div class="t-cap">지출 내역 없음</div>';

  $('stats-content').innerHTML = `
    <div class="stat-grid">
      <div class="stat-box"><div class="num">${days.length}</div><div class="lbl">총 여행 일수</div></div>
      <div class="stat-box"><div class="num">${elapsed}</div><div class="lbl">경과 일수</div></div>
      <div class="stat-box"><div class="num">${remaining}</div><div class="lbl">남은 일수</div></div>
      <div class="stat-box"><div class="num">${cities.length}</div><div class="lbl">방문 도시</div></div>
    </div>
    ${cities.length ? `<div style="margin-bottom:16px;"><div class="day-section-label" style="margin-bottom:8px;">방문 도시</div><div style="display:flex;flex-wrap:wrap;gap:6px;">${cities.map(c=>`<span class="city-tag">${escHtml(c)}</span>`).join('')}</div></div>` : ''}
    <div style="margin-bottom:16px;">
      <div class="day-section-label" style="margin-bottom:10px;">지출 현황</div>
      <div class="stat-grid" style="margin-bottom:12px;">
        <div class="stat-box"><div class="num" style="font-size:1.2rem;">${fmtMoney(totalKRW)}</div><div class="lbl">총 지출</div></div>
        <div class="stat-box"><div class="num" style="font-size:1.2rem;">${fmtMoney(avgDaily)}</div><div class="lbl">일평균 지출</div></div>
      </div>
      ${budget ? `<div class="stat-box" style="margin-bottom:12px;">
        <div style="display:flex;justify-content:space-between;font-size:.85rem;font-weight:600;margin-bottom:6px;">
          <span>예산 대비</span>
          <span style="color:${totalKRW>budget?'var(--danger)':'var(--success)'};">${Math.round(totalKRW/budget*100)}%</span>
        </div>
        <div class="budget-bar-track"><div class="budget-bar-fill ${totalKRW>budget?'over':''}" style="width:${Math.min(Math.round(totalKRW/budget*100),100)}%"></div></div>
        <div style="font-size:.78rem;color:var(--text-2);margin-top:6px;">잔여 ${fmtMoney(Math.max(budget-totalKRW,0))}</div>
      </div>` : ''}
      ${catBarsHtml}
    </div>`;
  $('modal-stats').classList.add('open');
}

// ══════════════════════════════════════
//  준비물
// ══════════════════════════════════════
function openPackingModal(tripId) {
  if (!currentTripRef) { currentTripRef = JSON.parse(localStorage.getItem(LS_TRIPS)||'[]').find(t=>t.id===tripId)||null; }
  if (!currentTripRef?.packing) currentTripRef = { ...currentTripRef, packing:[] };
  $('modal-packing').classList.add('open');
  renderPackingList(tripId);
}
function renderPackingList(tripId) {
  const items = currentTripRef?.packing || [];
  const done  = items.filter(i=>i.done).length;
  $('packing-list').innerHTML = items.map((item,idx) => `
    <li class="todo-item${item.done?' done':''}" style="justify-content:space-between;">
      <div style="display:flex;align-items:center;gap:8px;flex:1;">
        <input type="checkbox" ${item.done?'checked':''} onchange="togglePacking('${tripId}',${idx},this.checked)" />
        <label>${escHtml(item.text)}</label>
      </div>
      <button class="btn sm danger" style="padding:3px 8px;font-size:.72rem;" onclick="deletePacking('${tripId}',${idx})">×</button>
    </li>`).join('');
  $('packing-progress').textContent = `${done} / ${items.length} 완료`;
}
window.addPackingItem = function() {
  const inp = $('inp-packing-item'), text = inp.value.trim();
  if (!text) return;
  if (!currentTripRef.packing) currentTripRef.packing = [];
  currentTripRef.packing.push({text, done:false}); inp.value='';
  savePacking(currentTripId); renderPackingList(currentTripId);
};
window.togglePacking = function(tripId, idx, done) {
  if (!currentTripRef?.packing) return;
  currentTripRef.packing[idx].done = done;
  savePacking(tripId); renderPackingList(tripId);
};
window.deletePacking = function(tripId, idx) {
  if (!currentTripRef?.packing) return;
  currentTripRef.packing.splice(idx,1);
  savePacking(tripId); renderPackingList(tripId);
};
function applyPackingTemplate(key, tripId) {
  if (!currentTripRef.packing) currentTripRef.packing=[];
  const existing = new Set(currentTripRef.packing.map(i=>i.text));
  (PACKING_TEMPLATES[key]||[]).filter(t=>!existing.has(t)).forEach(t=>currentTripRef.packing.push({text:t,done:false}));
  savePacking(tripId); renderPackingList(tripId); showToast('템플릿 적용됨');
}
async function savePacking(tripId) {
  const packing = currentTripRef?.packing||[];
  const raw = localStorage.getItem(LS_TRIPS);
  if (raw) { const trips=JSON.parse(raw).map(t=>t.id===tripId?{...t,packing}:t); localStorage.setItem(LS_TRIPS,JSON.stringify(trips)); }
  try { await updateDoc(doc(db,'trips',tripId),{packing}); } catch {}
}

// ══════════════════════════════════════
//  날짜 카드 편집
// ══════════════════════════════════════
window.openEditModal = function(date, tripId) {
  const data = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}')?.[date]||{};
  $('modal-day-title').textContent = `${fmtDateShort(date)} 편집`;
  $('inp-city').value       = data.city||'';
  $('inp-accom-name').value = data.accommodation||'';
  $('inp-accom-map').value  = data.accommodationMap||'';
  $('inp-memo').value       = data.memo||'';
  $('inp-todos').value      = (data.todos||[]).map(t=>t.text).join('\n');
  // 메모 접힘 초기화
  const memoField = $('memo-field');
  if (data.memo) { memoField.style.display=''; $('memo-toggle-icon').textContent='▲ 접기'; }
  else           { memoField.style.display='none'; $('memo-toggle-icon').textContent='▼ 펼치기'; }
  editingExpenses = JSON.parse(JSON.stringify(data.expenses||[]));
  renderEditExpenses();
  $('btn-save-day').onclick = () => saveDayEdit(tripId, date);
  $('modal-edit-day').classList.add('open');
};
window.closeEditModal  = function() { $('modal-edit-day').classList.remove('open'); };
window.toggleMemoField = function() {
  const f = $('memo-field'), shown = f.style.display !== 'none';
  f.style.display = shown ? 'none' : '';
  $('memo-toggle-icon').textContent = shown ? '▼ 펼치기' : '▲ 접기';
};

function renderEditExpenses() {
  $('expense-list-edit').innerHTML = editingExpenses.map((e,i) => `
    <div class="expense-item-edit">
      <span class="exp-cat">${EXP_LABELS[e.category]||e.category}</span>
      <span class="exp-name">${escHtml(e.name)}</span>
      <span class="exp-amt">${e.currency&&e.currency!=='KRW'?`${CURRENCIES[e.currency]?.s||''}${Number(e.amount).toLocaleString()}`:fmtMoney(e.amount)}</span>
      <button class="btn sm danger" style="padding:3px 8px;font-size:.72rem;margin-left:auto;" onclick="removeEditExpense(${i})">×</button>
    </div>`).join('') || `<div class="t-cap" style="margin-bottom:6px;">없음</div>`;
}
window.removeEditExpense = function(idx) { editingExpenses.splice(idx,1); renderEditExpenses(); };

function addEditExpense() {
  const cat=($('inp-exp-cat').value), name=($('inp-exp-name').value.trim()), amount=Number($('inp-exp-amount').value), currency=$('inp-exp-currency').value;
  if (!name||!amount) { showToast('항목명과 금액을 입력하세요'); return; }
  editingExpenses.push({id:genId(), category:cat, name, amount, currency});
  $('inp-exp-name').value=''; $('inp-exp-amount').value='';
  renderEditExpenses();
}

async function saveDayEdit(tripId, date) {
  const prevData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}')?.[date]||{};
  const todosRaw = $('inp-todos').value.trim();
  const todos    = todosRaw ? todosRaw.split('\n').filter(l=>l.trim()).map(text => {
    const prev = (prevData.todos||[]).find(t=>t.text===text.trim());
    return { text:text.trim(), done: prev?.done||false };
  }) : [];
  const payload = {
    city:$('inp-city').value.trim(), accommodation:$('inp-accom-name').value.trim(),
    accommodationMap:$('inp-accom-map').value.trim(), memo:$('inp-memo').value.trim(),
    todos, expenses:editingExpenses,
  };
  closeEditModal();
  const cacheKey = LS_DAYS(tripId);
  const dayData  = JSON.parse(localStorage.getItem(cacheKey)||'{}');
  dayData[date]  = payload;
  localStorage.setItem(cacheKey, JSON.stringify(dayData));
  try {
    const ref = doc(db,'trips',tripId,'days',date);
    try { await updateDoc(ref, payload); } catch { await setDoc(ref, payload); }
    showToast('저장됨 ✓');
  } catch { showToast('오프라인 — 로컬 저장됨'); }
  if (currentTripRef) {
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
    updateBudgetBar(currentTripRef, dayData);
    fetchWeatherForTrip(currentTripRef, dayData, tripId).then(w => {
      Object.assign(weather, w); localStorage.setItem(LS_WEATHER(tripId), JSON.stringify(weather));
      renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
    });
  }
}

// ══════════════════════════════════════
//  To-Do 인라인
// ══════════════════════════════════════
window.toggleTodo = async function(tripId, date, idx, done) {
  const cacheKey=LS_DAYS(tripId), dayData=JSON.parse(localStorage.getItem(cacheKey)||'{}');
  if (!dayData[date]?.todos) return;
  dayData[date].todos[idx].done=done; localStorage.setItem(cacheKey, JSON.stringify(dayData));
  const el=$(`td-${date}-${idx}`); if(el) el.classList.toggle('done',done);
  try { await updateDoc(doc(db,'trips',tripId,'days',date),{todos:dayData[date].todos}); } catch {}
};

window.addTodo = async function(tripId, date) {
  const inp=$(`ti-${date}`), text=inp?.value.trim(); if(!text) return;
  const cacheKey=LS_DAYS(tripId), dayData=JSON.parse(localStorage.getItem(cacheKey)||'{}');
  if (!dayData[date]) dayData[date]={};
  if (!dayData[date].todos) dayData[date].todos=[];
  dayData[date].todos.push({text,done:false}); localStorage.setItem(cacheKey,JSON.stringify(dayData)); inp.value='';
  try { const ref=doc(db,'trips',tripId,'days',date); try{await updateDoc(ref,{todos:dayData[date].todos});}catch{await setDoc(ref,dayData[date]);} } catch {}
  if (currentTripRef) {
    const transData=JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather=JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate,currentTripRef.endDate),dayData,transData,weather,tripId);
  }
};

// ══════════════════════════════════════
//  이벤트 바인딩
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  if (!isOnline) $('offline-banner').style.display='block';
  loadFxRates();

  $('btn-new-trip').addEventListener('click', openNewTripModal);
  $('btn-cancel-new-trip').addEventListener('click', () => $('modal-new-trip').classList.remove('open'));
  $('btn-save-new-trip').addEventListener('click', saveNewTrip);
  $('inp-trip-title').addEventListener('keydown', e => { if(e.key==='Enter') saveNewTrip(); });

  $('btn-back').addEventListener('click', () => {
    if(unsubDays)  { unsubDays();  unsubDays=null; }
    if(unsubTrans) { unsubTrans(); unsubTrans=null; }
    currentTripRef=null; navigate(null);
  });

  $('btn-add-expense').addEventListener('click', addEditExpense);
  $('inp-exp-amount').addEventListener('keydown', e => { if(e.key==='Enter') addEditExpense(); });

  $('tpl-basic').addEventListener('click', () => applyPackingTemplate('basic', currentTripId));
  $('tpl-long').addEventListener('click',  () => applyPackingTemplate('long',  currentTripId));
  $('tpl-biz').addEventListener('click',   () => applyPackingTemplate('biz',   currentTripId));
  $('btn-clear-packing').addEventListener('click', () => {
    if (!currentTripRef?.packing) return;
    currentTripRef.packing=currentTripRef.packing.filter(i=>!i.done);
    savePacking(currentTripId); renderPackingList(currentTripId);
  });

  boot();
});
