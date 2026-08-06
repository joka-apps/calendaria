'use strict';

// ── Constants ──────────────────────────────────────────────────────────────
const MONTHS = [
  'Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre',
];
const WDAYS_SHORT = ['Dom','Lun','Mar','Mié','Jue','Vie','Sáb'];
const WDAYS_LONG  = ['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];

// ── State ──────────────────────────────────────────────────────────────────
let allData  = {};       // { [YYYY-MM-DD]: { note, tasks, hasDrawing } }
let curY     = 0;
let curM     = 0;
let selDay   = null;     // { y, m, d, key } or null
let tasks    = [];       // tasks for currently-open day
let saveTimer  = null;
let drawTimer  = null;
let dragSrcIdx   = null; // index of the task being dragged
let transactions = [];  // financial movements for the open day
let drawingSnap = null;  // current data-URL of the drawing for open day
let pending  = [];       // global unassigned tasks (no specific day)

// Drawing state
let painting     = false;
let drawColor    = '#5B4AE8';
let brushSize    = 2;
let erasing      = false;

// ── DOM references ─────────────────────────────────────────────────────────
const layout      = document.getElementById('layout');
const daysGrid    = document.getElementById('daysGrid');
const monthName   = document.getElementById('monthName');
const yearNum     = document.getElementById('yearNum');
const homeView    = document.getElementById('homeView');
const panelCol    = document.getElementById('panelCol');
const pWeekday    = document.getElementById('pWeekday');
const pDayname    = document.getElementById('pDayname');
const saveBadge   = document.getElementById('saveBadge');
const notesArea   = document.getElementById('notesArea');
const checklist   = document.getElementById('checklist');
const canvasWrap  = document.getElementById('canvasWrap');
const drawCanvas  = document.getElementById('drawCanvas');
const ctx         = drawCanvas.getContext('2d');

// ── Date key helper ────────────────────────────────────────────────────────
function dateKey(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// ── Calendar render ────────────────────────────────────────────────────────
function renderCal() {
  monthName.textContent = MONTHS[curM];
  yearNum.textContent   = curY;
  daysGrid.innerHTML    = '';

  const today  = new Date();
  const firstDow = new Date(curY, curM, 1).getDay();
  const lastDay  = new Date(curY, curM + 1, 0).getDate();
  const prevLast = new Date(curY, curM, 0).getDate();

  // trailing cells from previous month
  for (let i = firstDow - 1; i >= 0; i--) {
    daysGrid.appendChild(makeCell(prevLast - i, true, false, false, null, null));
  }

  // this month's days
  for (let d = 1; d <= lastDay; d++) {
    const isToday =
      d === today.getDate() &&
      curM === today.getMonth() &&
      curY === today.getFullYear();
    const isSel = selDay && selDay.d === d && selDay.m === curM && selDay.y === curY;
    const key   = dateKey(curY, curM, d);
    const dd    = allData[key] || {};
    const dots  = {
      note:  !!(dd.note && dd.note.trim()),
      check: !!(dd.tasks && dd.tasks.length > 0),
      draw:  !!dd.hasDrawing,
    };
    daysGrid.appendChild(makeCell(d, false, isToday, isSel, dots, dd));
  }

  // leading cells for next month
  const total   = firstDow + lastDay;
  const trailing = total % 7 === 0 ? 0 : 7 - (total % 7);
  for (let i = 1; i <= trailing; i++) {
    daysGrid.appendChild(makeCell(i, true, false, false, null, null));
  }
}

function makeCell(d, other, isToday, isSel, dots, dd) {
  const cell = document.createElement('div');
  cell.className =
    'day-cell' +
    (other   ? ' other' : '') +
    (isToday ? ' today' : '') +
    (isSel   ? ' sel'   : '');

  // number
  const num = document.createElement('span');
  num.className   = 'day-num';
  num.textContent = d;
  cell.appendChild(num);

  if (!other && dots) {
    // dots row
    const dotRow = document.createElement('div');
    dotRow.className = 'day-dots';
    if (dots.note)  dotRow.appendChild(makeDot('note'));
    if (dots.check) dotRow.appendChild(makeDot('check'));
    if (dots.draw)  dotRow.appendChild(makeDot('draw'));
    cell.appendChild(dotRow);

    // tooltip (only if any content)
    if (dots.note || dots.check || dots.draw) {
      const tip = buildTooltip(dots, dd);
      cell.appendChild(tip);
    }

    cell.addEventListener('click', () => openDay(curY, curM, d));

    // Accept pending-task drops from the home panel
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

  if (dots.note && dd.note) {
    const preview = dd.note.trim().slice(0, 35) + (dd.note.trim().length > 35 ? '…' : '');
    tip.appendChild(tipRow('#FFFFFF', preview, true));
  }
  if (dots.check) {
    const done  = (dd.tasks || []).filter(t => t.d).length;
    const total = (dd.tasks || []).length;
    tip.appendChild(tipRow('#2ECC8A', `${done}/${total} tareas`));
  }
  if (dots.draw) {
    tip.appendChild(tipRow('#F0604A', 'Tiene un dibujo'));
  }

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

// ── Open day panel ─────────────────────────────────────────────────────────
async function openDay(y, m, d) {
  const key = dateKey(y, m, d);
  selDay    = { y, m, d, key };

  const dd  = allData[key] || { note: '', tasks: [], hasDrawing: false };
  tasks        = (dd.tasks         || []).map(t  => ({ ...t  }));
  transactions = (dd.transactions  || []).map(tx => ({ ...tx }));

  // Header
  const date  = new Date(y, m, d);
  pWeekday.textContent = WDAYS_LONG[date.getDay()];
  pDayname.textContent = `${d} de ${MONTHS[m]} ${y}`;

  // Notes
  notesArea.value = dd.note || '';

  // Checklist
  renderChecklist();

  // Reset draw state
  drawingSnap = null;
  erasing     = false;
  document.getElementById('eraserBtn').classList.remove('active');

  // Swap: hide home view, show day panel (animate in)
  homeView.style.display = 'none';
  panelCol.style.display    = 'flex';
  panelCol.style.flexDirection = 'column';
  void panelCol.offsetWidth; // force reflow before animation
  panelCol.classList.remove('leaving');
  panelCol.classList.add('entering');
  panelCol.addEventListener('animationend', () => panelCol.classList.remove('entering'), { once: true });

  layout.classList.add('day-selected');
  renderCal();

  // Finance: render list and update balance summary
  renderTransactions();

  // Load drawing asynchronously
  drawingSnap = await window.api.getDrawing(key);

  // If draw tab is already active, render it
  if (document.getElementById('tab-draw').classList.contains('active')) {
    requestAnimationFrame(() => loadDrawingOnCanvas());
  }
}

// ── Close panel ────────────────────────────────────────────────────────────
function closePanel() {
  panelCol.classList.remove('entering');
  panelCol.classList.add('leaving');

  panelCol.addEventListener('animationend', () => {
    panelCol.classList.remove('leaving');
    panelCol.style.display = 'none';
    layout.classList.remove('day-selected');
    selDay = null;
    renderCal();
    // Bring back home view with a fade-in
    homeView.style.display = 'flex';
    void homeView.offsetWidth;
    homeView.classList.add('entering');
    homeView.addEventListener('animationend', () => homeView.classList.remove('entering'), { once: true });
    renderHomeStats();
  }, { once: true });
}

// ── Tabs ───────────────────────────────────────────────────────────────────
document.querySelectorAll('.tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(t => {
      t.classList.remove('active');
      t.setAttribute('aria-selected', 'false');
    });
    document.querySelectorAll('.tab-body').forEach(b => b.classList.remove('active'));

    tab.classList.add('active');
    tab.setAttribute('aria-selected', 'true');

    const body = document.getElementById('tab-' + tab.dataset.tab);
    body.classList.add('active');

    if (tab.dataset.tab === 'finance') {
      renderTransactions();
    }

    if (tab.dataset.tab === 'draw') {
      requestAnimationFrame(() => requestAnimationFrame(() => {
        resizeCanvas(false);
        if (drawingSnap) {
          const img = new Image();
          img.onload = () => {
            const dpr = window.devicePixelRatio || 1;
            ctx.drawImage(img, 0, 0, drawCanvas.width / dpr, drawCanvas.height / dpr);
          };
          img.src = drawingSnap;
        }
      }));
    }
  });
});

// ── Auto-save: notes + tasks ───────────────────────────────────────────────
function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!selDay) return;
    const dayData = {
      note: notesArea.value,
      tasks,
      transactions,
      hasDrawing: (allData[selDay.key] || {}).hasDrawing || false,
    };
    allData[selDay.key] = { ...(allData[selDay.key] || {}), ...dayData };
    await window.api.saveDay(selDay.key, dayData);
    renderCal();
    flashSaved();
    // Keep home stats current if today's data changed
    const t = new Date();
    if (selDay.key === dateKey(t.getFullYear(), t.getMonth(), t.getDate())) {
      renderHomeStats();
    }
  }, 650);
}

// ── Auto-save: drawing ─────────────────────────────────────────────────────
function scheduleDrawSave() {
  clearTimeout(drawTimer);
  drawTimer = setTimeout(async () => {
    if (!selDay) return;
    const dataUrl = drawCanvas.toDataURL('image/png');
    drawingSnap   = dataUrl;
    const hasD    = await window.api.saveDrawing(selDay.key, dataUrl);
    if (!allData[selDay.key]) allData[selDay.key] = { note: '', tasks: [], hasDrawing: false };
    allData[selDay.key].hasDrawing = hasD;
    renderCal();
    flashSaved();
  }, 1000);
}

function flashSaved() {
  saveBadge.classList.add('visible');
  clearTimeout(saveBadge._t);
  saveBadge._t = setTimeout(() => saveBadge.classList.remove('visible'), 1800);
}

// ── Checklist render ───────────────────────────────────────────────────────
function renderChecklist() {
  checklist.innerHTML = '';

  tasks.forEach((item, i) => {
    const li = document.createElement('div');
    li.className  = 'ci' + (item.d ? ' done' : '');
    li.draggable  = true;

    // ── drag handle ──
    let fromHandle = false;
    const handle = document.createElement('div');
    handle.className = 'ci-drag';
    handle.title     = 'Arrastrar para reordenar';
    handle.innerHTML = `<svg class="icon" width="14" height="14"><use href="#ico-grip"/></svg>`;
    handle.addEventListener('mousedown', () => { fromHandle = true; });

    // ── checkbox ──
    const cb = document.createElement('input');
    cb.type    = 'checkbox';
    cb.checked = item.d;
    cb.addEventListener('change', () => {
      tasks[i].d = cb.checked;
      li.classList.toggle('done', tasks[i].d);
      scheduleSave();
    });

    // ── text input ──
    const inp = document.createElement('input');
    inp.className   = 'ci-label';
    inp.value       = item.t;
    inp.placeholder = 'Nueva tarea...';
    inp.addEventListener('input', () => { tasks[i].t = inp.value; scheduleSave(); });
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addTask(); }
      if (e.key === 'Backspace' && inp.value === '') {
        e.preventDefault();
        tasks.splice(i, 1);
        renderChecklist();
        scheduleSave();
        checklist.querySelectorAll('.ci-label')[Math.max(0, i - 1)]?.focus();
      }
    });

    // ── delete button ──
    const del = document.createElement('button');
    del.className = 'ci-del';
    del.setAttribute('aria-label', 'Eliminar');
    del.innerHTML = `<svg class="icon" width="13" height="13"><use href="#ico-x"/></svg>`;
    del.addEventListener('click', () => { tasks.splice(i, 1); renderChecklist(); scheduleSave(); });

    // ── drag events ──
    li.addEventListener('dragstart', e => {
      if (!fromHandle) { e.preventDefault(); return; }
      fromHandle  = false;
      dragSrcIdx  = i;
      e.dataTransfer.effectAllowed = 'move';
      // defer so the ghost image renders before we dim the element
      requestAnimationFrame(() => li.classList.add('dragging'));
    });

    li.addEventListener('dragend', () => {
      fromHandle = false;
      dragSrcIdx = null;
      checklist.querySelectorAll('.ci.drag-over').forEach(el => el.classList.remove('drag-over'));
      li.classList.remove('dragging');
      const end = checklist.querySelector('.checklist-drop-end');
      if (end) end.classList.remove('drag-active');
    });

    li.addEventListener('dragover', e => {
      if (dragSrcIdx === null || dragSrcIdx === i) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      checklist.querySelectorAll('.ci.drag-over').forEach(el => el.classList.remove('drag-over'));
      const end = checklist.querySelector('.checklist-drop-end');
      if (end) end.classList.remove('drag-active');
      li.classList.add('drag-over');
    });

    li.addEventListener('dragleave', e => {
      if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over');
    });

    li.addEventListener('drop', e => {
      e.preventDefault();
      li.classList.remove('drag-over');
      if (dragSrcIdx === null || dragSrcIdx === i) return;

      const [moved] = tasks.splice(dragSrcIdx, 1);
      // after removing src, adjust target index if src was before it
      const insertAt = dragSrcIdx < i ? i - 1 : i;
      tasks.splice(insertAt, 0, moved);

      dragSrcIdx = null;
      renderChecklist();
      scheduleSave();
    });

    li.appendChild(handle);
    li.appendChild(cb);
    li.appendChild(inp);
    li.appendChild(del);
    checklist.appendChild(li);
  });

  // ── end drop zone (to drop at the last position) ──
  const endZone = document.createElement('div');
  endZone.className = 'checklist-drop-end';
  endZone.addEventListener('dragover', e => {
    if (dragSrcIdx === null) return;
    e.preventDefault();
    checklist.querySelectorAll('.ci.drag-over').forEach(el => el.classList.remove('drag-over'));
    endZone.classList.add('drag-active');
  });
  endZone.addEventListener('dragleave', () => endZone.classList.remove('drag-active'));
  endZone.addEventListener('drop', e => {
    e.preventDefault();
    endZone.classList.remove('drag-active');
    if (dragSrcIdx === null) return;
    const [moved] = tasks.splice(dragSrcIdx, 1);
    tasks.push(moved);
    dragSrcIdx = null;
    renderChecklist();
    scheduleSave();
  });
  checklist.appendChild(endZone);
}

function addTask() {
  tasks.push({ t: '', d: false });
  renderChecklist();
  scheduleSave();
  const inputs = checklist.querySelectorAll('.ci-label');
  if (inputs.length) inputs[inputs.length - 1].focus();
}

document.getElementById('addTaskBtn').addEventListener('click', addTask);

// ── Notes textarea ─────────────────────────────────────────────────────────
notesArea.addEventListener('input', scheduleSave);

// ── Canvas ─────────────────────────────────────────────────────────────────
function resizeCanvas(preserve = true) {
  const rect = canvasWrap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const DPR = window.devicePixelRatio || 1;
  const newW = Math.round(rect.width * DPR);
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
    const img = new Image();
    const rect = canvasWrap.getBoundingClientRect();
    img.onload = () => ctx.drawImage(img, 0, 0, rect.width, rect.height);
    img.src = drawingSnap;
  } else {
    const DPR = window.devicePixelRatio || 1;
    ctx.clearRect(0, 0, drawCanvas.width / DPR, drawCanvas.height / DPR);
  }
}

// ResizeObserver: preserve drawing on canvas resize
let roTimer = null;
const ro = new ResizeObserver(() => {
  if (!document.getElementById('tab-draw').classList.contains('active')) return;
  clearTimeout(roTimer);
  roTimer = setTimeout(() => resizeCanvas(true), 80);
});
ro.observe(canvasWrap);

// Pointer helpers
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
  const p   = pointerPos(e);
  const bg  = getComputedStyle(document.documentElement)
                .getPropertyValue('--canvas-bg').trim();

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

// ── Drawing toolbar ────────────────────────────────────────────────────────
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
  if (selDay) {
    if (!allData[selDay.key]) allData[selDay.key] = { note: '', tasks: [], hasDrawing: false };
    allData[selDay.key].hasDrawing = false;
    await window.api.saveDrawing(selDay.key, null);
    renderCal();
    flashSaved();
  }
});

// ── Panel close ────────────────────────────────────────────────────────────
document.getElementById('closeBtn').addEventListener('click', closePanel);

// ── Month navigation ───────────────────────────────────────────────────────
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

// ── Today button ───────────────────────────────────────────────────────────
document.getElementById('todayBtn').addEventListener('click', () => {
  const t = new Date();
  curY    = t.getFullYear();
  curM    = t.getMonth();
  renderCal();
});

// ── Keyboard shortcuts ─────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && selDay) closePanel();
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

function fmt(amount) {
  return 'S/. ' + Math.abs(amount).toLocaleString('es-PE', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function calcGlobal() {
  let totalIn = 0, totalOut = 0;
  for (const key in allData) {
    if (key.startsWith('__')) continue; // skip internal keys like __pending__
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
  return { totalIn, totalOut, net: totalIn - totalOut };
}

function updateBalanceDisplay() {
  const totalEl   = document.getElementById('finBalanceTotal');
  const inEl      = document.getElementById('finTotalIn');
  const outEl     = document.getElementById('finTotalOut');
  const dayNetEl  = document.getElementById('finDayNet');
  if (!totalEl) return;

  const g = calcGlobal();
  totalEl.textContent = (g.net >= 0 ? '+' : '−') + fmt(g.net);
  totalEl.className = 'fin-balance-amount' + (g.net > 0 ? ' positive' : g.net < 0 ? ' negative' : '');
  inEl.textContent  = '+' + fmt(g.totalIn);
  outEl.textContent = '−' + fmt(g.totalOut);

  const d = calcDay();
  if (d.net !== 0 || transactions.length > 0) {
    dayNetEl.textContent = (d.net >= 0 ? '+' : '−') + fmt(d.net);
    dayNetEl.className = 'fin-day-net' + (d.net >= 0 ? ' positive' : ' negative');
  } else {
    dayNetEl.textContent = '';
  }
}

function renderTransactions() {
  const list = document.getElementById('txList');
  if (!list) return;
  list.innerHTML = '';

  if (transactions.length === 0) {
    const empty = document.createElement('div');
    empty.className   = 'fin-empty';
    empty.textContent = 'Sin movimientos para este día';
    list.appendChild(empty);
    updateBalanceDisplay();
    return;
  }

  // Oldest first
  const sorted = [...transactions].sort(
    (a, b) => new Date(a.createdAt) - new Date(b.createdAt)
  );

  sorted.forEach(tx => {
    const el  = document.createElement('div');
    el.className = 'fin-item';

    const ts      = new Date(tx.createdAt);
    const timeStr = ts.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
    const dateStr = ts.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
    const isDigital = tx.method === 'digital';

    el.innerHTML = `
      <div class="fin-item-icon ${tx.type}">
        <svg class="icon" width="13" height="13">
          <use href="#ico-${tx.type === 'ingreso' ? 'up' : 'down'}"/>
        </svg>
      </div>
      <div class="fin-item-info">
        <span class="fin-item-desc">${tx.description || 'Sin descripción'}</span>
        <span class="fin-item-meta">
          <span class="fin-method-badge ${isDigital ? 'digital' : 'fisico'}">
            ${isDigital ? 'Digital' : 'Físico'}
          </span>
          · ${dateStr} ${timeStr}
        </span>
      </div>
      <span class="fin-item-amount ${tx.type}">
        ${tx.type === 'ingreso' ? '+' : '−'}${fmt(tx.amount)}
      </span>
      <button class="fin-item-del" aria-label="Eliminar movimiento">
        <svg class="icon" width="12" height="12"><use href="#ico-x"/></svg>
      </button>`;

    el.querySelector('.fin-item-del').addEventListener('click', () => {
      const idx = transactions.findIndex(t => t.id === tx.id);
      if (idx === -1) return;
      transactions.splice(idx, 1);
      if (allData[selDay.key]) allData[selDay.key].transactions = [...transactions];
      renderTransactions();
      scheduleSave();
    });

    list.appendChild(el);
  });

  updateBalanceDisplay();
}

function addTransaction() {
  const typeBtn   = document.querySelector('.fin-type.active');
  const methodBtn = document.querySelector('.fin-method.active');
  const amountInp = document.getElementById('txAmount');
  const descInp   = document.getElementById('txDesc');

  const amount = parseFloat(amountInp.value);
  if (!selDay || isNaN(amount) || amount <= 0) {
    amountInp.parentElement.classList.add('error');
    setTimeout(() => amountInp.parentElement.classList.remove('error'), 800);
    amountInp.focus();
    return;
  }

  const tx = {
    id:          Date.now().toString(36) + Math.random().toString(36).slice(2),
    type:        typeBtn.dataset.type,
    method:      methodBtn.dataset.method,
    amount,
    description: descInp.value.trim(),
    createdAt:   new Date().toISOString(),
  };

  transactions.push(tx);
  if (!allData[selDay.key])
    allData[selDay.key] = { note: '', tasks: [], hasDrawing: false, transactions: [] };
  allData[selDay.key].transactions = [...transactions];

  amountInp.value = '';
  descInp.value   = '';
  amountInp.focus();

  renderTransactions();
  scheduleSave();
}

// Finance event listeners (static elements, wired once)
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
document.getElementById('txAmount').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTransaction();
});
document.getElementById('txDesc').addEventListener('keydown', e => {
  if (e.key === 'Enter') addTransaction();
});

// ── Home stats ─────────────────────────────────────────────────────────────
function renderHomeStats() {
  const today = new Date();
  const tKey  = dateKey(today.getFullYear(), today.getMonth(), today.getDate());
  const dd    = allData[tKey] || {};

  // Date header (weekday + full date)
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

  // Task counts
  const todayTasks   = dd.tasks || [];
  const pendingCount = todayTasks.filter(t => !t.d).length;
  const doneCount    = todayTasks.filter(t =>  t.d).length;
  const pendEl = document.getElementById('hsTasksPending');
  const doneEl = document.getElementById('hsTasksDone');
  if (pendEl) pendEl.textContent = pendingCount;
  if (doneEl) doneEl.textContent = doneCount;

  // Day balance
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

  // Today's task mini list (up to 5)
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
        if (!allData[tKey]) allData[tKey] = { note: '', tasks: [], hasDrawing: false, transactions: [] };
        allData[tKey].tasks[idx].d = cb.checked;
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
    item.addEventListener('dragend', () => {
      fromHandle = false;
      item.classList.remove('dragging');
    });

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

  if (!allData[key])
    allData[key] = { note: '', tasks: [], hasDrawing: false, transactions: [] };
  allData[key].tasks.push({ t: pt.t, d: false });

  // If that day is currently open, refresh its checklist
  if (selDay && selDay.key === key) {
    tasks.push({ t: pt.t, d: false });
    renderChecklist();
  }

  await Promise.all([
    window.api.saveDay(key, allData[key]),
    savePendingTasks(),
  ]);

  renderPending();
  renderCal();
}

// "Ver día" button opens today in the day panel
document.getElementById('hvOpenTodayBtn').addEventListener('click', () => {
  const t = new Date();
  openDay(t.getFullYear(), t.getMonth(), t.getDate());
});

// Pending add button + input
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
    pending.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      t: val,
      createdAt: new Date().toISOString(),
    });
    e.target.value = '';
    e.target.style.display = 'none';
    await savePendingTasks();
    renderPending();
  }
  if (e.key === 'Escape') {
    e.target.value        = '';
    e.target.style.display = 'none';
  }
});

// ── Auth overlay (PWA only) ────────────────────────────────────────────────
function showAuthOverlay() {
  return new Promise(resolve => {
    const overlay  = document.getElementById('authOverlay');
    const form     = document.getElementById('authForm');
    const errEl    = document.getElementById('authError');
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

  // Si Supabase esta configurado: verificar sesion y arrancar sync en tiempo real
  if (window.WebAuth) {
    const { data: { session } } = await window.WebAuth.sb.auth.getSession();
    if (!session) await showAuthOverlay();
    document.getElementById('logoutBtn').style.display = '';
    document.getElementById('logoutBtn').addEventListener('click', () => window.WebAuth.signOut());
    window.WebAuth.startSync(); // suscripcion realtime
  }

  // Cambio remoto recibido via Realtime
  window.addEventListener('supa-sync', e => {
    const { key, data } = e.detail;
    allData[key] = data;
    if (key === '__pending__') {
      pending = Array.isArray(data) ? data : [];
      renderPending();
    }
    renderCal();
    renderHomeStats();
    // Si el dia abierto es el que cambio, recargar el panel
    if (selDay && selDay.key === key) openDay(selDay.y, selDay.m, selDay.d);
  });

  // Cargar datos y preferencias
  const [data, prefs] = await Promise.all([
    window.api.getData(),
    window.api.getPrefs(),
  ]);
  allData = data || {};
  pending = allData['__pending__'] || [];

  const sysDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const useDark = prefs.theme === 'dark' || (prefs.theme !== 'light' && sysDark);
  if (useDark) applyTheme(true);

  renderCal();
  renderHomeStats();
})();
