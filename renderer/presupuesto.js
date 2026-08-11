'use strict';

// presupuesto.js — Vista de presupuesto estimado y suscripciones recurrentes
(function () {

  let subscriptions = [];
  let selPeriod = 'monthly';

  let $view, $subsList, $plansList;
  let $summaryIn, $summaryOut, $summaryNet;

  // ── Helpers ────────────────────────────────────────────────────────────────
  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function fmtAmt(v) {
    return 'S/. ' + Math.abs(v).toLocaleString('es-PE', {
      minimumFractionDigits: 2, maximumFractionDigits: 2,
    });
  }

  function monthlyAmt(s) {
    return s.period === 'annual' ? s.amount / 12 : s.amount;
  }

  // ── Datos ──────────────────────────────────────────────────────────────────
  function persist() {
    window.api?.saveDay('__presupuesto__', { subscriptions });
  }

  function load(raw) {
    subscriptions = Array.isArray(raw?.subscriptions) ? raw.subscriptions : [];
    if ($view?.classList.contains('active')) render();
  }

  // ── Planes ─────────────────────────────────────────────────────────────────
  function getPlansGroups() {
    const plans = window.Plans?.getPlans?.() || [];
    const out   = [];
    for (const p of plans) {
      const tasks = (p.nodes || []).filter(n => n.type === 'task' && n.amount != null);
      if (tasks.length) out.push({ plan: p, tasks });
    }
    return out;
  }

  // ── Calculo de resumen ─────────────────────────────────────────────────────
  function calcSummary() {
    const subGasto = subscriptions.reduce((a, s) => a + monthlyAmt(s), 0);

    let planGasto = 0, planIngreso = 0;
    for (const { tasks } of getPlansGroups()) {
      for (const t of tasks) {
        if (t.amountType === 'ingreso') planIngreso += t.amount;
        else planGasto += t.amount;
      }
    }

    return {
      totalGasto:   subGasto + planGasto,
      totalIngreso: planIngreso,
      net:          planIngreso - subGasto - planGasto,
    };
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  function render() {
    renderSummary();
    renderSubs();
    renderPlans();
  }

  function renderSummary() {
    const { totalGasto, totalIngreso, net } = calcSummary();
    if ($summaryIn)  $summaryIn.textContent  = fmtAmt(totalIngreso);
    if ($summaryOut) $summaryOut.textContent = fmtAmt(totalGasto);
    if ($summaryNet) {
      $summaryNet.textContent = (net >= 0 ? '+ ' : '- ') + fmtAmt(Math.abs(net));
      $summaryNet.className   = 'pv-net-amt' + (net >= 0 ? ' positive' : ' negative');
    }
  }

  function renderSubs() {
    if (!$subsList) return;
    $subsList.innerHTML = '';

    if (!subscriptions.length) {
      const p = document.createElement('p');
      p.className   = 'pv-empty';
      p.textContent = 'Sin suscripciones registradas';
      $subsList.appendChild(p);
      return;
    }

    for (const s of subscriptions) {
      const item = document.createElement('div');
      item.className = 'pv-sub-item';

      const info = document.createElement('div');
      info.className = 'pv-sub-info';

      const name = document.createElement('span');
      name.className   = 'pv-sub-name';
      name.textContent = s.name;

      const meta = document.createElement('span');
      meta.className   = 'pv-sub-meta';
      meta.textContent = fmtAmt(s.amount) + ' / ' + (s.period === 'annual' ? 'anual' : 'mensual');
      info.append(name, meta);

      if (s.period === 'annual') {
        const eq = document.createElement('span');
        eq.className   = 'pv-sub-equiv';
        eq.textContent = fmtAmt(monthlyAmt(s)) + ' /mes';
        info.appendChild(eq);
      }

      const del = document.createElement('button');
      del.className = 'pv-sub-del';
      del.title     = 'Eliminar';
      del.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      del.addEventListener('click', () => {
        subscriptions = subscriptions.filter(x => x.id !== s.id);
        persist(); render();
      });

      item.append(info, del);
      $subsList.appendChild(item);
    }

    const totalM = subscriptions.reduce((a, s) => a + monthlyAmt(s), 0);
    const tot = document.createElement('div');
    tot.className = 'pv-sub-total';
    tot.innerHTML = '<span>Total mensual</span><span class="pv-sub-total-val">' + fmtAmt(totalM) + '</span>';
    $subsList.appendChild(tot);
  }

  function renderPlans() {
    if (!$plansList) return;
    $plansList.innerHTML = '';

    const groups = getPlansGroups();
    if (!groups.length) {
      const p = document.createElement('p');
      p.className   = 'pv-empty';
      p.textContent = 'Agrega montos a las tareas en la vista de Planes para verlos aqui';
      $plansList.appendChild(p);
      return;
    }

    for (const { plan, tasks } of groups) {
      const group = document.createElement('div');
      group.className = 'pv-plan-group';

      const hdr = document.createElement('div');
      hdr.className = 'pv-plan-hdr';
      hdr.style.setProperty('--pc', plan.color);

      const dot = document.createElement('span');
      dot.className = 'pv-plan-dot';

      const pname = document.createElement('span');
      pname.className   = 'pv-plan-name';
      pname.textContent = plan.title;

      const net = tasks.reduce((a, t) => a + (t.amountType === 'ingreso' ? t.amount : -t.amount), 0);
      const netEl = document.createElement('span');
      netEl.className   = 'pv-plan-net ' + (net >= 0 ? 'ingreso' : 'gasto');
      netEl.textContent = (net >= 0 ? '+' : '-') + ' ' + fmtAmt(Math.abs(net));

      hdr.append(dot, pname, netEl);
      group.appendChild(hdr);

      for (const t of tasks) {
        const row = document.createElement('div');
        row.className = 'pv-plan-row';

        const tname = document.createElement('span');
        tname.className   = 'pv-plan-row-name';
        tname.textContent = t.title;

        const isIn = t.amountType === 'ingreso';
        const amt = document.createElement('span');
        amt.className   = 'pv-plan-row-amt ' + (isIn ? 'ingreso' : 'gasto');
        amt.textContent = (isIn ? '+' : '-') + ' ' + fmtAmt(t.amount);

        row.append(tname, amt);
        group.appendChild(row);
      }

      $plansList.appendChild(group);
    }
  }

  // ── Agregar suscripcion ────────────────────────────────────────────────────
  function addSub() {
    const nameInp = document.getElementById('pvSubName');
    const amtInp  = document.getElementById('pvSubAmt');
    const name    = nameInp?.value.trim();
    const amount  = parseFloat(amtInp?.value);
    if (!name || isNaN(amount) || amount <= 0) {
      if (nameInp) nameInp.focus();
      return;
    }
    subscriptions.push({ id: uid(), name, amount, period: selPeriod });
    persist(); render();
    if (nameInp) { nameInp.value = ''; nameInp.focus(); }
    if (amtInp)  amtInp.value = '';
  }

  // ── Vista open / close ─────────────────────────────────────────────────────
  function openView() {
    $view?.classList.add('active');
    document.getElementById('presupuestoBtn')?.classList.add('active');
    document.querySelector('.layout')?.style.setProperty('display', 'none');
    render();
  }

  function closeView() {
    $view?.classList.remove('active');
    document.getElementById('presupuestoBtn')?.classList.remove('active');
    document.querySelector('.layout')?.style.removeProperty('display');
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    $view      = document.getElementById('presupuestoView');
    $subsList  = document.getElementById('pvSubsList');
    $plansList = document.getElementById('pvPlansList');
    $summaryIn  = document.getElementById('pvSummaryIn');
    $summaryOut = document.getElementById('pvSummaryOut');
    $summaryNet = document.getElementById('pvSummaryNet');

    document.querySelectorAll('.pv-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        selPeriod = btn.dataset.p;
        document.querySelectorAll('.pv-period-btn').forEach(b => {
          b.classList.toggle('active', b.dataset.p === selPeriod);
        });
      });
    });

    document.getElementById('pvSubAddBtn')?.addEventListener('click', addSub);
    ['pvSubName', 'pvSubAmt'].forEach(id => {
      document.getElementById(id)?.addEventListener('keydown', e => {
        if (e.key === 'Enter') addSub();
      });
    });
  }

  window.Presupuesto = { init, load, openView, closeView, render };
})();
