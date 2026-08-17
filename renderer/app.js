'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const MONTHS = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];
const WDAYS_LONG = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

// ── State ──────────────────────────────────────────────────────────────────
let allData      = {};
let curY         = 0;
let curM         = 0;
let selDay       = null;        // { y, m, d, key }
let stickies     = [];          // sticky notes for currently-open day
let transactions = [];          // finance movements for currently-open day
let drawingSnap  = null;        // data-URL of current drawing
let pending      = [];          // global unassigned tasks

// Drawing state
let painting  = false;
let drawColor = '#5B4AE8';
let brushSize = 2;
let erasing   = false;

// Stickies expand state
let activeStickyId   = null;   // id of expanded note/list sticky
let activeDrawSticky = null;   // sticky object for expanded drawing sticky

// Save badge timer
let saveBadgeTimer = null;
let calDebounceTimer = null;

// ── DOM references ─────────────────────────────────────────────────────────
const layout        = document.getElementById('layout');
const daysGrid      = document.getElementById('daysGrid');
const monthName     = document.getElementById('monthName');
const yearNum       = document.getElementById('yearNum');
const homeView      = document.getElementById('homeView');
const panelCol      = document.getElementById('panelCol');
const pWeekday      = document.getElementById('pWeekday');
const pDayname      = document.getElementById('pDayname');
const saveBadge     = document.getElementById('saveBadge');
const canvasWrap    = document.getElementById('canvasWrap');
const drawCanvas    = document.getElementById('drawCanvas');
const ctx           = drawCanvas.getContext('2d');
const stickiesInner = document.getElementById('stickiesInner');
const stickiesEmpty = document.getElementById('stickiesEmpty');
const stickyModal   = document.getElementById('stickyModal');
const drawStickyModal = document.getElementById('drawStickyModal');

// ── Helpers ────────────────────────────────────────────────────────────────
function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function flashSaved() {
  saveBadge.classList.add('visible');
  clearTimeout(saveBadgeTimer);
  saveBadgeTimer = setTimeout(() => saveBadge.classList.remove('visible'), 1800);
}

function fmt(amount) {
  return 'S/. ' + Math.abs(amount).toLocaleString('es-PE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

// ── Calendar data helpers ──────────────────────────────────────────────────
function getDayContent(dd) {
  const sk = dd.stickies || [];
  if (sk.length > 0) {
    return {
      note:  sk.some(s => s.type === 'note' && (s.text || '').trim()),
      check: sk.some(s => s.type === 'list' && (s.items || []).length > 0),
      draw:  sk.some(s => s.type === 'drawing'),
    };
  }
  return {
    note:  !!(dd.note && dd.note.trim()),
    check: !!(dd.tasks && dd.tasks.length > 0),
    draw:  !!dd.hasDrawing,
  };
}

function getDayTasks(dd) {
  const sk = dd.stickies || [];
  if (sk.length > 0) {
    return sk.filter(s => s.type === 'list').flatMap(s =>
      (s.items || []).map(i => ({ t: i.text, d: i.done, stickyId: s.id, itemId: i.id }))
    );
  }
  return (dd.tasks || []).map(t => ({ t: t.t, d: !!t.d }));
}

// ── Calendar render ────────────────────────────────────────────────────────
function renderCal() {
  monthName.textContent = MONTHS[curM];
  yearNum.textContent   = curY;
  daysGrid.innerHTML    = '';

  const today    = new Date();
  const firstDow = new Date(curY, curM, 1).getDay();
  const lastDay  = new Date(curY, curM + 1, 0).getDate();
  const prevLast = new Date(curY, curM, 0).getDate();

  for (let i = firstDow - 1; i >= 0; i--)
    daysGrid.appendChild(makeCell(prevLast - i, true, false, false, null, null));

  for (let d = 1; d <= lastDay; d++) {
    const isToday =
      d === today.getDate() && curM === today.getMonth() && curY === today.getFullYear();
    const isSel  = selDay && selDay.d === d && selDay.m === curM && selDay.y === curY;
    const key    = dateKey(curY, curM, d);
    const dd     = allData[key] || {};
    const dots   = getDayContent(dd);
    const planDate   = `${curY}-${String(curM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const planColors = (window.Plans?.getPlanDates() ?? {})[planDate] ?? [];
    daysGrid.appendChild(makeCell(d, false, isToday, isSel, dots, dd, planColors));
  }

  const total    = firstDow + lastDay;
  const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= trailing; i++)
    daysGrid.appendChild(makeCell(i, true, false, false, null, null));
}

function makeCell(d, other, isToday, isSel, dots, dd, planColors = []) {
  const cell = document.createElement('div');
  cell.className =
    'day-cell' + (other ? ' other' : '') + (isToday ? ' today' : '') + (isSel ? ' sel' : '');

  const num = document.createElement('span');
  num.className   = 'day-num';
  num.textContent = d;
  cell.appendChild(num);

  if (!other && dots) {
    const dotRow = document.createElement('div');
    dotRow.className = 'day-dots';
    if (dots.note)  dotRow.appendChild(makeDot('note'));
    if (dots.check) dotRow.appendChild(makeDot('check'));
    if (dots.draw)  dotRow.appendChild(makeDot('draw'));
    cell.appendChild(dotRow);

    if (dots.note || dots.check || dots.draw)
      cell.appendChild(buildTooltip(dots, dd));

    if (planColors.length > 0) {
      const planRow = document.createElement('div');
      planRow.className = 'plan-dots-row';
      planColors.forEach(c => {
        const dot = document.createElement('span');
        dot.className = 'plan-cal-dot';
        dot.style.background = c;
        planRow.appendChild(dot);
      });
      cell.appendChild(planRow);
    }

    cell.addEventListener('click', () => openDay(curY, curM, d));

    const cellY = curY, cellM = curM;
    cell.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes('pending-task')) return;
      e.preventDefault();
      cell.classList.add('pending-drop');
    });
    cell.addEventListener('dragleave', e => {
      if (!cell.contains(e.relatedTarget)) cell.classList.remove('pending-drop');
    });
    cell.addEventListener('drop', e => {
      cell.classList.remove('pending-drop');
      if (!e.dataTransfer.types.includes('pending-task')) return;
      e.preventDefault();
      assignPendingToDay(e.dataTransfer.getData('pending-task'), cellY, cellM, d);
    });
  }

  return cell;
}

function makeDot(type) {
  const s = document.createElement('span');
  s.className = `dot dot-${type}`;
  return s;
}

function buildTooltip(dots, dd) {
  const tip = document.createElement('div');
  tip.className = 'tip';
  const sk = dd.stickies || [];
  const useSk = sk.length > 0;

  if (dots.note) {
    let preview = '';
    if (useSk) {
      const n = sk.find(s => s.type === 'note' && (s.text || '').trim());
      if (n) preview = n.text.trim().slice(0, 35) + (n.text.trim().length > 35 ? '…' : '');
    } else if (dd.note) {
      preview = dd.note.trim().slice(0, 35) + (dd.note.trim().length > 35 ? '…' : '');
    }
    if (preview) tip.appendChild(tipRow('#FFFFFF', preview, true));
  }
  if (dots.check) {
    let done = 0, total = 0;
    if (useSk) {
      const items = sk.filter(s => s.type === 'list').flatMap(s => s.items || []);
      done  = items.filter(i => i.done).length;
      total = items.length;
    } else {
      const t = dd.tasks || [];
      done  = t.filter(i => i.d).length;
      total = t.length;
    }
    tip.appendChild(tipRow('#2ECC8A', `${done}/${total} tareas`));
  }
  if (dots.draw) tip.appendChild(tipRow('#F0604A', 'Tiene un dibujo'));

  return tip;
}

function tipRow(color, text, bordered = false) {
  const row = document.createElement('div');
  row.className = 'tip-row';
  const dot = document.createElement('span');
  dot.className = 'tip-dot';
  dot.style.background = color;
  if (bordered) dot.style.border = '1.5px solid rgba(255,255,255,.45)';
  const label = document.createElement('span');
  label.textContent = text;
  row.appendChild(dot);
  row.appendChild(label);
  return row;
}

// ── Migration: old note/tasks/hasDrawing → stickies ────────────────────────
function migrateToStickies(dd, key) {
  const list = [];
  let x = 20;
  if (dd.note && dd.note.trim()) {
    list.push({ id: 'leg-note', type: 'note', x, y: 20, text: dd.note });
    x += 205;
  }
  if (dd.tasks && dd.tasks.length > 0) {
    list.push({
      id: 'leg-list', type: 'list', x, y: 20,
      items: dd.tasks.map(t => ({ id: genId(), done: !!t.d, text: t.t || '' })),
    });
    x += 205;
  }
  if (dd.hasDrawing) {
    list.push({ id: 'leg-draw', type: 'drawing', x, y: 20, drawingKey: key });
  }
  return list;
}

// ── Stickies: board render ─────────────────────────────────────────────────
function renderStickies() {
  stickiesInner.innerHTML = '';
  stickiesEmpty.style.display = stickies.length === 0 ? '' : 'none';
  stickies.forEach(s => stickiesInner.appendChild(buildStickyCard(s)));
}

function buildStickyCard(s) {
  const card = document.createElement('div');
  card.className = `sc sc-${s.type}`;
  card.style.left = `${s.x ?? 20}px`;
  card.style.top  = `${s.y ?? 20}px`;
  card.dataset.id = s.id;

  // Drag handle
  const dragHdl = document.createElement('div');
  dragHdl.className = 'sc-drag';
  dragHdl.innerHTML = `<svg class="icon" width="12" height="12"><use href="#ico-grip"/></svg>`;

  // Body (preview)
  const body = document.createElement('div');
  body.className = 'sc-body';

  if (s.type === 'note') {
    const txt = document.createElement('p');
    txt.className = 'sc-note-preview' + ((s.text || '').trim() ? '' : ' empty');
    txt.textContent = (s.text || '').trim() || 'Nota vacía';
    body.appendChild(txt);

  } else if (s.type === 'list') {
    const items = (s.items || []).slice(0, 5);
    if (items.length === 0) {
      const e = document.createElement('div');
      e.className = 'sc-li-empty';
      e.textContent = 'Lista vacía';
      body.appendChild(e);
    } else {
      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'sc-li-row' + (item.done ? ' done' : '');
        const cb = document.createElement('span');
        cb.className = 'sc-li-cb';
        cb.textContent = item.done ? '✓' : '';
        const tx = document.createElement('span');
        tx.className = 'sc-li-text';
        tx.textContent = item.text || '(sin texto)';
        row.appendChild(cb);
        row.appendChild(tx);
        body.appendChild(row);
      });
      const extra = (s.items || []).length - 5;
      if (extra > 0) {
        const more = document.createElement('div');
        more.className = 'sc-li-more';
        more.textContent = `+${extra} más`;
        body.appendChild(more);
      }
    }

  } else if (s.type === 'drawing') {
    const drawWrap = document.createElement('div');
    drawWrap.className = 'sc-draw-wrap';
    const img = document.createElement('img');
    img.className = 'sc-draw-thumb';
    img.alt = '';
    img.style.display = 'none';
    const ph = document.createElement('div');
    ph.className = 'sc-draw-ph';
    ph.innerHTML = `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg><span>Sin dibujo</span>`;
    drawWrap.appendChild(ph);
    drawWrap.appendChild(img);
    body.appendChild(drawWrap);
    const dk = s.drawingKey || selDay?.key;
    if (dk) {
      window.api.getDrawing(dk).then(url => {
        if (url) {
          img.src = url;
          img.style.display = '';
          ph.style.display = 'none';
        }
      });
    }
  }

  // Footer
  const footer = document.createElement('div');
  footer.className = 'sc-footer';
  if (s.type === 'list') {
    const items = s.items || [];
    footer.textContent = `Lista ${items.filter(i => i.done).length}/${items.length}`;
  } else {
    footer.textContent = s.type === 'note' ? 'Nota' : 'Dibujo';
  }

  card.appendChild(dragHdl);
  card.appendChild(body);
  card.appendChild(footer);

  // Click to expand (body + footer, not drag handle)
  const expand = () => expandSticky(s.id);
  body.addEventListener('click', expand);
  footer.addEventListener('click', expand);

  // Drag to reposition
  dragHdl.addEventListener('mousedown', e => {
    e.preventDefault();
    let moved = false;
    const startX = e.clientX, startY = e.clientY;
    const origX = s.x ?? 20, origY = s.y ?? 20;

    function onMove(ev) {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moved && Math.hypot(dx, dy) > 3) moved = true;
      if (moved) {
        s.x = Math.max(0, origX + dx);
        s.y = Math.max(0, origY + dy);
        card.style.left = `${s.x}px`;
        card.style.top  = `${s.y}px`;
      }
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (moved) saveStickiesForDay();
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });

  return card;
}

function refreshCard(s) {
  const existing = stickiesInner.querySelector(`[data-id="${s.id}"]`);
  if (existing) stickiesInner.replaceChild(buildStickyCard(s), existing);
}

function addSticky(type) {
  if (!selDay) return;
  const id     = genId();
  const offset = (stickies.length * 18) % 80;
  const s      = { id, type, x: 20 + offset, y: 20 + offset };
  if (type === 'note')    s.text = '';
  if (type === 'list')    s.items = [];
  if (type === 'drawing') s.drawingKey = `${selDay.key}_${id}`;
  stickies.push(s);
  saveStickiesForDay();
  renderStickies();
  setTimeout(() => expandSticky(id), 50);
}

function saveStickiesForDay() {
  if (!selDay) return;
  if (!allData[selDay.key]) allData[selDay.key] = {};
  allData[selDay.key].stickies = stickies;
  window.api.saveDay(selDay.key, allData[selDay.key]);
  clearTimeout(calDebounceTimer);
  calDebounceTimer = setTimeout(renderCal, 1200);
  flashSaved();
}

// ── Stickies: note/list expand modal ──────────────────────────────────────
const stickyModalBody  = document.getElementById('stickyModalBody');
const stickyModalType  = document.getElementById('stickyModalType');
const stickyModalDel   = document.getElementById('stickyModalDel');
const stickyModalClose = document.getElementById('stickyModalClose');
let stickyAutoSave = null;

function expandSticky(id) {
  const s = stickies.find(s => s.id === id);
  if (!s) return;
  activeStickyId = id;
  if (s.type === 'drawing') openDrawSticky(s);
  else                      openNoteOrListSticky(s);
}

function openNoteOrListSticky(s) {
  stickyModal.style.display = 'flex';
  stickyModalType.textContent = s.type === 'note' ? 'Nota' : 'Lista';
  stickyModalBody.innerHTML = '';

  if (s.type === 'note') {
    const ta = document.createElement('textarea');
    ta.className = 'sk-note-ta';
    ta.placeholder = 'Escribe tu nota aquí...';
    ta.value = s.text || '';
    ta.addEventListener('input', () => {
      s.text = ta.value;
      clearTimeout(stickyAutoSave);
      stickyAutoSave = setTimeout(() => { saveStickiesForDay(); refreshCard(s); }, 600);
    });
    stickyModalBody.appendChild(ta);
    setTimeout(() => ta.focus(), 50);

  } else {
    const clEl = document.createElement('div');
    clEl.className = 'sk-checklist';

    const addBtn = document.createElement('button');
    addBtn.className = 'sk-add-task-btn';
    addBtn.innerHTML = `<svg class="icon" width="12" height="12"><use href="#ico-plus"/></svg> Agregar tarea`;
    addBtn.addEventListener('click', () => {
      s.items = s.items || [];
      s.items.push({ id: genId(), done: false, text: '' });
      saveStickiesForDay();
      renderStickyChecklist(s, clEl);
      const inputs = clEl.querySelectorAll('.sk-ci-label');
      if (inputs.length) inputs[inputs.length - 1].focus();
    });

    stickyModalBody.appendChild(clEl);
    stickyModalBody.appendChild(addBtn);
    renderStickyChecklist(s, clEl);
  }
}

function renderStickyChecklist(s, container) {
  container.innerHTML = '';
  s.items = s.items || [];

  if (s.items.length === 0) {
    const e = document.createElement('div');
    e.className = 'sk-ci-empty';
    e.textContent = 'Sin tareas. Agrega la primera.';
    container.appendChild(e);
    return;
  }

  s.items.forEach((item, i) => {
    const li = document.createElement('div');
    li.className = 'sk-ci' + (item.done ? ' done' : '');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = item.done;
    cb.addEventListener('change', () => {
      s.items[i].done = cb.checked;
      li.classList.toggle('done', cb.checked);
      saveStickiesForDay();
      refreshCard(s);
    });

    const inp = document.createElement('input');
    inp.className = 'sk-ci-label';
    inp.value = item.text;
    inp.placeholder = 'Tarea...';
    inp.addEventListener('input', () => {
      s.items[i].text = inp.value;
      clearTimeout(stickyAutoSave);
      stickyAutoSave = setTimeout(() => { saveStickiesForDay(); refreshCard(s); }, 600);
    });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        s.items.splice(i + 1, 0, { id: genId(), done: false, text: '' });
        renderStickyChecklist(s, container);
        saveStickiesForDay();
        container.querySelectorAll('.sk-ci-label')[i + 1]?.focus();
      }
      if (e.key === 'Backspace' && inp.value === '') {
        e.preventDefault();
        s.items.splice(i, 1);
        renderStickyChecklist(s, container);
        saveStickiesForDay();
        const inputs = container.querySelectorAll('.sk-ci-label');
        if (inputs.length) inputs[Math.max(0, i - 1)]?.focus();
      }
    });

    const del = document.createElement('button');
    del.className = 'sk-ci-del';
    del.setAttribute('aria-label', 'Eliminar');
    del.innerHTML = `<svg class="icon" width="12" height="12"><use href="#ico-x"/></svg>`;
    del.addEventListener('click', () => {
      s.items.splice(i, 1);
      renderStickyChecklist(s, container);
      saveStickiesForDay();
      refreshCard(s);
    });

    li.appendChild(cb);
    li.appendChild(inp);
    li.appendChild(del);
    container.appendChild(li);
  });
}

function closeStickyModal() {
  stickyModal.style.display = 'none';
  const id = activeStickyId;
  activeStickyId = null;
  const s = stickies.find(sk => sk.id === id);
  if (s) refreshCard(s);
}

stickyModalClose.addEventListener('click', closeStickyModal);
document.getElementById('stickyModalBd').addEventListener('click', closeStickyModal);
stickyModalDel.addEventListener('click', () => {
  const id = activeStickyId;
  closeStickyModal();
  stickies = stickies.filter(s => s.id !== id);
  saveStickiesForDay();
  renderStickies();
});

// ── Stickies: drawing expand modal ────────────────────────────────────────
async function openDrawSticky(s) {
  activeDrawSticky = s;
  drawStickyModal.style.display = 'flex';
  const dk = s.drawingKey || selDay?.key;
  drawingSnap = dk ? await window.api.getDrawing(dk) : null;
  requestAnimationFrame(() => {
    resizeCanvas(false);
    loadDrawingOnCanvas();
  });
}

function closeDrawModal() {
  drawStickyModal.style.display = 'none';
  if (activeDrawSticky) refreshCard(activeDrawSticky);
  activeDrawSticky = null;
}

document.getElementById('drawStickyModalClose').addEventListener('click', closeDrawModal);
document.getElementById('drawStickyModalBd').addEventListener('click', closeDrawModal);
document.getElementById('drawStickyModalDel').addEventListener('click', () => {
  const s = activeDrawSticky;
  closeDrawModal();
  if (s) {
    stickies = stickies.filter(sk => sk.id !== s.id);
    saveStickiesForDay();
    renderStickies();
  }
});

// Add-sticky buttons
document.getElementById('addNoteBtn').addEventListener('click', () => addSticky('note'));
document.getElementById('addListBtn').addEventListener('click', () => addSticky('list'));
document.getElementById('addDrawBtn').addEventListener('click', () => addSticky('drawing'));

// ── Open day panel ─────────────────────────────────────────────────────────
async function openDay(y, m, d) {
  const key = dateKey(y, m, d);
  selDay    = { y, m, d, key };
  const dd  = allData[key] || {};

  // Migrate old format on first access
  if (!dd.stickies) {
    const migrated = migrateToStickies(dd, key);
    dd.stickies = migrated;
    allData[key] = { ...(allData[key] || {}), stickies: migrated };
    if (migrated.length > 0) window.api.saveDay(key, allData[key]);
  }

  stickies     = (dd.stickies || []).map(s => ({ ...s, items: (s.items || []).map(i => ({ ...i })) }));
  transactions = (dd.transactions || []).map(tx => ({ ...tx }));

  const date   = new Date(y, m, d);
  pWeekday.textContent = WDAYS_LONG[date.getDay()];
  pDayname.textContent = `${d} de ${MONTHS[m]} ${y}`;

  homeView.style.display    = 'none';
  panelCol.style.display    = 'flex';
  panelCol.style.flexDirection = 'column';
  void panelCol.offsetWidth;
  panelCol.classList.remove('leaving');
  panelCol.classList.add('entering');
  panelCol.addEventListener('animationend', () => panelCol.classList.remove('entering'), { once: true });
  layout.classList.add('day-selected');

  renderCal();
  renderStickies();
  renderDayFinStrip();
  renderDayPlanItems();
}

// ── Close panel ────────────────────────────────────────────────────────────
function closePanel() {
  stickyModal.style.display    = 'none';
  drawStickyModal.style.display = 'none';
  activeDrawSticky = null;
  activeStickyId   = null;

  panelCol.classList.remove('entering');
  panelCol.classList.add('leaving');
  panelCol.addEventListener('animationend', () => {
    panelCol.classList.remove('leaving');
    panelCol.style.display = 'none';
    layout.classList.remove('day-selected');
    selDay = null;
    renderCal();
    homeView.style.display = 'flex';
    void homeView.offsetWidth;
    homeView.classList.add('entering');
    homeView.addEventListener('animationend', () => homeView.classList.remove('entering'), { once: true });
    renderHomeStats();
  }, { once: true });
}

// ── Canvas (drawing) ───────────────────────────────────────────────────────
function resizeCanvas(preserve = true) {
  const rect = canvasWrap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const DPR  = window.devicePixelRatio || 1;
  const newW = Math.round(rect.width  * DPR);
  const newH = Math.round(rect.height * DPR);
  if (drawCanvas.width === newW && drawCanvas.height === newH) return;

  let snap = null;
  if (preserve && drawCanvas.width > 0) {
    try { snap = drawCanvas.toDataURL(); } catch {}
  }
  drawCanvas.width  = newW;
  drawCanvas.height = newH;
  ctx.scale(DPR, DPR);
  if (snap) {
    const img = new Image();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = snap;
  }
}

function loadDrawingOnCanvas() {
  resizeCanvas(false);
  if (drawingSnap) {
    const img  = new Image();
    const rect = canvasWrap.getBoundingClientRect();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = drawingSnap;
  } else {
    const DPR = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, drawCanvas.width / DPR, drawCanvas.height / DPR);
  }
}

let roTimer = null;
const ro = new ResizeObserver(() => {
  if (drawStickyModal.style.display === 'none') return;
  clearTimeout(roTimer);
  roTimer = setTimeout(() => resizeCanvas(true), 80);
});
ro.observe(canvasWrap);

function pointerPos(e) {
  const rect = drawCanvas.getBoundingClientRect();
  const src  = e.touches ? e.touches[0] : e;
  return { x: src.clientX - rect.left, y: src.clientY - rect.top };
}

function startDraw(e) {
  e.preventDefault();
  painting = true;
  const p = pointerPos(e);
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}

function moveDraw(e) {
  if (!painting) return;
  e.preventDefault();
  const p  = pointerPos(e);
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--canvas-bg').trim();
  ctx.lineWidth   = erasing ? brushSize * 6 : brushSize;
  ctx.lineCap     = 'round';
  ctx.lineJoin    = 'round';
  ctx.strokeStyle = erasing ? bg : drawColor;
  ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
}

function endDraw() {
  if (!painting) return;
  painting = false;
  scheduleDrawSave();
}

drawCanvas.addEventListener('mousedown',  startDraw);
drawCanvas.addEventListener('mousemove',  moveDraw);
drawCanvas.addEventListener('mouseup',    endDraw);
drawCanvas.addEventListener('mouseleave', endDraw);
drawCanvas.addEventListener('touchstart', startDraw, { passive: false });
drawCanvas.addEventListener('touchmove',  moveDraw,  { passive: false });
drawCanvas.addEventListener('touchend',   endDraw);

// Drawing toolbar
document.querySelectorAll('.clr').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.clr').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    drawColor = btn.dataset.c;
    erasing   = false;
    document.getElementById('eraserBtn').classList.remove('active');
  });
});

document.querySelectorAll('.sz-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.sz-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    brushSize = parseInt(btn.dataset.s, 10);
  });
});

document.getElementById('eraserBtn').addEventListener('click', () => {
  erasing = !erasing;
  document.getElementById('eraserBtn').classList.toggle('active', erasing);
});

document.getElementById('clearBtn').addEventListener('click', async () => {
  const DPR = window.devicePixelRatio || 1;
  ctx.clearRect(0, 0, drawCanvas.width / DPR, drawCanvas.height / DPR);
  drawingSnap = null;
  if (selDay && activeDrawSticky) {
    const dk = activeDrawSticky.drawingKey || selDay.key;
    await window.api.saveDrawing(dk, null);
    renderCal();
    flashSaved();
  }
});

let drawTimer = null;
function scheduleDrawSave() {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(async () => {
    if (!selDay || !activeDrawSticky) return;
    const dataUrl = drawCanvas.toDataURL('image/png');
    drawingSnap   = dataUrl;
    const dk      = activeDrawSticky.drawingKey || selDay.key;
    await window.api.saveDrawing(dk, dataUrl);
    refreshCard(activeDrawSticky);
    renderCal();
    flashSaved();
  }, 1000);
}

// ── Confirm modal ──────────────────────────────────────────────────────────
(function () {
  const modal   = document.getElementById('confirmModal');
  const bd      = document.getElementById('confirmModalBd');
  const titleEl = document.getElementById('confirmTitle');
  const msgEl   = document.getElementById('confirmMsg');
  const okBtn   = document.getElementById('confirmOk');
  const cancelBtn = document.getElementById('confirmCancel');
  let _resolve = null;

  function closeConfirm(result) {
    modal.style.display = 'none';
    if (_resolve) { _resolve(result); _resolve = null; }
  }

  bd.addEventListener('click', () => closeConfirm(false));
  cancelBtn.addEventListener('click', () => closeConfirm(false));
  okBtn.addEventListener('click', () => closeConfirm(true));
  document.addEventListener('keydown', e => {
    if (modal.style.display !== 'none' && e.key === 'Escape') closeConfirm(false);
  });

  window.showConfirm = function (title, msg, okLabel = 'Borrar') {
    titleEl.textContent = title;
    msgEl.textContent   = msg;
    okBtn.textContent   = okLabel;
    modal.style.display = '';
    cancelBtn.focus();
    return new Promise(res => { _resolve = res; });
  };
})();

// ── Delete helpers ─────────────────────────────────────────────────────────
async function deleteDay() {
  if (!selDay) return;
  const label = `${selDay.d} de ${MONTHS[selDay.m]} ${selDay.y}`;
  const ok = await window.showConfirm(
    'Borrar este dia',
    `Se eliminara todo el contenido del ${label}. Esta accion no se puede deshacer.`
  );
  if (!ok) return;
  const key = selDay.key;
  const dd  = allData[key] || {};
  for (const s of (dd.stickies || [])) {
    if (s.type === 'drawing') await window.api.saveDrawing(s.drawingKey || key, null);
  }
  delete allData[key];
  await window.api.saveDay(key, {});
  closePanel();
}

async function deleteMonth() {
  const label = `${MONTHS[curM]} ${curY}`;
  const ok = await window.showConfirm(
    'Borrar mes completo',
    `Se eliminaran todos los datos de ${label}. Esta accion no se puede deshacer.`
  );
  if (!ok) return;
  const prefix = `${curY}-${String(curM + 1).padStart(2, '0')}-`;
  const keys   = Object.keys(allData).filter(k => k.startsWith(prefix));
  keys.forEach(k => { delete allData[k]; window.api.saveDay(k, {}); });
  if (selDay && selDay.key.startsWith(prefix)) closePanel();
  renderCal();
  renderHomeStats();
}

async function deleteAll() {
  const ok = await window.showConfirm(
    'Borrar todo',
    'Se eliminaran todos los datos de fechas en Calendaria. Esta accion no se puede deshacer.'
  );
  if (!ok) return;
  const dateKeys = Object.keys(allData).filter(k => /^\d{4}-\d{2}-\d{2}$/.test(k));
  dateKeys.forEach(k => { delete allData[k]; window.api.saveDay(k, {}); });
  if (selDay) closePanel();
  renderCal();
  renderHomeStats();
}

// Cal opts dropdown toggle
const calOptsBtn  = document.getElementById('calOptsBtn');
const calOptsMenu = document.getElementById('calOptsMenu');
calOptsBtn.addEventListener('click', e => {
  e.stopPropagation();
  calOptsMenu.style.display = calOptsMenu.style.display === 'none' ? '' : 'none';
});
document.addEventListener('click', () => { calOptsMenu.style.display = 'none'; });
document.getElementById('delMonthBtn').addEventListener('click', () => { calOptsMenu.style.display = 'none'; deleteMonth(); });
document.getElementById('delAllBtn').addEventListener('click',   () => { calOptsMenu.style.display = 'none'; deleteAll(); });
document.getElementById('delDayBtn').addEventListener('click', deleteDay);

// ── Panel close & navigation ───────────────────────────────────────────────
document.getElementById('closeBtn').addEventListener('click', closePanel);

document.getElementById('prevBtn').addEventListener('click', () => {
  curM--;
  if (curM < 0) { curM = 11; curY--; }
  renderCal();
});
document.getElementById('nextBtn').addEventListener('click', () => {
  curM++;
  if (curM > 11) { curM = 0; curY++; }
  renderCal();
});
document.getElementById('todayBtn').addEventListener('click', () => {
  const t = new Date();
  curY = t.getFullYear();
  curM = t.getMonth();
  renderCal();
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (stickyModal.style.display !== 'none')     { closeStickyModal(); return; }
    if (drawStickyModal.style.display !== 'none') { closeDrawModal(); return; }
    if (selDay) closePanel();
  }
});

// ── Theme ──────────────────────────────────────────────────────────────────
let isDark = false;

function applyTheme(dark) {
  isDark = dark;
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
  document.getElementById('themeIcon').setAttribute('href', dark ? '#ico-sun' : '#ico-moon');
  document.getElementById('themeLabel').textContent = dark ? 'Claro' : 'Oscuro';
  window.api.savePrefs({ theme: dark ? 'dark' : 'light' });
}

document.getElementById('themeBtn').addEventListener('click', () => applyTheme(!isDark));

// ── Finance ────────────────────────────────────────────────────────────────
function calcGlobal() {
  let totalIn = 0, totalOut = 0;
  for (const key in allData) {
    if (key.startsWith('__')) continue;
    for (const tx of (allData[key].transactions || [])) {
      if (tx.type === 'ingreso') totalIn  += tx.amount;
      else                       totalOut += tx.amount;
    }
  }
  return { totalIn, totalOut, net: totalIn - totalOut };
}

function calcDay() {
  let totalIn = 0, totalOut = 0;
  for (const tx of transactions) {
    if (tx.type === 'ingreso') totalIn  += tx.amount;
    else                       totalOut += tx.amount;
  }
  return { totalIn, totalOut };
}

function updateBalanceDisplay() {
  const totalEl = document.getElementById('finBalanceTotal');
  const inEl    = document.getElementById('finTotalIn');
  const outEl   = document.getElementById('finTotalOut');
  if (!totalEl) return;
  const g = calcGlobal();
  totalEl.textContent = fmt(g.net);
  inEl.textContent    = fmt(g.totalIn);
  outEl.textContent   = fmt(g.totalOut);
}

// ── Tareas de planes para el dia seleccionado ─────────────────────────────
function renderDayPlanItems() {
  const section = document.getElementById('dayPlanSection');
  const list    = document.getElementById('dayPlanList');
  if (!section || !list || !selDay) { if (section) section.style.display = 'none'; return; }

  const dateStr = selDay.y + '-' + String(selDay.m + 1).padStart(2, '0') + '-' + String(selDay.d).padStart(2, '0');
  const groups  = window.Plans?.getItemsForDate?.(dateStr) || [];

  if (!groups.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  list.innerHTML = '';

  for (const { plan, node } of groups) {
    const group = document.createElement('div');
    group.className = 'dps-group';
    group.style.setProperty('--pc', plan.color);

    const hdr = document.createElement('div');
    hdr.className = 'dps-group-hdr';

    const dot = document.createElement('span');
    dot.className = 'dps-dot';

    const planName = document.createElement('span');
    planName.className = 'dps-plan-name';
    planName.textContent = plan.title;

    const sep = document.createElement('span');
    sep.className = 'dps-sep';
    sep.textContent = '·';

    const nodeName = document.createElement('span');
    nodeName.className = 'dps-node-name';
    nodeName.textContent = node.title;

    hdr.append(dot, planName, sep, nodeName);
    group.appendChild(hdr);

    for (const item of (node.items || [])) {
      const row = document.createElement('div');
      row.className = 'dps-item' + (item.done ? ' done' : '');

      const cb = document.createElement('div');
      cb.className = 'dps-cb' + (item.done ? ' done' : '');
      if (item.done) cb.innerHTML = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      cb.addEventListener('click', () => {
        window.Plans?.toggleItem(node.id, item.id);
        renderDayPlanItems();
      });

      const txt = document.createElement('span');
      txt.className = 'dps-txt';
      txt.textContent = item.text;

      row.append(cb, txt);
      group.appendChild(row);
    }

    list.appendChild(group);
  }
}

function renderDayFinStrip() {
  const d   = calcDay();
  const inEl  = document.getElementById('fdayIn');
  const outEl = document.getElementById('fdayOut');
  if (inEl)  inEl.textContent  = fmt(d.totalIn);
  if (outEl) outEl.textContent = fmt(d.totalOut);
}

function buildTxItem(tx, dayKey) {
  const el = document.createElement('div');
  el.className = 'fin-item';
  const ts        = new Date(tx.createdAt);
  const timeStr   = ts.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  const dateStr   = ts.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
  const isDigital = tx.method === 'digital';

  el.innerHTML = `
    <div class="fin-item-icon ${tx.type}">
      <svg class="icon" width="13" height="13"><use href="#ico-${tx.type === 'ingreso' ? 'up' : 'down'}"/></svg>
    </div>
    <div class="fin-item-info">
      <span class="fin-item-desc">${tx.description || 'Sin descripción'}</span>
      <span class="fin-item-meta">
        <span class="fin-method-badge ${isDigital ? 'digital' : 'fisico'}">${isDigital ? 'Digital' : 'Físico'}</span>
        · ${dateStr} ${timeStr}
      </span>
    </div>
    <span class="fin-item-amount ${tx.type}">${tx.type === 'ingreso' ? '+' : '−'}${fmt(tx.amount)}</span>
    <button class="fin-item-del" aria-label="Eliminar movimiento">
      <svg class="icon" width="12" height="12"><use href="#ico-x"/></svg>
    </button>`;

  el.querySelector('.fin-item-del').addEventListener('click', () => {
    if (!allData[dayKey]) return;
    allData[dayKey].transactions = (allData[dayKey].transactions || []).filter(t => t.id !== tx.id);
    if (selDay && selDay.key === dayKey) {
      transactions = allData[dayKey].transactions.map(t => ({ ...t }));
      renderDayFinStrip();
    }
    window.api.saveDay(dayKey, allData[dayKey]);
    renderFinanceView();
    renderCal();
  });

  return el;
}

function renderFinanceView() {
  updateBalanceDisplay();
  const list = document.getElementById('fvHistoryList');
  if (!list) return;
  list.innerHTML = '';

  const byDay = [];
  for (const key in allData) {
    if (key.startsWith('__')) continue;
    const txs = allData[key].transactions;
    if (txs && txs.length > 0) byDay.push({ key, txs: [...txs] });
  }
  byDay.sort((a, b) => b.key.localeCompare(a.key));

  if (byDay.length === 0) {
    const e = document.createElement('div');
    e.className = 'fv-empty';
    e.textContent = 'No hay movimientos registrados';
    list.appendChild(e);
    return;
  }

  for (const { key, txs } of byDay) {
    const [y, mo, d] = key.split('-').map(Number);
    const dt      = new Date(y, mo - 1, d);
    const dayName = dt.toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long' });

    let dayIn = 0, dayOut = 0;
    txs.forEach(tx => { if (tx.type === 'ingreso') dayIn += tx.amount; else dayOut += tx.amount; });
    const dayNet = dayIn - dayOut;

    const grp = document.createElement('div');
    grp.className = 'fv-day-group';

    const hdr = document.createElement('div');
    hdr.className = 'fv-day-hdr';
    const nm = document.createElement('span');
    nm.className = 'fv-day-name';
    nm.textContent = dayName;
    const net = document.createElement('span');
    net.className = 'fv-day-net ' + (dayNet >= 0 ? 'positive' : 'negative');
    net.textContent = (dayNet >= 0 ? '+' : '−') + fmt(Math.abs(dayNet));
    hdr.appendChild(nm);
    hdr.appendChild(net);
    grp.appendChild(hdr);

    [...txs].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .forEach(tx => grp.appendChild(buildTxItem(tx, key)));

    list.appendChild(grp);
  }
}

function addTransaction() {
  const typeBtn   = document.querySelector('.fin-type.active');
  const methodBtn = document.querySelector('.fin-method.active');
  const amountInp = document.getElementById('txAmount');
  const descInp   = document.getElementById('txDesc');
  const dateInp   = document.getElementById('txDate');

  const amount = parseFloat(amountInp.value);
  if (isNaN(amount) || amount <= 0) {
    amountInp.parentElement.classList.add('error');
    setTimeout(() => amountInp.parentElement.classList.remove('error'), 800);
    amountInp.focus();
    return;
  }

  let targetKey;
  if (dateInp?.value) {
    const [y, mo, d] = dateInp.value.split('-').map(Number);
    targetKey = dateKey(y, mo - 1, d);
  } else {
    const t = new Date();
    targetKey = dateKey(t.getFullYear(), t.getMonth(), t.getDate());
  }

  const tx = {
    id:          genId(),
    type:        typeBtn.dataset.type,
    method:      methodBtn.dataset.method,
    amount,
    description: descInp.value.trim(),
    createdAt:   new Date().toISOString(),
  };

  if (!allData[targetKey]) allData[targetKey] = { stickies: [], transactions: [] };
  if (!allData[targetKey].transactions) allData[targetKey].transactions = [];
  allData[targetKey].transactions.push(tx);

  if (selDay && selDay.key === targetKey) {
    transactions = [...allData[targetKey].transactions];
    renderDayFinStrip();
  }

  amountInp.value = '';
  descInp.value   = '';
  amountInp.focus();

  window.api.saveDay(targetKey, allData[targetKey]);
  renderFinanceView();
  renderCal();
}

// Finance form listeners
document.querySelectorAll('.fin-type').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fin-type').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});
document.querySelectorAll('.fin-method').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.fin-method').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
  });
});
document.getElementById('txAddBtn').addEventListener('click', addTransaction);
document.getElementById('txAmount').addEventListener('keydown', e => { if (e.key === 'Enter') addTransaction(); });
document.getElementById('txDesc').addEventListener('keydown', e => { if (e.key === 'Enter') addTransaction(); });

// Finance view toggle
function openFinanceView() {
  // Close plans / presupuesto if open
  if (document.getElementById('plansView')?.classList.contains('active'))
    window.Plans?.closeView();
  if (document.getElementById('presupuestoView')?.classList.contains('active'))
    window.Presupuesto?.closeView();

  layout.style.display = 'none';
  document.getElementById('financeView').classList.add('active');
  document.getElementById('finanzasBtn').classList.add('active');

  // Pre-fill date with selected day if available
  const di = document.getElementById('txDate');
  if (di && selDay) {
    di.value = `${selDay.y}-${String(selDay.m + 1).padStart(2,'0')}-${String(selDay.d).padStart(2,'0')}`;
  } else if (di && !di.value) {
    const t = new Date();
    di.value = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(t.getDate()).padStart(2,'0')}`;
  }

  renderFinanceView();
}

function closeFinanceView() {
  document.getElementById('financeView').classList.remove('active');
  document.getElementById('finanzasBtn').classList.remove('active');
  layout.style.display = '';
}

document.getElementById('fdayOpenFinBtn').addEventListener('click', openFinanceView);

// ── Home stats ─────────────────────────────────────────────────────────────
function renderHomeStats() {
  const today = new Date();
  const tKey  = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const dd    = allData[tKey] || {};

  const wkdayEl = document.getElementById('hvWeekday');
  const dateEl  = document.getElementById('hvDateStr');
  if (wkdayEl) {
    const wk = today.toLocaleDateString('es-PE', { weekday: 'long' });
    wkdayEl.textContent = wk.charAt(0).toUpperCase() + wk.slice(1);
  }
  if (dateEl) {
    dateEl.textContent = today.toLocaleDateString('es-PE', {
      day: 'numeric', month: 'long', year: 'numeric',
    });
  }

  const todayTasks   = getDayTasks(dd);
  const pendingCount = todayTasks.filter(t => !t.d).length;
  const doneCount    = todayTasks.filter(t =>  t.d).length;
  const pendEl = document.getElementById('hsTasksPending');
  const doneEl = document.getElementById('hsTasksDone');
  if (pendEl) pendEl.textContent = pendingCount;
  if (doneEl) doneEl.textContent = doneCount;

  const txs    = dd.transactions || [];
  const dayNet = txs.reduce((s, tx) => s + (tx.type === 'ingreso' ? tx.amount : -tx.amount), 0);
  const balEl  = document.getElementById('hsDayBalance');
  if (balEl) {
    if (txs.length > 0) {
      balEl.textContent = (dayNet >= 0 ? '+' : '−') + fmt(Math.abs(dayNet));
      balEl.style.color = dayNet >= 0 ? 'var(--green)' : 'var(--red)';
    } else {
      balEl.textContent = '—';
      balEl.style.color = '';
    }
  }

  const listEl = document.getElementById('hsTodayList');
  if (listEl) {
    listEl.innerHTML = '';
    todayTasks.slice(0, 5).forEach((task, idx) => {
      const item = document.createElement('div');
      item.className = 'hv-task-item' + (task.d ? ' done' : '');

      const cb = document.createElement('input');
      cb.type    = 'checkbox';
      cb.checked = task.d;
      cb.addEventListener('change', async () => {
        if (!allData[tKey]) return;
        const sk = allData[tKey].stickies || [];
        if (sk.length > 0 && task.stickyId && task.itemId) {
          const s  = sk.find(s => s.id === task.stickyId);
          const it = s && (s.items || []).find(i => i.id === task.itemId);
          if (it) it.done = cb.checked;
        } else if (allData[tKey].tasks) {
          allData[tKey].tasks[idx].d = cb.checked;
        }
        item.classList.toggle('done', cb.checked);
        await window.api.saveDay(tKey, allData[tKey]);
        renderHomeStats();
        renderCal();
      });

      const text = document.createElement('span');
      text.textContent = task.t || '(sin texto)';
      item.appendChild(cb);
      item.appendChild(text);
      listEl.appendChild(item);
    });

    if (todayTasks.length === 0) {
      const empty = document.createElement('div');
      empty.className   = 'hv-empty';
      empty.textContent = 'Sin tareas para hoy';
      listEl.appendChild(empty);
    } else if (todayTasks.length > 5) {
      const more = document.createElement('div');
      more.className   = 'hv-more';
      more.textContent = `+${todayTasks.length - 5} más`;
      listEl.appendChild(more);
    }
  }

  renderPending();
}

// ── Pending tasks ──────────────────────────────────────────────────────────
async function savePendingTasks() {
  allData['__pending__'] = pending;
  await window.api.savePending(pending);
}

function renderPending() {
  const list = document.getElementById('pendingList');
  const hint = document.getElementById('pendingHint');
  if (!list) return;
  list.innerHTML = '';
  if (hint) hint.style.display = pending.length > 0 ? '' : 'none';

  if (pending.length === 0) {
    const empty = document.createElement('div');
    empty.className   = 'pending-empty';
    empty.textContent = 'Sin tareas sueltas';
    list.appendChild(empty);
    return;
  }

  pending.forEach((pt, i) => {
    const item = document.createElement('div');
    item.className = 'pending-item';
    item.draggable = true;
    let fromHandle = false;

    const drag = document.createElement('div');
    drag.className = 'pending-drag';
    drag.title     = 'Arrastra al calendario para asignar un día';
    drag.innerHTML = `<svg class="icon" width="13" height="13"><use href="#ico-grip"/></svg>`;
    drag.addEventListener('mousedown', () => { fromHandle = true; });

    const text = document.createElement('span');
    text.className   = 'pending-text';
    text.textContent = pt.t;

    const del = document.createElement('button');
    del.className = 'pending-del';
    del.setAttribute('aria-label', 'Eliminar');
    del.innerHTML = `<svg class="icon" width="12" height="12"><use href="#ico-x"/></svg>`;
    del.addEventListener('click', async () => {
      pending.splice(i, 1);
      await savePendingTasks();
      renderPending();
    });

    item.addEventListener('dragstart', e => {
      if (!fromHandle) { e.preventDefault(); return; }
      fromHandle = false;
      e.dataTransfer.setData('pending-task', pt.id);
      e.dataTransfer.effectAllowed = 'move';
      requestAnimationFrame(() => item.classList.add('dragging'));
    });
    item.addEventListener('dragend', () => { fromHandle = false; item.classList.remove('dragging'); });

    item.appendChild(drag);
    item.appendChild(text);
    item.appendChild(del);
    list.appendChild(item);
  });
}

async function assignPendingToDay(pid, y, m, d) {
  const idx = pending.findIndex(p => p.id === pid);
  if (idx === -1) return;
  const [pt] = pending.splice(idx, 1);
  const key  = dateKey(y, m, d);

  if (!allData[key]) allData[key] = { stickies: [], transactions: [] };

  // Add task to first existing list sticky, or create one
  let listSk = (allData[key].stickies || []).find(s => s.type === 'list');
  if (!listSk) {
    listSk = { id: genId(), type: 'list', x: 20, y: 20, items: [] };
    if (!allData[key].stickies) allData[key].stickies = [];
    allData[key].stickies.push(listSk);
  }
  listSk.items.push({ id: genId(), done: false, text: pt.t });

  if (selDay && selDay.key === key) {
    stickies = allData[key].stickies.map(s => ({ ...s, items: (s.items || []).map(i => ({ ...i })) }));
    renderStickies();
  }

  await Promise.all([window.api.saveDay(key, allData[key]), savePendingTasks()]);
  renderPending();
  renderCal();
}

document.getElementById('hvOpenTodayBtn').addEventListener('click', () => {
  const t = new Date();
  openDay(t.getFullYear(), t.getMonth(), t.getDate());
});

document.getElementById('pendingAddBtn').addEventListener('click', () => {
  const input = document.getElementById('pendingInput');
  const visible = input.style.display !== 'none';
  input.style.display = visible ? 'none' : '';
  if (!visible) input.focus();
});

document.getElementById('pendingInput').addEventListener('keydown', async e => {
  if (e.key === 'Enter') {
    const val = e.target.value.trim();
    if (!val) return;
    pending.push({ id: genId(), t: val, createdAt: new Date().toISOString() });
    e.target.value = '';
    e.target.style.display = 'none';
    await savePendingTasks();
    renderPending();
  }
  if (e.key === 'Escape') {
    e.target.value = '';
    e.target.style.display = 'none';
  }
});

// ── Auth overlay (PWA only) ────────────────────────────────────────────────
function showAuthOverlay() {
  return new Promise(resolve => {
    const overlay   = document.getElementById('authOverlay');
    const form      = document.getElementById('authForm');
    const errEl     = document.getElementById('authError');
    const submitBtn = document.getElementById('authSubmitBtn');
    const toggleBtn = document.getElementById('authToggleBtn');
    let isSignUp = false;
    overlay.style.display = 'flex';

    toggleBtn.addEventListener('click', () => {
      isSignUp = !isSignUp;
      submitBtn.textContent = isSignUp ? 'Crear cuenta' : 'Iniciar sesion';
      toggleBtn.textContent = isSignUp ? 'Ya tengo cuenta' : 'Crear cuenta nueva';
      errEl.textContent = '';
    });

    form.addEventListener('submit', async e => {
      e.preventDefault();
      errEl.textContent = '';
      submitBtn.disabled = true;
      const email = document.getElementById('authEmail').value.trim();
      const pass  = document.getElementById('authPass').value;
      try {
        if (isSignUp) {
          await window.WebAuth.signUp(email, pass);
          errEl.style.color = 'var(--green)';
          errEl.textContent = 'Cuenta creada. Revisa tu correo para confirmar.';
          submitBtn.disabled = false;
          return;
        }
        await window.WebAuth.signIn(email, pass);
        overlay.style.display = 'none';
        resolve();
      } catch (err) {
        errEl.style.color = '';
        errEl.textContent = err.message || 'Error al iniciar sesion';
        submitBtn.disabled = false;
      }
    });
  });
}

// ── Init ───────────────────────────────────────────────────────────────────
(async function init() {
  const now = new Date();
  curY = now.getFullYear();
  curM = now.getMonth();

  if (window.WebAuth) {
    const { data: { session } } = await window.WebAuth.sb.auth.getSession();
    if (!session) await showAuthOverlay();
    document.getElementById('logoutBtn').style.display = '';
    document.getElementById('logoutBtn').addEventListener('click', () => window.WebAuth.signOut());
    window.WebAuth.startSync();
  }

  window.addEventListener('supa-sync', e => {
    const { key, data } = e.detail;
    allData[key] = data;
    if (key === '__pending__') { pending = Array.isArray(data) ? data : []; renderPending(); }
    if (key === '__plans__')   { window.Plans?.load(data); renderDayPlanItems(); }
    renderCal();
    renderHomeStats();
    if (selDay && selDay.key === key) {
      const ae = document.activeElement;
      const editing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || !!ae.closest('.sk-modal'));
      if (!editing) openDay(selDay.y, selDay.m, selDay.d);
    }
  });

  window.addEventListener('plans-changed',       () => renderCal());
  window.addEventListener('plans-items-changed', () => renderDayPlanItems());

  const [data, prefs] = await Promise.all([window.api.getData(), window.api.getPrefs()]);
  allData = data || {};
  pending = allData['__pending__'] || [];

  window.Plans?.init();
  window.Plans?.load(allData['__plans__'] ?? null);

  window.Presupuesto?.init();
  window.Presupuesto?.load(allData['__presupuesto__'] ?? null);

  document.getElementById('planesBtn')?.addEventListener('click', () => {
    const plansActive = document.getElementById('plansView')?.classList.contains('active');
    if (plansActive) {
      window.Plans?.closeView();
    } else {
      if (document.getElementById('financeView').classList.contains('active')) closeFinanceView();
      if (document.getElementById('presupuestoView')?.classList.contains('active'))
        window.Presupuesto?.closeView();
      window.Plans?.openView();
    }
  });

  document.getElementById('finanzasBtn')?.addEventListener('click', () => {
    const fv = document.getElementById('financeView');
    if (fv.classList.contains('active')) closeFinanceView();
    else openFinanceView();
  });

  document.getElementById('presupuestoBtn')?.addEventListener('click', () => {
    const pv = document.getElementById('presupuestoView');
    if (pv?.classList.contains('active')) {
      window.Presupuesto?.closeView();
    } else {
      if (document.getElementById('financeView').classList.contains('active')) closeFinanceView();
      if (document.getElementById('plansView')?.classList.contains('active'))
        window.Plans?.closeView();
      window.Presupuesto?.openView();
    }
  });

  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = prefs.theme === 'dark' || (prefs.theme !== 'light' && sysDark);
  if (useDark) applyTheme(true);

  renderCal();
  renderHomeStats();
})();
