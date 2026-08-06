'use strict';

// supabase-layer.js
// En Electron: envuelve window.api para que getData() ya incluya datos de Supabase,
//   y cada save va a local + Supabase simultaneamente.
// En browser (PWA): crea window.api completo respaldado por Supabase.
// Si credentials no estan configuradas, no hace nada.

(function () {
  const url  = window.SUPA_URL  || '';
  const anon = window.SUPA_ANON || '';
  if (!url || url.includes('TU-PROYECTO')) return;

  const { createClient } = window.supabase;
  const sb = createClient(url, anon);

  // ── Auth helpers ──────────────────────────────────────────────────────────
  window.WebAuth = {
    sb,
    async signIn(email, password) {
      const { error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
    },
    async signUp(email, password) {
      const { error } = await sb.auth.signUp({ email, password });
      if (error) throw error;
    },
    async signOut() {
      await sb.auth.signOut();
      location.reload();
    },
    // Suscripcion en tiempo real — llama desde app.js despues de autenticar
    async startSync() {
      const id = await uid();
      if (!id) return;
      sb.channel('cal_' + id)
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'calendar_data',
          filter: `user_id=eq.${id}`,
        }, payload => {
          if (!payload.new) return;
          window.dispatchEvent(new CustomEvent('supa-sync', {
            detail: { key: payload.new.key, data: payload.new.data },
          }));
        })
        .subscribe();
    },
  };

  // ── Supabase data helpers ─────────────────────────────────────────────────
  async function uid() {
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.id ?? null;
  }

  async function fetchAll() {
    const id = await uid();
    if (!id) return null; // null = no autenticado
    const { data, error } = await sb
      .from('calendar_data')
      .select('key, data')
      .eq('user_id', id);
    if (error) { console.warn('[supa] fetchAll error:', error.message); return null; }
    const result = {};
    for (const row of (data ?? [])) result[row.key] = row.data;
    return result;
  }

  async function upsertKey(key, data) {
    const id = await uid();
    if (!id) return;
    const { error } = await sb.from('calendar_data').upsert(
      { user_id: id, key, data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,key' }
    );
    if (error) console.warn('[supa] upsert error:', error.message);
  }

  async function fetchPrefs() {
    const id = await uid();
    if (!id) return {};
    const { data } = await sb
      .from('user_prefs')
      .select('prefs')
      .eq('user_id', id)
      .maybeSingle();
    return data?.prefs ?? {};
  }

  async function upsertPrefs(prefs) {
    const id = await uid();
    if (!id) return;
    await sb.from('user_prefs').upsert(
      { user_id: id, prefs, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    );
  }

  // ── Electron mode: wrap existing window.api ───────────────────────────────
  if (window.api) {
    window.api.__isElectron = true;

    const origGetData  = window.api.getData.bind(window.api);
    const origSaveDay  = window.api.saveDay.bind(window.api);
    const origSavePend = window.api.savePending.bind(window.api);
    const origSavePref = window.api.savePrefs.bind(window.api);

    // getData: carga local primero, luego reemplaza con Supabase si hay sesion
    window.api.getData = async () => {
      const local = await origGetData();
      try {
        const remote = await fetchAll();
        if (remote) return Object.assign(local || {}, remote); // Supabase gana
      } catch (e) {
        console.warn('[supa] getData remote failed:', e.message);
      }
      return local || {};
    };

    // saves: local + Supabase en paralelo
    window.api.saveDay = async (key, data) => {
      await origSaveDay(key, data);
      upsertKey(key, data).catch(e => console.warn('[supa] saveDay:', e.message));
    };
    window.api.savePending = async (tasks) => {
      await origSavePend(tasks);
      upsertKey('__pending__', tasks).catch(() => {});
    };
    window.api.savePrefs = async (prefs) => {
      await origSavePref(prefs);
      upsertPrefs(prefs).catch(() => {});
    };

    return;
  }

  // ── Browser (PWA) mode: window.api respaldado por Supabase ───────────────
  window.api = {
    getData:     async () => (await fetchAll()) ?? {},
    saveDay:     (key, data) => upsertKey(key, data),
    getDrawing:  async () => null,
    saveDrawing: async () => {},
    savePending: (tasks) => upsertKey('__pending__', tasks),
    getPrefs:    fetchPrefs,
    savePrefs:   upsertPrefs,
  };
})();
