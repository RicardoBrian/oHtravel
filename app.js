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
const TRANS_ICONS  = { flight:'ic-plane', train:'ic-train', ship:'ic-ship', bus:'ic-bus' };
function ic(id, size=15) { return `<svg class="ic" width="${size}" height="${size}"><use href="#${id}"/></svg>`; }

const PACKING_TEMPLATE = ['여권','지갑 / 카드','핸드폰 충전기','이어폰','상비약','세면도구','선크림','보조배터리','어댑터'];

// 도시별 자동 색상 팔레트
const CITY_PALETTE = [
  { bg:'rgba(0,113,227,.13)',   text:'#0071e3' },
  { bg:'rgba(52,199,89,.15)',   text:'#1a9e3f' },
  { bg:'rgba(255,159,10,.15)',  text:'#b87000' },
  { bg:'rgba(175,82,222,.13)',  text:'#8533c4' },
  { bg:'rgba(255,59,48,.12)',   text:'#d0241a' },
  { bg:'rgba(90,200,250,.18)',  text:'#0772b6' },
  { bg:'rgba(255,45,85,.12)',   text:'#c4004a' },
  { bg:'rgba(48,209,88,.14)',   text:'#1e8c40' },
];
function cityColor(city) {
  if (!city) return null;
  let h = 0; for (let i = 0; i < city.length; i++) h = (h * 31 + city.charCodeAt(i)) & 0xffff;
  return CITY_PALETTE[h % CITY_PALETTE.length];
}

const WC_ICONS = {0:'ic-sun',1:'ic-cloud-sun',2:'ic-cloud-sun',3:'ic-cloud',45:'ic-cloud',48:'ic-cloud',51:'ic-cloud-rain',53:'ic-cloud-rain',55:'ic-cloud-rain',61:'ic-cloud-rain',63:'ic-cloud-rain',65:'ic-cloud-rain',71:'ic-cloud-snow',73:'ic-cloud-snow',75:'ic-cloud-snow',77:'ic-cloud-snow',80:'ic-cloud-rain',81:'ic-cloud-rain',82:'ic-cloud-storm',85:'ic-cloud-snow',86:'ic-cloud-snow',95:'ic-cloud-storm',96:'ic-cloud-storm',99:'ic-cloud-storm'};

const LS_TRIPS   = 'ohtravel_trips';
const LS_DAYS    = id => `ohtravel_days_${id}`;
const LS_TRANS   = id => `ohtravel_trans_${id}`;
const LS_WEATHER = id => `ohtravel_weather_${id}`;
const LS_CONFIG  = 'ohtravel_config';

// ══════════════════════════════════════
//  상태
// ══════════════════════════════════════
let isAuthed       = sessionStorage.getItem('ohtravel_authed') === '1';
let currentTripId  = null;
let isReadOnly     = false;
let isOnline       = navigator.onLine;
let unsubTrips     = null;
let unsubDays      = null;
let unsubTrans     = null;
let editingTransId = null;
let currentTripRef = null;
let expandedDays   = new Set(); // 기본 접힘 — 명시적으로 펼친 날짜만 추적
let pendingDelete  = null;

// ══════════════════════════════════════
//  유틸
// ══════════════════════════════════════
const $ = id => document.getElementById(id);

function showToast(msg, withUndo = false) {
  const el = $('toast');
  $('toast-msg').textContent = msg;
  const undoBtn = $('toast-undo');
  undoBtn.style.display = withUndo ? '' : 'none';
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), withUndo ? 5000 : 2600);
}

window.undoDelete = function() {
  if (!pendingDelete) return;
  clearTimeout(pendingDelete.timerId);
  const p = pendingDelete; pendingDelete = null;
  $('toast').classList.remove('show');
  if (p.type === 'trip') {
    // Item still in localStorage — just re-render
    renderTripListFromCache();
    showToast('삭제 취소됨');
  } else if (p.type === 'transport') {
    // Restore to localStorage
    const list = JSON.parse(localStorage.getItem(LS_TRANS(p.tripId)) || '[]');
    list.push(p.data);
    localStorage.setItem(LS_TRANS(p.tripId), JSON.stringify(list));
    redrawTimeline(p.tripId);
    showToast('삭제 취소됨');
  }
};

function scheduleDelete(type, id, data, tripId) {
  if (pendingDelete) {
    clearTimeout(pendingDelete.timerId);
    executePendingDelete(pendingDelete);
  }
  const timerId = setTimeout(() => {
    executePendingDelete(pendingDelete);
    pendingDelete = null;
  }, 5000);
  pendingDelete = { type, id, data, tripId, timerId };
}

async function executePendingDelete(item) {
  if (!item) return;
  try {
    if (item.type === 'trip') {
      // Remove from localStorage
      const raw = localStorage.getItem(LS_TRIPS);
      if (raw) {
        const trips = JSON.parse(raw).filter(t => t.id !== item.id);
        localStorage.setItem(LS_TRIPS, JSON.stringify(trips));
      }
      await deleteDoc(doc(db, 'trips', item.id));
    } else if (item.type === 'transport') {
      await deleteDoc(doc(db, 'trips', item.tripId, 'transports', item.id));
    }
  } catch { /* 삭제 실패 무시 */ }
}

function escHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function autoLink(text) {
  const parts = String(text).split(/(https?:\/\/[^\s<>"']+)/g);
  return parts.map((part, i) =>
    i % 2 === 1
      ? `<a href="${escHtml(part)}" target="_blank" rel="noopener" class="auto-link">${escHtml(part)}</a>`
      : escHtml(part)
  ).join('');
}

// "10:00 박물관 예약" → { time:'10:00', text:'박물관 예약' } / 시간 없으면 { time:null, text:raw }
function parseTodoInput(raw) {
  const m = raw.trim().match(/^([01]?\d|2[0-3]):([0-5]\d)\s+(.+)/);
  return m ? { time: `${m[1].padStart(2,'0')}:${m[2]}`, text: m[3].trim() } : { time: null, text: raw.trim() };
}

// 내용 있을 때만 "메모" 칩 렌더 — 탭하면 펼쳐짐, 칩 자체도 열림 상태 표시
function memoChip(text) {
  if (!text) return '';
  return `<button type="button" class="memo-chip" onclick="this.classList.toggle('open');this.nextElementSibling.classList.toggle('open')">${ic('ic-chevron',11)} 메모</button><div class="memo-note">${autoLink(text)}</div>`;
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
function localDateStr(d) {
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), day = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${day}`;
}
function todayStr() { return localDateStr(new Date()); }
function isToday(d) { return d === todayStr(); }
function isPast(d)  { return d < todayStr(); }
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
  while (cur <= end) { days.push({ date: localDateStr(cur), dayIndex: i++ }); cur.setDate(cur.getDate()+1); }
  return days;
}

// ══════════════════════════════════════
//  접근 제어
// ══════════════════════════════════════
async function getAccessConfig() {
  // Try Firestore, fallback to localStorage cache, then defaults
  try {
    const snap = await getDoc(doc(db, 'config', 'access'));
    const cfg = snap.exists() ? snap.data() : {};
    const result = { entryCode: cfg.entryCode || '961002' };
    localStorage.setItem(LS_CONFIG, JSON.stringify(result));
    return result;
  } catch {
    const cached = localStorage.getItem(LS_CONFIG);
    if (cached) return JSON.parse(cached);
    return { entryCode: '961002' };
  }
}

function showEntryScreen() {
  $('screen-entry').classList.remove('hidden');
}
function hideEntryScreen() {
  $('screen-entry').classList.add('hidden');
}

async function handleEntrySubmit() {
  const code = $('inp-entry-code').value.trim();
  if (!code) return;
  const cfg = await getAccessConfig();
  if (code === cfg.entryCode) {
    sessionStorage.setItem('ohtravel_authed', '1');
    isAuthed = true;
    hideEntryScreen();
    boot();
  } else {
    $('entry-error').style.display = '';
    $('inp-entry-code').value = '';
    $('inp-entry-code').focus();
    setTimeout(() => { $('entry-error').style.display = 'none'; }, 3000);
  }
}

// ── 설정 (입장 코드 변경) ──
function openSettings() {
  $('inp-new-entry-code').value = '';
  $('modal-settings').classList.add('open');
}

async function saveSettings() {
  const newCode = $('inp-new-entry-code').value.trim();
  if (!newCode) { showToast('새 입장 코드를 입력하세요'); return; }
  const cfg = await getAccessConfig();
  const updated = { entryCode: newCode || cfg.entryCode };
  try {
    await setDoc(doc(db, 'config', 'access'), updated);
    localStorage.setItem(LS_CONFIG, JSON.stringify(updated));
    $('modal-settings').classList.remove('open');
    showToast('입장 코드 변경됨');
  } catch(err) {
    showToast('저장 실패: ' + (err?.message || err));
  }
}

// ══════════════════════════════════════
//  다크 모드 & 온라인
// ══════════════════════════════════════
function initDarkToggle() {
  const ne = $('nav-end');
  // Remove existing toggle if any
  ne.querySelectorAll('.dark-toggle').forEach(el => el.remove());
  const t = document.createElement('div'); t.className = 'dark-toggle'; t.title = '다크모드';
  t.onclick = () => { document.body.classList.toggle('dark'); localStorage.setItem('ohtravel_dark', document.body.classList.contains('dark')?'1':'0'); };
  ne.appendChild(t);
  if (localStorage.getItem('ohtravel_dark') === '1') document.body.classList.add('dark');
}
window.addEventListener('online',  () => { isOnline = true;  const b=$('offline-banner'); if(b) b.style.display='none'; });
window.addEventListener('offline', () => { isOnline = false; const b=$('offline-banner'); if(b) b.style.display='block'; });

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
  // 공유 모드는 인증 없이 바로 진입
  if (!isAuthed && !isReadOnly) { showEntryScreen(); return; }
  hideEntryScreen();
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
    let currentCityBadge = '';
    if (dd.type === 'ongoing') {
      const today = todayStr();
      const cachedDays = JSON.parse(localStorage.getItem(LS_DAYS(trip.id))||'{}');
      const curCity = cachedDays[today]?.city;
      if (curCity) currentCityBadge = `<span class="badge neutral">${ic('ic-pin',12)} 현재: ${escHtml(curCity)}</span>`;
    }
    const card = document.createElement('div');
    card.className = 'trip-card';
    card.innerHTML = `
      <div class="trip-card-header">
        <div class="trip-card-title">${escHtml(trip.title||'제목 없음')}</div>
        <div class="trip-card-dday ${dd.type}">${dd.label}</div>
      </div>
      <div class="trip-card-date">${fmtDate(trip.startDate)} ~ ${fmtDate(trip.endDate)}</div>
      ${currentCityBadge ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">${currentCityBadge}</div>` : ''}
      <div class="trip-card-actions">
        <button class="icon-action btn-packing-card" data-id="${trip.id}" title="준비물">${ic('ic-suitcase',16)}</button>
        <button class="icon-action btn-dup-card" data-id="${trip.id}" title="복제">${ic('ic-clipboard',16)}</button>
        <button class="icon-action danger btn-del-trip" data-id="${trip.id}" title="삭제">${ic('ic-trash',16)}</button>
      </div>`;
    card.addEventListener('click', e => {
      if (e.target.closest('.btn-packing-card,.btn-dup-card,.btn-del-trip')) return;
      navigate(trip.id);
    });
    card.querySelector('.btn-packing-card').addEventListener('click', e => {
      e.stopPropagation();
      currentTripRef = trip; currentTripId = trip.id;
      openPackingModal(trip.id);
    });
    card.querySelector('.btn-dup-card').addEventListener('click', e => {
      e.stopPropagation();
      duplicateTrip(trip);
    });
    card.querySelector('.btn-del-trip').addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm(`"${trip.title}" 여행을 삭제할까요?`)) return;
      // Optimistically remove card from DOM
      card.style.display = 'none';
      scheduleDelete('trip', trip.id, trip, null);
      showToast(`"${escHtml(trip.title)}" 삭제됨`, true);
    });
    list.appendChild(card);
  });
}

// ── 여행 복제 ──
async function duplicateTrip(trip) {
  try {
    await addDoc(collection(db,'trips'), {
      title:     (trip.title || '여행') + ' (복사)',
      startDate: trip.startDate,
      endDate:   trip.endDate,
      createdAt: serverTimestamp(),
    });
    showToast('여행 복제됨');
  } catch(err) { showToast('복제 실패: ' + (err?.message||err)); }
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
    showToast('여행 등록됨');
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
  try { await updateDoc(doc(db,'trips',tripId), {title, startDate:start, endDate:end}); showToast('여행 정보 저장됨'); }
  catch { showToast('오프라인 — 로컬 저장됨'); }
  const dayData   = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
  const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
  const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
  renderTimeline(generateDays(start, end), dayData, transData, weather, tripId);
}

// ══════════════════════════════════════
//  타임라인 뷰
// ══════════════════════════════════════
async function showTimelineView(tripId) {
  $('view-dashboard').style.display = 'none'; $('view-timeline').style.display = '';
  initDarkToggle();
  if (unsubTrips) { unsubTrips(); unsubTrips = null; }

  let trip = null;
  if (isOnline) { try { const s = await getDoc(doc(db,'trips',tripId)); if (s.exists()) trip = {id:s.id,...s.data()}; } catch {} }
  if (!trip)    { const r = localStorage.getItem(LS_TRIPS); trip = r ? JSON.parse(r).find(t=>t.id===tripId) : null; }
  if (!trip)    { $('trip-title-display').textContent = '여행을 찾을 수 없습니다'; return; }

  currentTripRef = trip;
  $('trip-title-display').textContent = trip.title || '제목 없음';
  $('trip-date-range').textContent = `${fmtDate(trip.startDate)} ~ ${fmtDate(trip.endDate)}`;

  const editTripBtn = $('btn-edit-trip');

  if (isReadOnly) {
    $('btn-back').style.display = 'none';
    editTripBtn.style.display   = 'none';
    $('timeline-header-actions').innerHTML = `<div class="readonly-banner">${ic('ic-lock',13)} 읽기 전용 공유 모드</div>`;
    $('timeline-sidebar').innerHTML = '';
  } else {
    $('btn-back').style.display = '';
    editTripBtn.style.display   = '';
    editTripBtn.onclick = () => openEditTripModal(tripId);

    const actionBtnsHtml = `
      <button class="btn sm" data-action="transport">${ic('ic-plane',14)} 교통 등록</button>
      <button class="btn sm" data-action="bulk-edit">${ic('ic-calendar',14)} 일괄 편집</button>
      <button class="btn sm ghost" data-action="packing">${ic('ic-suitcase',14)} 준비물</button>
      <button class="btn sm ghost" data-action="share">${ic('ic-share',14)} 공유</button>
      <button class="btn sm ghost" data-action="data-io">${ic('ic-folder',14)} 백업</button>
      <button class="btn sm ghost" data-action="print">${ic('ic-printer',14)} 인쇄</button>`;

    $('timeline-header-actions').innerHTML = actionBtnsHtml;
    $('timeline-sidebar').innerHTML = actionBtnsHtml;

    const bindActions = container => {
      container.addEventListener('click', e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const a = btn.dataset.action;
        if      (a==='transport')  openTransportModal(null, tripId);
        else if (a==='bulk-edit')  openBulkEditModal(tripId);
        else if (a==='packing')    openPackingModal(tripId);
        else if (a==='share') {
          const url = `${location.origin}${location.pathname}?tripId=${tripId}&view=share`;
          navigator.clipboard.writeText(url).then(() => showToast('공유 링크 복사됨'));
        }
        else if (a==='data-io') openDataIOModal(tripId);
        else if (a==='print') window.print();
      });
    };
    bindActions($('timeline-header-actions'));
    bindActions($('timeline-sidebar'));
  }

  const days = generateDays(trip.startDate, trip.endDate);
  if (!isOnline) {
    const dayData   = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
    renderTimeline(days, dayData, transData, weather, tripId);
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
  const redraw = () => { renderTimeline(days, dayData, transData, weather, tripId); };

  unsubDays = onSnapshot(collection(db,'trips',tripId,'days'), snap => {
    dayData = {}; snap.forEach(d => { dayData[d.id] = d.data(); });
    localStorage.setItem(LS_DAYS(tripId), JSON.stringify(dayData));
    redraw();
    fetchWeatherForTrip(trip, dayData, tripId).then(w => { Object.assign(weather, w); localStorage.setItem(LS_WEATHER(tripId), JSON.stringify(weather)); redraw(); });
  }, () => { dayData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}'); redraw(); });

  unsubTrans = onSnapshot(collection(db,'trips',tripId,'transports'), snap => {
    transData = []; snap.forEach(d => transData.push({id:d.id,...d.data()}));
    // 시간순 정렬
    transData.sort((a,b) => {
      const da = (a.departDate||'') + (a.departTime||'');
      const db2 = (b.departDate||'') + (b.departTime||'');
      return da.localeCompare(db2);
    });
    localStorage.setItem(LS_TRANS(tripId), JSON.stringify(transData));
    redraw();
  }, () => { transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]'); redraw(); });
}

function redrawTimeline(tripId) {
  if (!currentTripRef) return;
  const dayData   = JSON.parse(localStorage.getItem(LS_DAYS(tripId)) || '{}');
  const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId)) || '[]');
  const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId)) || '{}');
  renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
}

// ══════════════════════════════════════
//  날짜 카드 렌더
// ══════════════════════════════════════
function renderTimeline(days, dayData, transData, weather, tripId) {
  const container = $('timeline-list'); container.innerHTML = '';
  const today = todayStr();

  // 여행 상태 (진행률 + 숙소 미정 + 날짜 이동)
  renderTripStatus(days, today, dayData);

  days.forEach(({ date, dayIndex }, idx) => {
    const data     = dayData[date] || {};
    // Transport: filter and sort by departDate, then departTime
    const dayTrans = transData
      .filter(t => t.departDate <= date && t.arriveDate >= date)
      .sort((a,b) => ((a.departDate||'')+(a.departTime||'')).localeCompare((b.departDate||'')+(b.departTime||'')));

    const w = weather[data.city]?.[date];

    // 체크인/체크아웃 판정
    // 규칙: 숙소가 바뀌는 날(전환일)에 이전 숙소 체크아웃 + 새 숙소 체크인 동시 표시
    const prevAccom = idx > 0 ? (dayData[days[idx-1].date]?.accommodation || '') : '';
    const nextAccom = idx < days.length-1 ? (dayData[days[idx+1].date]?.accommodation || '') : '';
    const curAccom  = data.accommodation || '';
    // accomInfo: { type, prevAccom }
    // transition = 이전 숙소 있고 새 숙소로 바뀜 → 체크아웃(prevAccom) + 체크인(curAccom)
    // checkin    = 첫 입실 (이전 숙소 없음)
    // checkout   = 마지막 퇴실 (다음 숙소 없고, 마지막날이거나 다음날 숙소 없음)
    // stay       = 연박 중간 (변화 없음)
    const isLastDayOfTrip = idx === days.length - 1;

    let accomInfo = null;
    if (curAccom) {
      const isFreshCheckin = curAccom !== prevAccom;
      // 체크인 당일부터 같은 숙소가 연속되는 일수 — 여행 마지막 날은 체크아웃일이므로 밤으로 세지 않음
      let nights = 0;
      if (isFreshCheckin) {
        for (let j = idx; j < days.length; j++) {
          if ((dayData[days[j].date]?.accommodation || '') !== curAccom) break;
          if (j === days.length - 1) break;
          nights++;
        }
      }
      if (isFreshCheckin && prevAccom) accomInfo = { type: 'transition', prevAccom, prevAccomMap: dayData[days[idx-1].date]?.accommodationMap || '', nights };
      else if (isFreshCheckin)          accomInfo = { type: 'checkin', nights };
      else if (!nextAccom)              accomInfo = { type: 'checkout' };
      else                              accomInfo = { type: 'stay' };
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'day-row';

    const dot = document.createElement('div');
    dot.className = `timeline-dot${isToday(date)?' today-dot':isPast(date)?' past-dot':''}`;
    wrapper.appendChild(dot);
    wrapper.appendChild(buildDayCard(date, dayIndex, data, dayTrans, w, tripId, accomInfo, isLastDayOfTrip));
    container.appendChild(wrapper);
  });

  // 오늘 카드로 스크롤
  const todayCard = container.querySelector(`#day-${today}`);
  if (todayCard) setTimeout(() => todayCard.scrollIntoView({behavior:'smooth',block:'start'}), 300);
}

function renderTripStatus(days, today, dayData) {
  const wrap = $('trip-status-wrap');
  if (!wrap) return;

  const total    = days.length;
  const elapsed  = days.filter(d => d.date <= today).length;
  const isActive = elapsed > 0 && elapsed < total;
  const pct      = isActive ? Math.round(elapsed / total * 100) : 0;

  // 여행 마지막 날은 체크아웃하고 떠나는 날이라 숙소가 없는 게 정상 — 미정 집계에서 제외
  const lastDate = days[days.length-1]?.date;
  const missing  = isReadOnly ? [] : days.filter(d => d.date >= today && d.date !== lastDate && !dayData[d.date]?.accommodation);
  const showJump = days.length >= 5;

  if (!isActive && !missing.length && !showJump) { wrap.innerHTML = ''; return; }

  const progressHtml = isActive
    ? `<span class="trip-status-progress">Day ${elapsed}/${total} · ${pct}%</span>` : '';
  const missingHtml = missing.length
    ? `<button type="button" class="trip-status-missing" title="클릭 시 첫 미정 날짜로 이동">${ic('ic-warning',13)} 숙소 미정 ${missing.length}일</button>` : '';
  const jumpHtml = showJump
    ? `<select class="inp trip-status-jump"><option value="">날짜 이동...</option>${days.map(d=>`<option value="${d.date}">Day ${d.dayIndex} · ${fmtDateShort(d.date)}</option>`).join('')}</select>` : '';

  wrap.innerHTML = `
    ${isActive ? `<div class="trip-progress"><div class="trip-progress-bar" style="width:${pct}%"></div></div>` : ''}
    <div class="trip-status-row">${progressHtml}${missingHtml}${jumpHtml}</div>`;

  if (missing.length) {
    wrap.querySelector('.trip-status-missing').onclick = () => {
      const card = document.getElementById(`day-${missing[0].date}`);
      if (card) card.scrollIntoView({behavior:'smooth',block:'start'});
    };
  }
  if (showJump) {
    const select = wrap.querySelector('.trip-status-jump');
    select.onchange = () => {
      if (!select.value) return;
      const card = document.getElementById(`day-${select.value}`);
      if (card) card.scrollIntoView({behavior:'smooth',block:'start'});
      setTimeout(() => { select.value = ''; }, 100);
    };
  }
}

function buildDayCard(date, dayIndex, data, dayTrans, weather, tripId, accomInfo, isLastDayOfTrip) {
  const card = document.createElement('div');
  const hasOvernightTrans = dayTrans.some(t => t.departDate <= date && t.arriveDate > date);
  // 여행 마지막 날은 체크아웃하고 떠나는 날이라 숙소가 없는 게 정상
  const hasMissingAccom = !data.accommodation && !hasOvernightTrans && !isLastDayOfTrip;
  const isTravelDay = dayTrans.some(t => t.departDate === date || t.arriveDate === date);
  const isCollapsed = !expandedDays.has(date);

  let cls = 'day-card';
  if (isToday(date)) cls += ' today';
  if (isTravelDay)   cls += ' travel-day';
  if (hasMissingAccom && !isReadOnly) cls += ' missing-accom';
  if (isCollapsed)   cls += ' collapsed';
  card.className = cls;
  card.id = `day-${date}`;

  // 도시 컬러
  const col = cityColor(data.city);
  const cityStyle = col ? `style="background:${col.bg};color:${col.text};"` : '';
  const cityTag = data.city ? `<span class="city-tag" ${cityStyle}>${ic('ic-pin',12)} ${escHtml(data.city)}</span>` : '';

  const weatherBadge = weather
    ? `<span class="weather-badge">${ic(WC_ICONS[weather.code]||'ic-cloud',14)} ${weather.max}°/${weather.min}°</span>` : '';
  const missingBadge = hasMissingAccom && !isReadOnly
    ? `<span class="missing-accom-badge">숙소 미입력</span>` : '';
  const editBtn = isReadOnly ? '' : `<button class="icon-action day-edit-btn" title="편집" onclick="openEditModal('${date}','${tripId}')"><svg class="ic" width="16" height="16"><use href="#ic-edit"/></svg></button>`;
  const collapseIcon = ic('ic-chevron', 14);

  // ── 교통 (일정 타임라인에 시간 있는 할일과 함께 합쳐짐) ──
  const transTimeKey = t => {
    if (t.departDate===date && t.departTime) return t.departTime;
    if (t.arriveDate===date && t.arriveTime) return t.arriveTime;
    return '';
  };
  const transportEntries = dayTrans.map(t => {
    const isDepart = t.departDate===date, isArrive = t.arriveDate===date;
    const badge = (!isDepart&&!isArrive) ? '<span class="transit-day-badge">이동 중</span>' : '';
    const timeStr = [
      isDepart&&t.departTime?`출발 ${t.departTime}`:'',
      isArrive&&t.arriveTime?`도착 ${t.arriveTime}`:''
    ].filter(Boolean).join(' → ');
    // 개별 수정/삭제 아이콘 대신 "Day 수정" 모달에서 그날 교통편을 관리
    // 소요시간은 표시 안 함 — 도시 간 시간대 정보가 없어 국경/시간대 이동 구간에서 값이 틀어질 수 있음
    const html = `<div class="transport-item">
      <div class="transport-route">${ic(TRANS_ICONS[t.type]||'ic-car',15)} <b>${escHtml(t.fromCity||'?')}</b><span class="arrow">→</span><b>${escHtml(t.toCity||'?')}</b>${badge}</div>
      ${timeStr?`<div class="transport-meta">${ic('ic-clock',13)} ${timeStr}</div>`:''}
      ${t.bookingNo?`<div class="transport-booking">${ic('ic-clipboard',13)} ${escHtml(t.bookingNo)}</div>`:''}
      ${memoChip(t.memo)}
    </div>`;
    return { key: transTimeKey(t), html };
  });

  // ── 숙소 (내용 있을 때만) ──
  const accomHtml = data.accommodation ? (() => {
    const t = accomInfo?.type;
    const nameLink = (name, mapUrl) => mapUrl
      ? `<a href="${escHtml(mapUrl)}" target="_blank" rel="noopener" class="accom-link">${escHtml(name)}</a>`
      : escHtml(name);
    const accomMemoHtml = memoChip(data.accommodationMemo);
    if (t === 'transition') {
      // 전환일: 이전 숙소 체크아웃 + 새 숙소 체크인, 카드 하나에 hairline으로 구분
      const nightsTag = accomInfo.nights ? ` <span class="accom-nights">${accomInfo.nights}박</span>` : '';
      return `<div class="accom-card">
        <div class="accom-row"><span class="accom-status-badge checkout">체크아웃</span>${nameLink(accomInfo.prevAccom, accomInfo.prevAccomMap)}</div>
        <div class="accom-row accom-row-divider"><span class="accom-status-badge checkin">체크인</span>${nameLink(data.accommodation, data.accommodationMap)}${nightsTag}</div>
        ${accomMemoHtml}
      </div>`;
    }
    const badge = t === 'checkin'  ? `<span class="accom-status-badge checkin">체크인</span>` :
                  t === 'checkout' ? `<span class="accom-status-badge checkout">체크아웃</span>` : '';
    const nightsTag = (t === 'checkin' && accomInfo.nights) ? ` <span class="accom-nights">${accomInfo.nights}박</span>` : '';
    return `<div class="accom-card"><div class="accom-row">${badge}${nameLink(data.accommodation, data.accommodationMap)}${nightsTag}</div>${accomMemoHtml}</div>`;
  })() : '';

  // ── 메모 (내용 있을 때만) ──
  const memoHtml = data.memo ? `<div class="memo-box">${autoLink(data.memo)}</div>` : '';

  // ── To-Do: 시간 있는 항목은 교통과 합쳐 "일정" 타임라인으로, 없는 항목은 아래 체크리스트로 ──
  const todos = data.todos || [];
  const indexedTodos = todos.map((todo, i) => ({ ...todo, _i: i }));
  const timedTodos   = indexedTodos.filter(t => t.time).sort((a,b) => a.time.localeCompare(b.time));
  const untimedTodos = indexedTodos.filter(t => !t.time);

  const todoRowHtml = (todo, tag, withTime) => `
    <${tag} class="todo-item${todo.done?' done':''}" id="td-${date}-${todo._i}">
      <input type="checkbox" ${todo.done?'checked':''} ${isReadOnly?'disabled':''}
        onchange="toggleTodo('${tripId}','${date}',${todo._i},this.checked)" />
      ${withTime ? `<span class="todo-time">${todo.time}</span>` : ''}
      <label>${escHtml(todo.text)}</label>
    </${tag}>`;

  // ── 일정: 교통 + 시간 등록된 할일을 시간순으로 통합 ──
  const scheduleEntries = [
    ...transportEntries,
    ...timedTodos.map(todo => ({ key: todo.time, html: todoRowHtml(todo, 'div', true) })),
  ].sort((a,b) => a.key.localeCompare(b.key));
  const scheduleHtml = scheduleEntries.length
    ? `<div class="schedule-list">${scheduleEntries.map(e => e.html).join('')}</div>` : '';

  const todoClass = isReadOnly ? 'class="todo-list readonly-todos"' : 'class="todo-list"';
  const untimedTodoItems = untimedTodos.map(todo => todoRowHtml(todo, 'li', false)).join('');
  const addTodoRow = isReadOnly ? '' : `
    <div class="todo-add-row">
      <input class="todo-add-inp" id="ti-${date}" placeholder="할 일 추가... (예: 10:00 박물관 예약)"
        onkeydown="if(event.key==='Enter')addTodo('${tripId}','${date}')" />
      <button class="btn sm icon-btn" onclick="addTodo('${tripId}','${date}')">+</button>
    </div>`;
  const todoHtml = (untimedTodos.length || !isReadOnly) ? `<ul ${todoClass}>${untimedTodoItems}</ul>${addTodoRow}` : '';

  // ── 섹션 조합 (내용 있을 때만 렌더) ──
  const sections = [
    scheduleHtml ? `<div class="day-section"><div class="day-section-label">${ic('ic-clock',13)} 일정</div>${scheduleHtml}</div>` : '',
    accomHtml  ? `<div class="day-section"><div class="day-section-label">${ic('ic-bed',13)} 숙소</div>${accomHtml}</div>` : '',
    memoHtml   ? `<div class="day-section"><div class="day-section-label">${ic('ic-note',13)} 메모</div>${memoHtml}</div>` : '',
    todoHtml   ? `<div class="day-section"><div class="day-section-label">${ic('ic-checklist',13)} To-Do</div>${todoHtml}</div>` : '',
  ].filter(Boolean).join('');

  // ── 요약 줄 (접힌 상태) ──
  const summaryParts = [
    weather ? `${ic(WC_ICONS[weather.code]||'ic-cloud',13)} ${weather.max}°` : '',
    data.accommodation || (hasMissingAccom && !isReadOnly ? '숙소 미정' : ''),
    dayTrans.length ? `${ic(TRANS_ICONS[dayTrans[0].type]||'ic-car',13)} ${escHtml(dayTrans[0].fromCity||'')}→${escHtml(dayTrans[0].toCity||'')}` : '',
  ].filter(Boolean);

  card.innerHTML = `
    <div class="day-card-header" onclick="toggleDayCollapse('${date}',event)">
      <div class="day-label-group">
        <span class="day-label">Day ${dayIndex}</span>
        ${data.theme ? `<span class="day-theme-inline">${escHtml(data.theme)}</span>` : ''}
        <span class="day-label-date">${fmtDateShort(date)}</span>
        ${cityTag}${weatherBadge}${missingBadge}
      </div>
      <div class="day-header-actions" onclick="event.stopPropagation()">
        ${editBtn}
        <button class="icon-action sm collapse-btn" title="${isCollapsed?'펼치기':'접기'}" onclick="toggleDayCollapse('${date}',event)">${collapseIcon}</button>
      </div>
    </div>
    <div class="day-card-summary">${summaryParts.join(' · ') || '내용 없음'}</div>
    <div class="day-sections">${sections}</div>`;
  return card;
}

window.toggleDayCollapse = function(date, e) {
  if (e) e.stopPropagation();
  const card = document.getElementById(`day-${date}`);
  if (!card) return;
  if (expandedDays.has(date)) expandedDays.delete(date);
  else expandedDays.add(date);
  const collapsed = !expandedDays.has(date);
  card.classList.toggle('collapsed', collapsed);
  const btn = card.querySelector('.collapse-btn');
  if (btn) btn.title = collapsed ? '펼치기' : '접기';
};

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
      const today   = todayStr();
      const maxDate = localDateStr(new Date(Date.now()+15*86400000));
      if (!result[city]) result[city] = {};

      const fs = trip.startDate > today ? trip.startDate : today;
      const fe = trip.endDate   < maxDate ? trip.endDate : maxDate;
      if (fs <= fe) {
        const fj = await (await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min&timezone=auto&start_date=${fs}&end_date=${fe}`)).json();
        fj.daily?.time?.forEach((d,i) => { result[city][d] = {code:fj.daily.weathercode[i],max:Math.round(fj.daily.temperature_2m_max[i]),min:Math.round(fj.daily.temperature_2m_min[i])}; });
      }
      const ae = trip.endDate < today ? trip.endDate : localDateStr(new Date(Date.now()-86400000));
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
window.openTransportModal = function(transId, tripId, prefillDate) {
  editingTransId = transId;
  $('modal-transport-title').textContent = transId ? '교통 편집' : '교통 등록';
  const delBtn = $('btn-delete-transport');
  delBtn.style.display = transId ? '' : 'none';
  delBtn.onclick = () => { deleteTransport(transId, tripId); closeTransportModal(); };
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
    const d = prefillDate || currentTripRef?.startDate || '';
    $('inp-trans-depart-date').value = $('inp-trans-arrive-date').value = d;
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
  if (editingTransId) {
    const i=list.findIndex(t=>t.id===editingTransId); if(i>=0) list[i]={...list[i],...payload};
  } else {
    list.push({id:genId(),...payload});
  }
  // Re-sort after save
  list.sort((a,b)=>((a.departDate||'')+(a.departTime||'')).localeCompare((b.departDate||'')+(b.departTime||'')));
  localStorage.setItem(LS_TRANS(tripId), JSON.stringify(list));
  try {
    if (editingTransId) await updateDoc(doc(db,'trips',tripId,'transports',editingTransId), payload);
    else await addDoc(collection(db,'trips',tripId,'transports'), payload);
    showToast('교통 저장됨');
  } catch { showToast('오프라인 — 로컬 저장됨'); }
}

window.deleteTransport = async function(transId, tripId) {
  if (!confirm('이 교통 정보를 삭제할까요?')) return;
  const list = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
  const item = list.find(t=>t.id===transId);
  const newList = list.filter(t=>t.id!==transId);
  localStorage.setItem(LS_TRANS(tripId), JSON.stringify(newList));
  redrawTimeline(tripId);
  scheduleDelete('transport', transId, item, tripId);
  showToast('교통 정보 삭제됨', true);
};

window.copyTransport = function(from, to, booking) {
  const text = [from&&`출발: ${from}`, to&&`도착: ${to}`, booking&&`예약: ${booking}`].filter(Boolean).join('\n');
  navigator.clipboard.writeText(text).then(() => showToast('복사됨'));
};

// ══════════════════════════════════════
//  일정 일괄 편집 (여행 전 계획용)
// ══════════════════════════════════════
function openBulkEditModal(tripId) {
  const days    = generateDays(currentTripRef.startDate, currentTripRef.endDate);
  const dayData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}');

  $('bulk-edit-list').innerHTML = `
    <div class="bulk-fill-row">
      <input class="inp" id="bulk-fill-accom" placeholder="숙소 이름" style="flex:1;min-width:120px;" />
      <input class="inp" id="bulk-fill-map" placeholder="구글맵 링크 (선택)" style="flex:1;min-width:140px;" />
      <input type="date" class="inp" id="bulk-fill-start" style="flex:0 0 132px;" value="${currentTripRef.startDate}" />
      <input type="date" class="inp" id="bulk-fill-end" style="flex:0 0 132px;" value="${currentTripRef.endDate}" />
      <button type="button" class="btn sm ghost" id="btn-bulk-fill">채우기</button>
    </div>
    <div class="bulk-edit-head">
      <span></span><span>도시</span><span>테마</span><span>숙소</span>
    </div>
    <div class="bulk-edit-rows">${days.map(({date, dayIndex}) => {
      const d = dayData[date] || {};
      return `
      <div class="bulk-edit-row" data-date="${date}" data-map="${escHtml(d.accommodationMap||'')}">
        <div class="bulk-edit-daylabel">Day ${dayIndex}<span>${fmtDateShort(date)}</span></div>
        <input class="inp bulk-city"  placeholder="도시" value="${escHtml(d.city||'')}" />
        <input class="inp bulk-theme" placeholder="테마" value="${escHtml(d.theme||'')}" />
        <input class="inp bulk-accom" placeholder="숙소" value="${escHtml(d.accommodation||'')}" />
      </div>`;
    }).join('')}</div>`;

  $('btn-bulk-fill').onclick = () => {
    const name  = $('bulk-fill-accom').value.trim();
    const map   = $('bulk-fill-map').value.trim();
    const start = $('bulk-fill-start').value;
    const end   = $('bulk-fill-end').value;
    if (!name || !start || !end) { showToast('숙소 이름과 날짜 범위를 입력하세요'); return; }
    document.querySelectorAll('.bulk-edit-row').forEach(row => {
      if (row.dataset.date >= start && row.dataset.date <= end) {
        row.querySelector('.bulk-accom').value = name;
        row.dataset.map = map;
      }
    });
  };

  $('btn-save-bulk-edit').onclick = () => saveBulkEdit(tripId);
  $('modal-bulk-edit').classList.add('open');
}

async function saveBulkEdit(tripId) {
  const cacheKey = LS_DAYS(tripId);
  const dayData  = JSON.parse(localStorage.getItem(cacheKey)||'{}');
  const saves = [];

  document.querySelectorAll('.bulk-edit-row').forEach(row => {
    const date  = row.dataset.date;
    const city  = row.querySelector('.bulk-city').value.trim();
    const theme = row.querySelector('.bulk-theme').value.trim();
    const accom = row.querySelector('.bulk-accom').value.trim();
    const map   = row.dataset.map || '';
    const prev  = dayData[date] || {};
    if (prev.city === city && prev.theme === theme && prev.accommodation === accom && (prev.accommodationMap||'') === map) return;
    dayData[date] = { ...prev, city, theme, accommodation: accom, accommodationMap: map };
    saves.push((async () => {
      try {
        const ref = doc(db,'trips',tripId,'days',date);
        try { await updateDoc(ref, {city, theme, accommodation:accom, accommodationMap:map}); }
        catch { await setDoc(ref, dayData[date]); }
      } catch { /* offline */ }
    })());
  });

  if (!saves.length) { $('modal-bulk-edit').classList.remove('open'); showToast('변경 사항 없음'); return; }
  $('modal-bulk-edit').classList.remove('open');
  await Promise.all(saves);
  localStorage.setItem(cacheKey, JSON.stringify(dayData));
  showToast(`${saves.length}일 저장됨`);

  if (currentTripRef) {
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
  }
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
      <button class="icon-action sm danger" title="삭제" onclick="deletePacking('${tripId}',${idx})">${ic('ic-close',14)}</button>
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
function applyPackingTemplate(tripId) {
  if (!currentTripRef.packing) currentTripRef.packing=[];
  const existing = new Set(currentTripRef.packing.map(i=>i.text));
  PACKING_TEMPLATE.filter(t=>!existing.has(t)).forEach(t=>currentTripRef.packing.push({text:t,done:false}));
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
  $('inp-theme').value     = data.theme||'';
  $('inp-city').value       = data.city||'';
  $('inp-accom-name').value = data.accommodation||'';
  $('inp-accom-map').value  = data.accommodationMap||'';
  $('inp-accom-memo').value = data.accommodationMemo||'';
  $('inp-memo').value       = data.memo||'';
  $('inp-todos').value      = (data.todos||[]).map(t => t.time ? `${t.time} ${t.text}` : t.text).join('\n');

  // 그날의 교통편 — 탭하면 해당 편집으로 이동 (개별 카드에서 없앤 수정 진입점을 여기로 통합)
  const dayTrans = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]')
    .filter(t => t.departDate <= date && t.arriveDate >= date)
    .sort((a,b) => ((a.departDate||'')+(a.departTime||'')).localeCompare((b.departDate||'')+(b.departTime||'')));
  $('edit-day-transport-list').innerHTML = dayTrans.length ? dayTrans.map(t => {
    const timeStr = [
      t.departDate===date&&t.departTime?`출발 ${t.departTime}`:'',
      t.arriveDate===date&&t.arriveTime?`도착 ${t.arriveTime}`:''
    ].filter(Boolean).join(' → ');
    return `<button type="button" class="edit-day-trans-row" onclick="closeEditModal();openTransportModal('${t.id}','${tripId}')">
      <span>${ic(TRANS_ICONS[t.type]||'ic-car',14)} ${escHtml(t.fromCity||'?')} → ${escHtml(t.toCity||'?')}</span>
      ${timeStr?`<span class="edit-day-trans-time">${timeStr}</span>`:''}
    </button>`;
  }).join('') : `<div class="t-cap" style="text-transform:none;letter-spacing:normal;margin-top:2px;">등록된 교통편 없음</div>`;
  $('btn-add-trans-inline').onclick = () => { closeEditModal(); openTransportModal(null, tripId, date); };

  $('btn-save-day').onclick = () => saveDayEdit(tripId, date);
  $('modal-edit-day').classList.add('open');
};
window.closeEditModal  = function() { $('modal-edit-day').classList.remove('open'); };

async function saveDayEdit(tripId, date) {
  const prevData = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}')?.[date]||{};
  const todosRaw = $('inp-todos').value.trim();
  const todos    = todosRaw ? todosRaw.split('\n').filter(l=>l.trim()).map(line => {
    const {time, text} = parseTodoInput(line);
    const prev = (prevData.todos||[]).find(t=>t.text===text);
    return { text, done: prev?.done||false, time };
  }) : [];
  const payload = {
    theme:$('inp-theme').value.trim(),
    city:$('inp-city').value.trim(), accommodation:$('inp-accom-name').value.trim(),
    accommodationMap:$('inp-accom-map').value.trim(), accommodationMemo:$('inp-accom-memo').value.trim(),
    memo:$('inp-memo').value.trim(),
    todos,
  };
  closeEditModal();
  const cacheKey = LS_DAYS(tripId);
  const dayData  = JSON.parse(localStorage.getItem(cacheKey)||'{}');
  dayData[date]  = payload;
  localStorage.setItem(cacheKey, JSON.stringify(dayData));
  try {
    const ref = doc(db,'trips',tripId,'days',date);
    try { await updateDoc(ref, payload); } catch { await setDoc(ref, payload); }
    showToast('저장됨');
  } catch { showToast('오프라인 — 로컬 저장됨'); }
  if (currentTripRef) {
    const transData = JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather   = JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
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
  const inp=$(`ti-${date}`), raw=inp?.value.trim(); if(!raw) return;
  const {time, text} = parseTodoInput(raw);
  const cacheKey=LS_DAYS(tripId), dayData=JSON.parse(localStorage.getItem(cacheKey)||'{}');
  if (!dayData[date]) dayData[date]={};
  if (!dayData[date].todos) dayData[date].todos=[];
  dayData[date].todos.push({text,done:false,time}); localStorage.setItem(cacheKey,JSON.stringify(dayData)); inp.value='';
  try { const ref=doc(db,'trips',tripId,'days',date); try{await updateDoc(ref,{todos:dayData[date].todos});}catch{await setDoc(ref,dayData[date]);} } catch {}
  if (currentTripRef) {
    const transData=JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
    const weather=JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
    renderTimeline(generateDays(currentTripRef.startDate,currentTripRef.endDate),dayData,transData,weather,tripId);
  }
};

// ══════════════════════════════════════
//  데이터 백업
// ══════════════════════════════════════
function openDataIOModal(tripId) {
  $('btn-export-json').onclick = () => exportJSON(tripId);
  $('btn-import-json').onclick = () => $('file-import-json').click();
  $('modal-data-io').classList.add('open');
}

function downloadFile(content, filename, type='text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], {type}));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

function exportJSON(tripId) {
  const trip     = currentTripRef || {};
  const dayData  = JSON.parse(localStorage.getItem(LS_DAYS(tripId))||'{}');
  const transData= JSON.parse(localStorage.getItem(LS_TRANS(tripId))||'[]');
  const payload  = { trip, dayData, transData, exportedAt: new Date().toISOString() };
  const name     = (trip.title||'여행').replace(/\s+/g,'_');
  downloadFile(JSON.stringify(payload, null, 2), `${name}_backup.json`, 'application/json');
  showToast('JSON 백업 다운로드됨');
}

async function importJSON(tripId, text) {
  try {
    const data = JSON.parse(text);
    if (!data.dayData) { showToast('유효하지 않은 백업 파일'); return; }
    const cacheKey = LS_DAYS(tripId);
    localStorage.setItem(cacheKey, JSON.stringify(data.dayData));
    if (data.transData) localStorage.setItem(LS_TRANS(tripId), JSON.stringify(data.transData));
    // Sync to Firestore
    const entries = Object.entries(data.dayData);
    for (const [date, dayDoc] of entries) {
      try { const ref = doc(db,'trips',tripId,'days',date); try{await updateDoc(ref,dayDoc);}catch{await setDoc(ref,dayDoc);} } catch {}
    }
    if (data.transData) {
      for (const t of data.transData) {
        try { await setDoc(doc(db,'trips',tripId,'transports',t.id||genId()), t); } catch {}
      }
    }
    if (currentTripRef) {
      const dayData  = data.dayData;
      const transData= data.transData||[];
      const weather  = JSON.parse(localStorage.getItem(LS_WEATHER(tripId))||'{}');
      renderTimeline(generateDays(currentTripRef.startDate, currentTripRef.endDate), dayData, transData, weather, tripId);
    }
    showToast('JSON 백업 복원 완료');
  } catch(err) { showToast('복원 실패: ' + err.message); }
}

// ══════════════════════════════════════
//  이벤트 바인딩
// ══════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  if (!isOnline) { const b=$('offline-banner'); if(b) b.style.display='block'; }

  // 입장 코드
  $('btn-entry-submit').addEventListener('click', handleEntrySubmit);

  // 설정
  $('btn-settings').addEventListener('click', openSettings);
  $('btn-save-settings').addEventListener('click', saveSettings);

  // 대시보드
  $('btn-new-trip').addEventListener('click', openNewTripModal);
  $('btn-cancel-new-trip').addEventListener('click', () => $('modal-new-trip').classList.remove('open'));
  $('btn-save-new-trip').addEventListener('click', saveNewTrip);
  $('inp-trip-title').addEventListener('keydown', e => { if(e.key==='Enter') saveNewTrip(); });

  // 뒤로가기
  $('btn-back').addEventListener('click', () => {
    if(unsubDays)  { unsubDays();  unsubDays=null; }
    if(unsubTrans) { unsubTrans(); unsubTrans=null; }
    currentTripRef=null; navigate(null);
  });

  // 파일 가져오기 핸들러
  $('file-import-json').addEventListener('change', e => {
    const f = e.target.files[0]; if (!f) return;
    const reader = new FileReader();
    reader.onload = ev => importJSON(currentTripId, ev.target.result);
    reader.readAsText(f); e.target.value='';
  });

  // 준비물 템플릿
  $('tpl-basic').addEventListener('click', () => applyPackingTemplate(currentTripId));
  $('btn-clear-packing').addEventListener('click', () => {
    if (!currentTripRef?.packing) return;
    currentTripRef.packing=currentTripRef.packing.filter(i=>!i.done);
    savePacking(currentTripId); renderPackingList(currentTripId);
  });

  boot();
});
