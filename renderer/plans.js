'use strict';

// plans.js — Tablero de planificacion con nodos

(function () {
  // ── Constantes ─────────────────────────────────────────────────────────────
  const TW = 168;            // task node width (fixed)
  const GS = 52;            // gateway bounding box
  const COLORS = ['#5B4AE8','#E84A6F','#10B981','#F59E0B','#3B82F6','#8B5CF6','#EC4899'];

  // ── Estado ─────────────────────────────────────────────────────────────────
  let plans  = [];
  let active = null;         // plan activo
  let sel    = null;         // { type:'node'|'edge', id }
  let addMode = null;        // 'task'|'and'|'or'|null
  let drag   = null;         // { kind:'node'|'pan', ... }
  let conn   = null;         // { fromId, tempLine }
  let pz     = { x:60, y:60, z:1 };
  const expanded = new Set(); // ids de nodos con panel de subtareas abierto

  // ── DOM ────────────────────────────────────────────────────────────────────
  let $view, $wrap, $world, $svg, $plansList, $planHeader, $empty;
  let $plnDetail, $plnDetailSvg, $plnDetailTitle, $plnDetailItems;
  let $plnDetailMeta, $plnDetailProgWrap, $plnDetailProgFill, $plnDetailProgLbl;
  let $plnDetailNext, $plnDetailNextTitle, $plnDetailNextEyebrow, $plnDetailPlanBadge;
  let $plnNextPicker, $plnNextPickList;
  let $plnHdrWrap, $plnPlanDrop;
  let pendingAnim = null; // { ids: Set, dir: 'down'|'up' }

  // ── Estado del panel de detalle ────────────────────────────────────────────
  let detailId = null; // id del nodo de tarea actualmente en el panel

  // ── Geometria ──────────────────────────────────────────────────────────────
  // Altura dinamica segun contenido del nodo
  const EXPAND_H = 24; // altura de la barra de expansion en la base del nodo

  function nodeH(n) {
    if (n.type !== 'task') return GS;
    const len    = (n.title || '').length;
    const rows   = len > 18 ? 2 : 1;
    const extras = (n.date ? 1 : 0) + ((n.startDate || n.endDate) ? 1 : 0) + (n.amount != null ? 1 : 0);
    const base   = Math.max(52, 24 + rows * 18 + extras * 17 + 8) + EXPAND_H;
    if (!expanded.has(n.id)) return base;
    const cnt    = (n.items || []).length;
    return base + 8 + cnt * 30 + 36 + 8; // sep + filas + add-row + padding
  }

  const nw = n => n.type === 'task' ? TW : GS;
  const nh = n => n.type === 'task' ? nodeH(n) : GS;
  const cx = n => n.x + nw(n) / 2;
  const cy = n => n.y + nh(n) / 2;

  // Puerto cardinal mas cercano a `toward`
  function port(node, toward) {
    const dx = cx(toward) - cx(node);
    const dy = cy(toward) - cy(node);
    if (Math.abs(dx) >= Math.abs(dy)) {
      return dx >= 0
        ? { x: node.x + nw(node), y: cy(node) }
        : { x: node.x,            y: cy(node) };
    }
    return dy >= 0
      ? { x: cx(node), y: node.y + nh(node) }
      : { x: cx(node), y: node.y };
  }

  function pathD(src, dst) {
    const s = port(src, dst);
    const d = port(dst, src);
    const hor = Math.abs(d.x - s.x) >= Math.abs(d.y - s.y);
    const t = hor
      ? Math.abs(d.x - s.x) * 0.5
      : Math.abs(d.y - s.y) * 0.5;
    return hor
      ? `M${s.x},${s.y} C${s.x+t},${s.y} ${d.x-t},${d.y} ${d.x},${d.y}`
      : `M${s.x},${s.y} C${s.x},${s.y+t} ${d.x},${d.y-t} ${d.x},${d.y}`;
  }

  // ── UUID ───────────────────────────────────────────────────────────────────
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ── Datos ──────────────────────────────────────────────────────────────────
  function load(raw) {
    const prevId = active?.id;
    plans = Array.isArray(raw?.plans) ? raw.plans : [];
    plans.forEach(p => {
      if (!p.nodes) p.nodes = [];
      if (!p.edges) p.edges = [];
    });
    renderSidebar();
    const kept = prevId && plans.find(p => p.id === prevId);
    if (kept) {
      active = kept;
      redraw();
    } else if (plans.length > 0) {
      openPlan(plans[0].id);
    } else {
      active = null; redraw();
    }
  }

  function persist() {
    window.api?.saveDay('__plans__', { plans });
  }

  // Devuelve { 'YYYY-MM-DD': [color, ...] } para destacar en el calendario
  function getPlanDates() {
    const out = {};
    for (const p of plans) {
      for (const n of p.nodes) {
        if (n.date) {
          if (!out[n.date]) out[n.date] = [];
          if (!out[n.date].includes(p.color)) out[n.date].push(p.color);
        }
      }
    }
    return out;
  }

  // ── CRUD de planes ─────────────────────────────────────────────────────────
  function newPlan() {
    const color = COLORS[plans.length % COLORS.length];
    const p = { id: uid(), title: 'Plan ' + (plans.length + 1), color, nodes: [], edges: [] };
    plans.push(p);
    renderSidebar();
    openPlan(p.id);
    persist();
    setTimeout(() => {
      const nameEl = $plansList?.querySelector('.pl-item.active .pl-name');
      if (nameEl) startInline(nameEl, v => {
        p.title = v || p.title;
        nameEl.textContent = p.title;
        if ($planHeader) $planHeader.textContent = p.title;
        persist();
      });
    }, 40);
  }

  function deletePlan(id) {
    plans = plans.filter(p => p.id !== id);
    if (active?.id === id) active = plans[0] || null;
    renderSidebar();
    redraw();
    persist();
    notifyCal();
  }

  function openPlan(id) {
    active = plans.find(p => p.id === id) || null;
    sel = null; addMode = null;
    closeDetail();
    clearModes();
    pz = { x: 60, y: 60, z: 1 };
    renderSidebar();
    redraw();
    if ($planHeader && active) {
      $planHeader.textContent = active.title;
      $planHeader.style.setProperty('--pc', active.color);
    } else if ($planHeader) {
      $planHeader.textContent = 'Selecciona un plan';
    }
  }

  // ── Modo de adicion ────────────────────────────────────────────────────────
  function setMode(m) {
    addMode = addMode === m ? null : m;
    clearModes();
    if (addMode) {
      document.getElementById('plnTaskBtn')?.classList.toggle('pln-active', addMode === 'task');
      document.getElementById('plnAndBtn')?.classList.toggle('pln-active', addMode === 'and');
      document.getElementById('plnOrBtn')?.classList.toggle('pln-active', addMode === 'or');
    }
    if ($wrap) $wrap.style.cursor = addMode ? 'crosshair' : '';
  }

  function clearModes() {
    ['plnTaskBtn','plnAndBtn','plnOrBtn'].forEach(id => document.getElementById(id)?.classList.remove('pln-active'));
    if ($wrap) $wrap.style.cursor = '';
  }

  // ── Nodos ──────────────────────────────────────────────────────────────────
  function addNode(type, x, y) {
    if (!active) return;
    const n = { id: uid(), type, title: type === 'task' ? 'Tarea' : '', date: null, startDate: null, endDate: null, items: [], x: Math.round(x), y: Math.round(y) };
    active.nodes.push(n);
    sel = { type: 'node', id: n.id };
    persist();
    redraw();
    if (type === 'task') setTimeout(() => startEditTitle(n.id), 30);
  }

  function deleteSelected() {
    if (!active || !sel) return;
    if (sel.type === 'node') {
      active.nodes = active.nodes.filter(n => n.id !== sel.id);
      active.edges = active.edges.filter(e => e.from !== sel.id && e.to !== sel.id);
    } else {
      active.edges = active.edges.filter(e => e.id !== sel.id);
    }
    sel = null;
    persist();
    redraw();
    notifyCal();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function redraw() {
    if (!$world || !$svg) return;
    applyPZ();
    [...$world.children].forEach(c => { if (c !== $svg) c.remove(); });
    const hasNodes = active && active.nodes.length > 0;
    if ($empty) $empty.style.display = (!active || !hasNodes) ? '' : 'none';
    if (!active) return;
    active.nodes.forEach(n => $world.insertBefore(buildNode(n), $svg));
    drawEdges();
    if (detailId) renderDetail();
    // Animaciones de desplazamiento anti-solapamiento
    if (pendingAnim) {
      const { ids, dir } = pendingAnim;
      pendingAnim = null;
      const cls = dir === 'down' ? 'pn-anim-down' : 'pn-anim-up';
      requestAnimationFrame(() => {
        for (const id of ids) {
          const el = $world.querySelector('[data-node-id="' + id + '"]');
          if (!el) continue;
          el.classList.add(cls);
          el.addEventListener('animationend', () => el.classList.remove(cls), { once: true });
        }
      });
    }
  }

  function applyPZ() {
    if ($world) $world.style.transform = `translate(${pz.x}px,${pz.y}px) scale(${pz.z})`;
  }

  function drawEdges() {
    $svg.querySelectorAll('path,line').forEach(el => el.remove());
    if (!active) return;
    for (const e of active.edges) {
      const s = active.nodes.find(n => n.id === e.from);
      const d = active.nodes.find(n => n.id === e.to);
      if (!s || !d) continue;
      const isSel = sel?.type === 'edge' && sel.id === e.id;
      const path = svgEl('path');
      path.setAttribute('d', pathD(s, d));
      path.setAttribute('stroke', isSel ? 'var(--accent)' : 'var(--pln-edge)');
      path.setAttribute('stroke-width', isSel ? '2.5' : '1.8');
      path.setAttribute('fill', 'none');
      path.setAttribute('marker-end', 'url(#pln-arr)');
      path.setAttribute('data-eid', e.id);
      path.style.pointerEvents = 'stroke';
      path.style.cursor = 'pointer';
      path.addEventListener('click', ev => { ev.stopPropagation(); sel = { type:'edge', id:e.id }; drawEdges(); });
      $svg.appendChild(path);
    }
    if (conn?.tempLine) $svg.appendChild(conn.tempLine);
  }

  function buildNode(n) {
    const div = document.createElement('div');
    const isSel = sel?.type === 'node' && sel.id === n.id;
    div.dataset.nodeId = n.id;
    div.style.left = n.x + 'px';
    div.style.top  = n.y + 'px';
    div.style.setProperty('--pc', active.color);

    if (n.type === 'task') {
      div.className = 'pn pn-task' + (isSel ? ' pn-sel' : '');
      div.style.width  = TW + 'px';
      div.style.height = nodeH(n) + 'px';

      const title = document.createElement('div');
      title.className = 'pn-title';
      title.textContent = n.title || 'Tarea';
      title.style.cursor = 'text';
      // Clic en el texto abre el editor; se bloquea el mousedown para no iniciar drag
      title.addEventListener('mousedown', ev => ev.stopPropagation());
      title.addEventListener('click', ev => { ev.stopPropagation(); startEditTitle(n.id); });
      div.appendChild(title);

      if (n.date) {
        const dlbl = document.createElement('div');
        dlbl.className = 'pn-date-lbl';
        dlbl.textContent = fmtDate(n.date);
        div.appendChild(dlbl);
      }

      if (n.startDate || n.endDate) {
        const tlbl = document.createElement('div');
        tlbl.className = 'pn-time-lbl';
        tlbl.textContent = fmtDateRange(n);
        div.appendChild(tlbl);
      }

      const calBtn = document.createElement('button');
      calBtn.className = 'pn-cal-btn';
      calBtn.title = 'Asignar fecha';
      calBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="3" y1="10" x2="21" y2="10"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="16" y1="2" x2="16" y2="6"/></svg>';
      calBtn.addEventListener('click', ev => { ev.stopPropagation(); openDatePicker(n, calBtn); });
      div.appendChild(calBtn);

      const timeBtn = document.createElement('button');
      timeBtn.className = 'pn-range-btn';
      timeBtn.title = 'Fechas de inicio y fin';
      timeBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="3" y1="12" x2="21" y2="12"/><polyline points="8 7 3 12 8 17"/><polyline points="16 7 21 12 16 17"/></svg>';
      timeBtn.addEventListener('click', ev => { ev.stopPropagation(); openDateRangePicker(n, timeBtn); });
      div.appendChild(timeBtn);

      const delBtn = document.createElement('button');
      delBtn.className = 'pn-del-btn';
      delBtn.title = 'Eliminar tarea';
      delBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      delBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        active.nodes = active.nodes.filter(nd => nd.id !== n.id);
        active.edges = active.edges.filter(e => e.from !== n.id && e.to !== n.id);
        if (sel?.id === n.id) sel = null;
        persist(); redraw(); notifyCal();
      });
      div.appendChild(delBtn);

      const budgetBtn = document.createElement('button');
      budgetBtn.className = 'pn-budget-btn';
      budgetBtn.title = 'Presupuesto';
      budgetBtn.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M14.5 8.5a3 3 0 0 0-5 2.2c0 1.6 1 2.4 2.5 2.8s2.5 1.2 2.5 2.8a3 3 0 0 1-5 2.2"/><line x1="12" y1="6" x2="12" y2="8"/><line x1="12" y1="18" x2="12" y2="20"/></svg>';
      budgetBtn.addEventListener('click', ev => { ev.stopPropagation(); openBudgetModal(n); });
      div.appendChild(budgetBtn);

      if (n.amount != null) {
        const tag = makeBudgetTag(n);
        div.appendChild(tag);
      }

      // Spacer que empuja la barra de expansion al fondo
      const spacer = document.createElement('div');
      spacer.style.cssText = 'flex:1; min-height:4px;';
      div.appendChild(spacer);

      // Panel de subtareas (visible cuando el nodo está expandido)
      if (expanded.has(n.id)) {
        div.appendChild(buildItemsPanel(n));
      }

      // Barra de expansion (siempre visible al fondo del nodo)
      const isOpen = expanded.has(n.id);
      const cnt    = (n.items || []).length;
      const expandBar = document.createElement('div');
      expandBar.className = 'pn-expand-bar' + (isOpen ? ' open' : '');
      expandBar.innerHTML = isOpen
        ? '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg><span>Ocultar tareas</span>'
        : '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg><span>' + (cnt ? 'Tareas (' + cnt + ')' : 'Agregar tareas') + '</span>';
      expandBar.addEventListener('mousedown', ev => ev.stopPropagation());
      expandBar.addEventListener('click', ev => {
        ev.stopPropagation();
        const oldH = nodeH(n);
        if (expanded.has(n.id)) expanded.delete(n.id);
        else expanded.add(n.id);
        const delta = nodeH(n) - oldH;
        if (delta !== 0 && active) {
          const affected = new Set();
          for (const other of active.nodes) {
            if (other.id === n.id) continue;
            const xOverlap = other.x < n.x + TW && other.x + TW > n.x;
            if (xOverlap && other.y > n.y) { other.y += delta; affected.add(other.id); }
          }
          if (affected.size) { pendingAnim = { ids: affected, dir: delta > 0 ? 'down' : 'up' }; persist(); }
        }
        redraw();
      });
      div.appendChild(expandBar);

    } else {
      // Gateway: AND (Y) o OR (O)
      div.className = 'pn pn-gw pn-gw-' + n.type + (isSel ? ' pn-sel' : '');
      div.style.width  = GS + 'px';
      div.style.height = GS + 'px';

      const inner = document.createElement('div');
      inner.className = 'pn-gw-inner';
      const lbl = document.createElement('span');
      lbl.className = 'pn-gw-lbl';
      lbl.textContent = n.type === 'and' ? 'Y' : 'O';
      inner.appendChild(lbl);
      div.appendChild(inner);
    }

    // Handles de conexion (N/S/E/W)
    ['n','s','e','w'].forEach(side => {
      const h = document.createElement('div');
      h.className = 'pn-h pn-h-' + side;
      h.addEventListener('mousedown', ev => { ev.stopPropagation(); startConn(n, ev); });
      div.appendChild(h);
    });

    div.addEventListener('mousedown', ev => {
      if (ev.target.classList.contains('pn-h') || ev.target.closest('.pn-cal-btn') || ev.target.closest('.pn-del-btn') || ev.target.closest('.pn-budget-btn') || ev.target.closest('.pn-range-btn')) return;
      if (ev.target.classList.contains('pn-inp') || ev.target.closest('.pn-items-panel') || ev.target.closest('.pn-expand-bar')) return;
      ev.stopPropagation();
      sel = { type: 'node', id: n.id };
      const rect = $wrap.getBoundingClientRect();
      drag = {
        kind: 'node', id: n.id,
        ox: (ev.clientX - rect.left - pz.x) / pz.z - n.x,
        oy: (ev.clientY - rect.top  - pz.y) / pz.z - n.y,
      };
      drawEdges();
    });

    div.addEventListener('click', ev => {
      ev.stopPropagation();
      sel = { type:'node', id:n.id };
      drawEdges();
      if (n.type === 'task') openDetail(n.id);
    });
    return div;
  }

  function svgEl(tag) { return document.createElementNS('http://www.w3.org/2000/svg', tag); }

  // ── Conexion entre nodos ───────────────────────────────────────────────────
  function startConn(node, ev) {
    const rect = $wrap.getBoundingClientRect();
    const wx = (ev.clientX - rect.left - pz.x) / pz.z;
    const wy = (ev.clientY - rect.top  - pz.y) / pz.z;
    const line = svgEl('line');
    line.setAttribute('x1', wx); line.setAttribute('y1', wy);
    line.setAttribute('x2', wx); line.setAttribute('y2', wy);
    line.setAttribute('stroke', 'var(--pln-edge)');
    line.setAttribute('stroke-width', '1.8');
    line.setAttribute('stroke-dasharray', '6 4');
    conn = { fromId: node.id, tempLine: line };
    $svg.appendChild(line);
  }

  // ── Fecha del nodo ─────────────────────────────────────────────────────────
  function openDatePicker(n, btn) {
    document.querySelectorAll('.pln-dp').forEach(el => el.remove());
    const dp = document.createElement('div');
    dp.className = 'pln-dp';

    const inp = document.createElement('input');
    inp.type = 'date';
    inp.value = n.date || '';
    inp.className = 'pln-dp-inp';
    inp.addEventListener('change', () => {
      n.date = inp.value || null;
      persist(); redraw(); notifyCal(); dp.remove();
    });

    const clrBtn = document.createElement('button');
    clrBtn.className = 'pln-dp-clr';
    clrBtn.textContent = 'Sin fecha';
    clrBtn.addEventListener('click', () => {
      n.date = null;
      persist(); redraw(); notifyCal(); dp.remove();
    });

    dp.appendChild(inp);
    dp.appendChild(clrBtn);
    document.body.appendChild(dp);

    const r = btn.getBoundingClientRect();
    dp.style.left = r.left + 'px';
    dp.style.top  = (r.bottom + 6) + 'px';
    inp.showPicker?.();

    setTimeout(() => {
      const close = e => { if (!dp.contains(e.target) && e.target !== btn) { dp.remove(); window.removeEventListener('mousedown', close); } };
      window.addEventListener('mousedown', close);
    }, 10);
  }

  function fmtDate(d) {
    const dt = new Date(d + 'T00:00:00');
    return dt.toLocaleDateString('es-PE', { day: 'numeric', month: 'short' });
  }

  function fmtDateRange(n) {
    if (n.startDate && n.endDate) return fmtDate(n.startDate) + ' - ' + fmtDate(n.endDate);
    if (n.startDate) return 'Desde ' + fmtDate(n.startDate);
    if (n.endDate)   return 'Hasta ' + fmtDate(n.endDate);
    return '';
  }

  function openDateRangePicker(n, btn) {
    document.querySelectorAll('.pln-tp').forEach(el => el.remove());
    const dp = document.createElement('div');
    dp.className = 'pln-tp';

    const row = document.createElement('div');
    row.className = 'pln-tp-row';

    function makeField(label, val) {
      const wrap = document.createElement('div');
      wrap.className = 'pln-tp-field';
      const lbl = document.createElement('span');
      lbl.className = 'pln-tp-lbl';
      lbl.textContent = label;
      const inp = document.createElement('input');
      inp.type = 'date';
      inp.className = 'pln-tp-inp';
      inp.value = val || '';
      wrap.appendChild(lbl);
      wrap.appendChild(inp);
      return { wrap, inp };
    }

    const { wrap: startWrap, inp: startInp } = makeField('Inicio', n.startDate);
    const { wrap: endWrap,   inp: endInp   } = makeField('Fin',    n.endDate);
    row.appendChild(startWrap);
    row.appendChild(endWrap);

    const actions = document.createElement('div');
    actions.className = 'pln-tp-actions';

    const clrBtn = document.createElement('button');
    clrBtn.className = 'pln-dp-clr';
    clrBtn.textContent = 'Sin fechas';
    clrBtn.addEventListener('click', () => {
      n.startDate = null; n.endDate = null;
      persist(); redraw(); dp.remove();
    });

    const okBtn = document.createElement('button');
    okBtn.className = 'pln-tp-ok';
    okBtn.textContent = 'Aplicar';
    okBtn.addEventListener('click', () => {
      n.startDate = startInp.value || null;
      n.endDate   = endInp.value   || null;
      persist(); redraw(); dp.remove();
    });

    actions.appendChild(clrBtn);
    actions.appendChild(okBtn);
    dp.appendChild(row);
    dp.appendChild(actions);
    document.body.appendChild(dp);

    const r = btn.getBoundingClientRect();
    dp.style.left = Math.max(8, r.right - 240) + 'px';
    dp.style.top  = (r.bottom + 6) + 'px';

    setTimeout(() => {
      const close = e => {
        if (!dp.contains(e.target) && e.target !== btn) {
          dp.remove(); window.removeEventListener('mousedown', close);
        }
      };
      window.addEventListener('mousedown', close);
    }, 10);
  }

  // ── Presupuesto de tarea ───────────────────────────────────────────────────
  function fmtAmount(n) {
    const sign = n.amountType === 'ingreso' ? '+' : '-';
    return sign + ' S/. ' + Number(n.amount).toLocaleString('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function makeBudgetTag(n) {
    const tag = document.createElement('div');
    tag.className = 'pn-budget-tag ' + (n.amountType || 'gasto');
    tag.textContent = fmtAmount(n);
    return tag;
  }

  function refreshBudgetNode(n) {
    const nodeEl = $world?.querySelector('[data-node-id="' + n.id + '"]');
    if (!nodeEl) return;
    const existing = nodeEl.querySelector('.pn-budget-tag');
    if (existing) existing.remove();
    if (n.amount != null) nodeEl.appendChild(makeBudgetTag(n));
  }

  function openBudgetModal(n) {
    document.querySelectorAll('.pln-bm-overlay').forEach(el => el.remove());

    let selType = n.amountType || 'gasto';

    const overlay = document.createElement('div');
    overlay.className = 'pln-bm-overlay';

    const bd = document.createElement('div');
    bd.className = 'pln-bm-bd';
    bd.addEventListener('click', () => overlay.remove());

    const card = document.createElement('div');
    card.className = 'pln-bm-card';
    card.addEventListener('click', ev => ev.stopPropagation());

    // Encabezado
    const hdr = document.createElement('div');
    hdr.className = 'pln-bm-hdr';
    const hdrLbl = document.createElement('span');
    hdrLbl.className = 'pln-bm-lbl';
    hdrLbl.textContent = 'Presupuesto de tarea';
    const hdrTask = document.createElement('span');
    hdrTask.className = 'pln-bm-task';
    hdrTask.textContent = n.title || 'Tarea';
    hdr.appendChild(hdrLbl);
    hdr.appendChild(hdrTask);

    // Toggle Gasto / Ingreso
    const toggles = document.createElement('div');
    toggles.className = 'pln-bm-toggles';
    ['gasto', 'ingreso'].forEach(t => {
      const btn = document.createElement('button');
      btn.className = 'pln-bm-type' + (selType === t ? ' active ' + t : '');
      btn.dataset.t = t;
      btn.textContent = t === 'gasto' ? 'Gasto' : 'Ingreso';
      btn.addEventListener('click', () => {
        selType = t;
        toggles.querySelectorAll('.pln-bm-type').forEach(b => {
          b.className = 'pln-bm-type' + (b.dataset.t === t ? ' active ' + t : '');
        });
      });
      toggles.appendChild(btn);
    });

    // Monto
    const amtWrap = document.createElement('div');
    amtWrap.className = 'pln-bm-amt-wrap';
    const cur = document.createElement('span');
    cur.className = 'pln-bm-cur';
    cur.textContent = 'S/.';
    const amtInp = document.createElement('input');
    amtInp.type = 'number';
    amtInp.className = 'pln-bm-amt';
    amtInp.min = '0'; amtInp.step = '0.01';
    amtInp.placeholder = '0.00';
    amtInp.value = n.amount != null ? n.amount : '';
    amtInp.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn.click(); });
    amtWrap.appendChild(cur);
    amtWrap.appendChild(amtInp);

    // Acciones
    const actions = document.createElement('div');
    actions.className = 'pln-bm-actions';

    const clearBtn = document.createElement('button');
    clearBtn.className = 'pln-bm-clear';
    clearBtn.textContent = 'Quitar';
    clearBtn.addEventListener('click', () => {
      n.amount = null; n.amountType = null;
      persist(); overlay.remove(); redraw();
    });

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'pln-bm-cancel';
    cancelBtn.textContent = 'Cancelar';
    cancelBtn.addEventListener('click', () => overlay.remove());

    const saveBtn = document.createElement('button');
    saveBtn.className = 'pln-bm-save';
    saveBtn.textContent = 'Guardar';
    saveBtn.addEventListener('click', () => {
      const val = parseFloat(amtInp.value);
      if (!isNaN(val) && val >= 0) {
        n.amount = val; n.amountType = selType;
        persist();
      }
      overlay.remove(); redraw();
    });

    actions.appendChild(clearBtn);
    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);

    card.appendChild(hdr);
    card.appendChild(toggles);
    card.appendChild(amtWrap);
    card.appendChild(actions);
    overlay.appendChild(bd);
    overlay.appendChild(card);
    document.body.appendChild(overlay);
    setTimeout(() => amtInp.focus(), 30);
  }

  // ── Panel de subtareas ────────────────────────────────────────────────────
  function buildItemsPanel(n) {
    if (!n.items) n.items = [];
    const panel = document.createElement('div');
    panel.className = 'pn-items-panel';
    panel.addEventListener('mousedown', ev => ev.stopPropagation());
    panel.addEventListener('click',     ev => ev.stopPropagation());

    for (const item of n.items) {
      panel.appendChild(buildItemRow(n, item));
    }

    // Fila para agregar nueva subtarea
    const addRow = document.createElement('div');
    addRow.className = 'pn-add-row';

    const inp = document.createElement('input');
    inp.type = 'text';
    inp.className = 'pn-add-inp';
    inp.placeholder = 'Nueva tarea...';
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') addSubItem(n, inp);
    });

    const addBtn = document.createElement('button');
    addBtn.className = 'pn-add-item-btn';
    addBtn.innerHTML = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';
    addBtn.addEventListener('click', () => addSubItem(n, inp));

    addRow.append(inp, addBtn);
    panel.appendChild(addRow);
    return panel;
  }

  function buildItemRow(n, item) {
    const row = document.createElement('div');
    row.className = 'pn-item';

    const cb = document.createElement('div');
    cb.className = 'pn-item-cb' + (item.done ? ' done' : '');
    cb.dataset.iid = item.id;
    const CHECK = '<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
    if (item.done) cb.innerHTML = CHECK;
    cb.addEventListener('click', ev => {
      ev.stopPropagation();
      item.done = !item.done;
      persist(); notifyCal();
      cb.className = 'pn-item-cb' + (item.done ? ' done' : '');
      cb.innerHTML = item.done ? CHECK : '';
      txt.className = 'pn-item-txt' + (item.done ? ' done' : '');
      // Sincronizar con el panel de detalle si está abierto en este nodo
      if (detailId === n.id) renderDetailItems(n);
      window.dispatchEvent(new CustomEvent('plans-items-changed'));
    });

    const txt = document.createElement('span');
    txt.className = 'pn-item-txt' + (item.done ? ' done' : '');
    txt.textContent = item.text;
    txt.addEventListener('click', ev => {
      ev.stopPropagation();
      // Edicion inline del texto de la subtarea
      const inp = document.createElement('input');
      inp.type = 'text';
      inp.className = 'pn-add-inp';
      inp.style.cssText = 'flex:1; height:20px; padding:2px 6px; font-size:11.5px;';
      inp.value = item.text;
      txt.replaceWith(inp);
      inp.focus(); inp.select();
      const commit = () => {
        const v = inp.value.trim();
        if (v) { item.text = v; persist(); }
        inp.replaceWith(txt);
        txt.textContent = item.text;
      };
      inp.addEventListener('blur', commit);
      inp.addEventListener('keydown', e => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
        if (e.key === 'Escape') { inp.value = item.text; inp.blur(); }
      });
    });

    const del = document.createElement('button');
    del.className = 'pn-item-del';
    del.innerHTML = '<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    del.addEventListener('click', ev => {
      ev.stopPropagation();
      n.items = n.items.filter(i => i.id !== item.id);
      persist(); redraw(); notifyCal();
      window.dispatchEvent(new CustomEvent('plans-items-changed'));
    });

    row.append(cb, txt, del);
    return row;
  }

  function addSubItem(n, inp) {
    const text = inp.value.trim();
    if (!text) { inp.focus(); return; }
    if (!n.items) n.items = [];
    n.items.push({ id: uid(), text, done: false });
    persist(); redraw(); notifyCal();
    window.dispatchEvent(new CustomEvent('plans-items-changed'));
    // Devolver el foco al input tras el redraw
    setTimeout(() => {
      const panel = $world?.querySelector('[data-node-id="' + n.id + '"] .pn-items-panel');
      const ni = panel?.querySelector('.pn-add-inp');
      if (ni) ni.focus();
    }, 20);
  }

  // ── Edicion de texto inline ────────────────────────────────────────────────
  function startEditTitle(id) {
    const n  = active?.nodes.find(n => n.id === id);
    const el = $world?.querySelector('[data-node-id="' + id + '"] .pn-title');
    if (!n || !el || el.dataset.editing) return;

    el.dataset.editing = '1';

    const inp = document.createElement('input');
    inp.className = 'pn-inp';
    inp.value = n.title || '';
    inp.placeholder = 'Nombre...';
    el.replaceWith(inp); // ocupa exactamente el mismo lugar en el flex
    inp.focus();
    inp.select();

    inp.addEventListener('mousedown', ev => ev.stopPropagation());
    inp.addEventListener('click',     ev => ev.stopPropagation());

    function commit() {
      const v = inp.value.trim();
      n.title = v || n.title;
      el.textContent = n.title;
      delete el.dataset.editing;
      inp.replaceWith(el); // devuelve el titulo al mismo lugar
      persist();
    }
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter')  { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.value = n.title; inp.blur(); }
    });
  }

  function startInline(el, onCommit) {
    const orig = el.textContent;
    const inp = document.createElement('input');
    inp.className = 'pn-inp';
    inp.value = orig;
    el.replaceWith(inp);
    inp.focus(); inp.select();
    // Evitar que el clic en el input dispare handlers del elemento padre
    inp.addEventListener('mousedown', ev => ev.stopPropagation());
    inp.addEventListener('click',     ev => ev.stopPropagation());
    const commit = () => { const v = inp.value.trim(); inp.replaceWith(el); onCommit(v); };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); inp.blur(); }
      if (e.key === 'Escape') { inp.value = orig; inp.blur(); }
    });
  }

  // ── Eventos del canvas ─────────────────────────────────────────────────────
  function initCanvas() {
    // Click: agregar nodo si hay modo activo
    $wrap.addEventListener('click', ev => {
      if (!addMode || !active || ev.target.closest('[data-node-id]')) return;
      const rect = $wrap.getBoundingClientRect();
      const wx = (ev.clientX - rect.left - pz.x) / pz.z;
      const wy = (ev.clientY - rect.top  - pz.y) / pz.z;
      const hw = addMode === 'task' ? TW / 2 : GS / 2;
      const hh = addMode === 'task' ? 26 : GS / 2;  // 26 = mitad de altura minima de nodo
      addNode(addMode, wx - hw, wy - hh);
      setMode(null);
    });

    // Pan con mousedown en area vacia
    $wrap.addEventListener('mousedown', ev => {
      if (conn || addMode) return;
      if (!ev.target.closest('[data-node-id]') && !ev.target.closest('[data-eid]')) {
        sel = null; drawEdges();
        drag = { kind: 'pan', sx: ev.clientX, sy: ev.clientY, px: pz.x, py: pz.y };
      }
    });

    // Zoom con rueda
    $wrap.addEventListener('wheel', ev => {
      ev.preventDefault();
      const f = ev.deltaY > 0 ? 0.92 : 1.08;
      const rect = $wrap.getBoundingClientRect();
      const mx = ev.clientX - rect.left;
      const my = ev.clientY - rect.top;
      pz.x = mx - (mx - pz.x) * f;
      pz.y = my - (my - pz.y) * f;
      pz.z = Math.max(0.2, Math.min(3, pz.z * f));
      applyPZ();
    }, { passive: false });

    // Movimiento global
    window.addEventListener('mousemove', ev => {
      if (drag?.kind === 'node' && active) {
        const n = active.nodes.find(n => n.id === drag.id);
        if (n) {
          const rect = $wrap.getBoundingClientRect();
          n.x = Math.round((ev.clientX - rect.left - pz.x) / pz.z - drag.ox);
          n.y = Math.round((ev.clientY - rect.top  - pz.y) / pz.z - drag.oy);
          const el = $world.querySelector('[data-node-id="' + drag.id + '"]');
          if (el) { el.style.left = n.x + 'px'; el.style.top = n.y + 'px'; }
          drawEdges();
        }
      } else if (drag?.kind === 'pan') {
        pz.x = drag.px + (ev.clientX - drag.sx);
        pz.y = drag.py + (ev.clientY - drag.sy);
        applyPZ();
      }
      if (conn?.tempLine) {
        const rect = $wrap.getBoundingClientRect();
        const wx = (ev.clientX - rect.left - pz.x) / pz.z;
        const wy = (ev.clientY - rect.top  - pz.y) / pz.z;
        conn.tempLine.setAttribute('x2', wx);
        conn.tempLine.setAttribute('y2', wy);
      }
    });

    // Soltar mouse: finalizar arrastre o conexion
    window.addEventListener('mouseup', ev => {
      if (drag?.kind === 'node') persist();
      drag = null;
      if (conn) {
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        const toEl = over?.closest('[data-node-id]');
        const toId = toEl?.dataset.nodeId;
        if (toId && toId !== conn.fromId && active) {
          const dup = active.edges.some(e => e.from === conn.fromId && e.to === toId);
          if (!dup) {
            active.edges.push({ id: uid(), from: conn.fromId, to: toId });
            persist();
          }
        }
        conn.tempLine?.remove();
        conn = null;
        redraw();
      }
    });
  }

  // ── Teclado ───────────────────────────────────────────────────────────────
  function initKeyboard() {
    window.addEventListener('keydown', ev => {
      if (!$view?.classList.contains('active')) return;
      if (ev.target.tagName === 'INPUT' || ev.target.contentEditable === 'true') return;
      if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); deleteSelected(); }
      if (ev.key === 'Escape') { closeDetail(); setMode(null); sel = null; drawEdges(); }
    });
  }

  // ── Panel de detalle de tarea ──────────────────────────────────────────────
  function openDetail(nodeId) {
    if (!active) return;
    const node = active.nodes.find(n => n.id === nodeId && n.type === 'task');
    if (!node) return;
    detailId = nodeId;
    $plnDetail?.classList.add('active');
    $plnDetail?.style.setProperty('--pc', active.color);
    renderDetail();
  }

  function closeDetail() {
    detailId = null;
    $plnDetail?.classList.remove('active');
    hideNextPicker();
  }

  function renderDetail() {
    if (!detailId || !active || !$plnDetail) return;
    const node = active.nodes.find(n => n.id === detailId);
    if (!node) { closeDetail(); return; }

    // Badge del plan
    if ($plnDetailPlanBadge) $plnDetailPlanBadge.textContent = active.title;

    // Titulo
    if ($plnDetailTitle) $plnDetailTitle.textContent = node.title || 'Sin nombre';

    // Meta chips
    if ($plnDetailMeta) {
      $plnDetailMeta.innerHTML = '';
      if (node.date) {
        const c = document.createElement('span');
        c.className = 'pln-det-chip';
        c.textContent = fmtDate(node.date);
        $plnDetailMeta.appendChild(c);
      }
      if (node.startDate || node.endDate) {
        const c = document.createElement('span');
        c.className = 'pln-det-chip';
        c.textContent = fmtDateRange(node);
        $plnDetailMeta.appendChild(c);
      }
      if (node.amount != null) {
        const c = document.createElement('span');
        c.className = 'pln-det-chip ' + (node.amountType || 'gasto');
        c.textContent = (node.amountType === 'ingreso' ? '+' : '-') + ' S/. ' + node.amount.toFixed(2);
        $plnDetailMeta.appendChild(c);
      }
    }

    // Progreso
    const items = node.items || [];
    const done  = items.filter(i => i.done).length;
    if (items.length && $plnDetailProgWrap) {
      $plnDetailProgWrap.style.display = '';
      if ($plnDetailProgFill) $plnDetailProgFill.style.width = (done / items.length * 100).toFixed(0) + '%';
      if ($plnDetailProgLbl)  $plnDetailProgLbl.textContent  = done + ' / ' + items.length;
    } else if ($plnDetailProgWrap) {
      $plnDetailProgWrap.style.display = 'none';
    }

    // Items
    renderDetailItems(node);

    // Minimap
    renderMinimap();

    // Siguiente paso (soporta bifurcaciones)
    const nexts = findNextTasks(detailId);
    if ($plnDetailNext) {
      if (nexts.length === 1) {
        $plnDetailNext.style.display = '';
        if ($plnDetailNextEyebrow) $plnDetailNextEyebrow.textContent = 'Siguiente paso';
        if ($plnDetailNextTitle)   $plnDetailNextTitle.textContent   = nexts[0].title || 'Sin nombre';
        $plnDetailNext.onclick = () => openDetail(nexts[0].id);
      } else if (nexts.length > 1) {
        $plnDetailNext.style.display = '';
        if ($plnDetailNextEyebrow) $plnDetailNextEyebrow.textContent = 'Elegir siguiente paso';
        if ($plnDetailNextTitle)   $plnDetailNextTitle.textContent   = nexts.length + ' opciones';
        $plnDetailNext.onclick = () => showNextPicker(nexts);
      } else {
        $plnDetailNext.style.display = 'none';
      }
    }
  }

  function renderDetailItems(node) {
    if (!$plnDetailItems) return;
    $plnDetailItems.innerHTML = '';
    const items = node.items || [];

    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'pln-det-empty';
      p.textContent = 'Sin subtareas. Expande el nodo en el canvas para agregar.';
      $plnDetailItems.appendChild(p);
      return;
    }

    for (const item of items) {
      const row = document.createElement('div');
      row.className = 'pln-det-item' + (item.done ? ' done' : '');

      const cb = document.createElement('div');
      cb.className = 'pln-det-cb' + (item.done ? ' done' : '');
      const CHECK_SVG = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
      if (item.done) cb.innerHTML = CHECK_SVG;

      const txt = document.createElement('span');
      txt.className = 'pln-det-txt' + (item.done ? ' done' : '');
      txt.textContent = item.text;

      row.addEventListener('click', () => {
        item.done = !item.done;
        persist(); notifyCal();
        // Update DOM sin redraw
        row.classList.toggle('done', item.done);
        cb.className  = 'pln-det-cb' + (item.done ? ' done' : '');
        cb.innerHTML  = item.done ? CHECK_SVG : '';
        txt.className = 'pln-det-txt' + (item.done ? ' done' : '');
        // Actualizar progreso
        const allItems  = node.items || [];
        const doneCount = allItems.filter(i => i.done).length;
        if ($plnDetailProgFill) $plnDetailProgFill.style.width = allItems.length ? (doneCount / allItems.length * 100).toFixed(0) + '%' : '0%';
        if ($plnDetailProgLbl)  $plnDetailProgLbl.textContent  = doneCount + ' / ' + allItems.length;
        // Actualizar checkbox en el canvas si el nodo está expandido
        const canvasCb = $world?.querySelector('[data-node-id="' + node.id + '"] [data-iid="' + item.id + '"]');
        if (canvasCb) {
          canvasCb.className = 'pn-item-cb' + (item.done ? ' done' : '');
          canvasCb.innerHTML = item.done ? CHECK_SVG : '';
          const canvasTxt = canvasCb.nextElementSibling;
          if (canvasTxt) canvasTxt.className = 'pn-item-txt' + (item.done ? ' done' : '');
        }
        window.dispatchEvent(new CustomEvent('plans-items-changed'));
      });

      row.append(cb, txt);
      $plnDetailItems.appendChild(row);
    }
  }

  function renderMinimap() {
    if (!$plnDetailSvg || !active?.nodes.length) {
      if ($plnDetailSvg) $plnDetailSvg.setAttribute('viewBox', '0 0 1 1');
      return;
    }

    $plnDetailSvg.innerHTML = '';

    // Bounding box (usa altura base, sin expansion)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of active.nodes) {
      const w = n.type === 'task' ? TW : GS;
      const len    = (n.title || '').length;
      const rows   = len > 18 ? 2 : 1;
      const extras = (n.date ? 1 : 0) + ((n.startDate || n.endDate) ? 1 : 0) + (n.amount != null ? 1 : 0);
      const h = n.type === 'task' ? Math.max(52, 24 + rows * 18 + extras * 17 + 8) + EXPAND_H : GS;
      x0 = Math.min(x0, n.x);     y0 = Math.min(y0, n.y);
      x1 = Math.max(x1, n.x + w); y1 = Math.max(y1, n.y + h);
    }

    const PAD = 18;
    $plnDetailSvg.setAttribute('viewBox', (x0 - PAD) + ' ' + (y0 - PAD) + ' ' + (x1 - x0 + PAD * 2) + ' ' + (y1 - y0 + PAD * 2));

    // Aristas
    for (const e of active.edges) {
      const s = active.nodes.find(n => n.id === e.from);
      const d = active.nodes.find(n => n.id === e.to);
      if (!s || !d) continue;
      const sw = s.type === 'task' ? TW : GS;
      const sh = s.type === 'task' ? 52 + EXPAND_H : GS;
      const dw = d.type === 'task' ? TW : GS;
      const sx = s.x + sw / 2, sy = s.y + sh;
      const dx = d.x + dw / 2, dy = d.y;
      const my = (sy + dy) / 2;
      const path = svgEl('path');
      path.setAttribute('d', 'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + my + ', ' + dx + ' ' + my + ', ' + dx + ' ' + dy);
      path.setAttribute('stroke', 'var(--text2)');
      path.setAttribute('stroke-width', '2');
      path.setAttribute('fill', 'none');
      path.setAttribute('opacity', '0.35');
      $plnDetailSvg.appendChild(path);
    }

    // Nodos
    for (const n of active.nodes) {
      const isActive = n.id === detailId;
      if (n.type === 'task') {
        const NH = 44 + EXPAND_H;
        const rect = svgEl('rect');
        rect.setAttribute('x', n.x); rect.setAttribute('y', n.y);
        rect.setAttribute('width', TW); rect.setAttribute('height', NH);
        rect.setAttribute('rx', '7');
        rect.setAttribute('fill', isActive ? active.color : 'var(--surface2)');
        rect.setAttribute('stroke', isActive ? active.color : 'var(--border)');
        rect.setAttribute('stroke-width', isActive ? '3' : '1.5');
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', () => openDetail(n.id));
        $plnDetailSvg.appendChild(rect);

        const t = (n.title || '').slice(0, 15) + ((n.title || '').length > 15 ? '…' : '');
        const lbl = svgEl('text');
        lbl.setAttribute('x', n.x + TW / 2);
        lbl.setAttribute('y', n.y + NH / 2 + 4);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('font-size', '11');
        lbl.setAttribute('font-weight', isActive ? '700' : '500');
        lbl.setAttribute('fill', isActive ? '#fff' : 'var(--text2)');
        lbl.setAttribute('pointer-events', 'none');
        lbl.textContent = t;
        $plnDetailSvg.appendChild(lbl);
      } else {
        const r = GS / 2 - 2;
        const circ = svgEl('circle');
        circ.setAttribute('cx', n.x + GS / 2); circ.setAttribute('cy', n.y + GS / 2);
        circ.setAttribute('r', r);
        circ.setAttribute('fill', 'var(--surface2)');
        circ.setAttribute('stroke', 'var(--border)');
        circ.setAttribute('stroke-width', '1.5');
        $plnDetailSvg.appendChild(circ);

        const lbl = svgEl('text');
        lbl.setAttribute('x', n.x + GS / 2); lbl.setAttribute('y', n.y + GS / 2 + 4);
        lbl.setAttribute('text-anchor', 'middle');
        lbl.setAttribute('font-size', '12'); lbl.setAttribute('font-weight', '700');
        lbl.setAttribute('fill', 'var(--text2)');
        lbl.textContent = n.type === 'and' ? 'Y' : 'O';
        $plnDetailSvg.appendChild(lbl);
      }
    }
  }

  function findNextTasks(nodeId) {
    if (!active) return [];
    const visited = new Set([nodeId]);
    const queue   = active.edges.filter(e => e.from === nodeId).map(e => e.to);
    const results = [];
    while (queue.length) {
      const id = queue.shift();
      if (visited.has(id)) continue;
      visited.add(id);
      const n = active.nodes.find(n => n.id === id);
      if (!n) continue;
      if (n.type === 'task') { results.push(n); continue; }
      active.edges.filter(e => e.from === id).forEach(e => queue.push(e.to));
    }
    return results;
  }

  function showNextPicker(tasks) {
    if (!$plnNextPicker || !$plnNextPickList) return;
    $plnNextPickList.innerHTML = '';
    for (const t of tasks) {
      const btn = document.createElement('button');
      btn.className = 'pln-pick-opt';
      btn.style.setProperty('--pc', active?.color || 'var(--accent)');
      const dot = document.createElement('span');
      dot.className = 'pln-pick-opt-dot';
      const lbl = document.createElement('span');
      lbl.textContent = t.title || 'Sin nombre';
      btn.append(dot, lbl);
      btn.addEventListener('click', () => { hideNextPicker(); openDetail(t.id); });
      $plnNextPickList.appendChild(btn);
    }
    $plnNextPicker.classList.add('open');
  }

  function hideNextPicker() {
    $plnNextPicker?.classList.remove('open');
  }

  // ── Sidebar de planes ──────────────────────────────────────────────────────
  function renderSidebar() {
    if (!$plansList) return;
    $plansList.innerHTML = '';
    for (const p of plans) {
      const li  = document.createElement('li');
      li.className = 'pl-item' + (active?.id === p.id ? ' active' : '');
      li.style.setProperty('--pc', p.color);

      const dot  = document.createElement('span');
      dot.className = 'pl-dot';

      const name = document.createElement('span');
      name.className = 'pl-name';
      name.textContent = p.title;
      name.addEventListener('dblclick', ev => {
        ev.stopPropagation();
        startInline(name, v => {
          p.title = v || p.title;
          name.textContent = p.title;
          if (active?.id === p.id && $planHeader) $planHeader.textContent = p.title;
          persist();
        });
      });

      const del = document.createElement('button');
      del.className = 'pl-del';
      del.title = 'Eliminar plan';
      del.innerHTML = '&times;';
      del.addEventListener('click', ev => { ev.stopPropagation(); deletePlan(p.id); });

      li.append(dot, name, del);
      li.addEventListener('click', () => openPlan(p.id));
      $plansList.appendChild(li);
    }
    renderPlanDropdown();
  }

  function renderPlanDropdown() {
    if (!$plnPlanDrop) return;
    $plnPlanDrop.innerHTML = '';
    for (const p of plans) {
      const item = document.createElement('div');
      item.className = 'pln-drop-item' + (active?.id === p.id ? ' active' : '');
      item.style.setProperty('--pc', p.color);
      const dot = document.createElement('span');
      dot.className = 'pln-drop-dot';
      const lbl = document.createElement('span');
      lbl.textContent = p.title;
      item.append(dot, lbl);
      item.addEventListener('click', ev => {
        ev.stopPropagation();
        openPlan(p.id);
        $plnPlanDrop.classList.remove('open');
      });
      $plnPlanDrop.appendChild(item);
    }
  }

  // ── Notificar al calendario ────────────────────────────────────────────────
  function notifyCal() {
    window.dispatchEvent(new CustomEvent('plans-changed'));
  }

  // ── Inicializar SVG defs ───────────────────────────────────────────────────
  function initSvg() {
    $svg.innerHTML = `<defs>
      <marker id="pln-arr" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
        <polygon points="0 0, 8 3, 0 6" fill="var(--pln-edge)"/>
      </marker>
    </defs>`;
  }

  // ── Abrir / cerrar vista ──────────────────────────────────────────────────
  function openView() {
    $view?.classList.add('active');
    document.getElementById('planesBtn')?.classList.add('active');
    document.querySelector('.layout')?.style.setProperty('display', 'none');
    redraw();
  }

  function closeView() {
    $view?.classList.remove('active');
    document.getElementById('planesBtn')?.classList.remove('active');
    document.querySelector('.layout')?.style.removeProperty('display');
    sel = null; addMode = null;
    clearModes();
  }

  // ── API publica ────────────────────────────────────────────────────────────
  window.Plans = {
    init() {
      $view      = document.getElementById('plansView');
      $wrap      = document.getElementById('plansWrap');
      $world     = document.getElementById('plansWorld');
      $svg       = document.getElementById('plansSvg');
      $plansList  = document.getElementById('plansList');
      $planHeader = document.getElementById('planHeader');
      $empty      = document.getElementById('plansEmpty');
      $plnHdrWrap = document.getElementById('plnHdrWrap');
      $plnPlanDrop = document.getElementById('plnPlanDrop');

      $plnHdrWrap?.addEventListener('click', ev => {
        if (!$plnPlanDrop) return;
        const chev = document.getElementById('plnHdrChev');
        if (chev && window.getComputedStyle(chev).display === 'none') return;
        ev.stopPropagation();
        $plnPlanDrop.classList.toggle('open');
      });
      document.addEventListener('click', () => $plnPlanDrop?.classList.remove('open'));

      // Panel de detalle
      $plnDetail        = document.getElementById('plnDetail');
      $plnDetailSvg     = document.getElementById('plnDetailSvg');
      $plnDetailTitle   = document.getElementById('plnDetailTitle');
      $plnDetailItems   = document.getElementById('plnDetailItems');
      $plnDetailMeta    = document.getElementById('plnDetailMeta');
      $plnDetailProgWrap  = document.getElementById('plnDetailProgWrap');
      $plnDetailProgFill  = document.getElementById('plnDetailProgFill');
      $plnDetailProgLbl   = document.getElementById('plnDetailProgLbl');
      $plnDetailNext      = document.getElementById('plnDetailNext');
      $plnDetailNextTitle = document.getElementById('plnDetailNextTitle');
      $plnDetailNextEyebrow = document.getElementById('plnDetailNextEyebrow');
      $plnDetailPlanBadge = document.getElementById('plnDetailPlanBadge');
      $plnNextPicker      = document.getElementById('plnNextPicker');
      $plnNextPickList    = document.getElementById('plnNextPickList');

      document.getElementById('plnDetailBack')?.addEventListener('click', closeDetail);
      document.getElementById('plnPickCancel')?.addEventListener('click', hideNextPicker);
      $plnNextPicker?.addEventListener('click', ev => { if (ev.target === $plnNextPicker) hideNextPicker(); });

      document.getElementById('plnNewBtn')?.addEventListener('click', newPlan);
      document.getElementById('plnTaskBtn')?.addEventListener('click', () => setMode('task'));
      document.getElementById('plnAndBtn')?.addEventListener('click', () => setMode('and'));
      document.getElementById('plnOrBtn')?.addEventListener('click', () => setMode('or'));
      document.getElementById('plnDelBtn')?.addEventListener('click', deleteSelected);

      initSvg();
      initCanvas();
      initKeyboard();
    },
    load,
    getPlanDates,
    getPlans() { return plans; },
    getItemsForDate(dateStr) {
      const out = [];
      for (const p of plans) {
        for (const n of p.nodes) {
          if (n.type !== 'task' || !(n.items?.length)) continue;
          const inRange =
            n.date === dateStr ||
            (n.startDate && n.endDate   && dateStr >= n.startDate && dateStr <= n.endDate) ||
            (n.startDate && !n.endDate  && dateStr === n.startDate) ||
            (!n.startDate && n.endDate  && dateStr === n.endDate);
          if (inRange) out.push({ plan: p, node: n });
        }
      }
      return out;
    },
    toggleItem(nodeId, itemId) {
      for (const p of plans) {
        const node = p.nodes.find(n => n.id === nodeId);
        if (!node) continue;
        const item = (node.items || []).find(i => i.id === itemId);
        if (!item) continue;
        item.done = !item.done;
        persist(); notifyCal();
        if ($view?.classList.contains('active')) redraw();
        return true;
      }
      return false;
    },
    openView,
    closeView,
  };
})();
