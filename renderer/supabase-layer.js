'use strict';

// supabase-layer.js
// Corre en Electron Y en browser.
// - Si credentials no estan configuradas: no hace nada (Electron funciona local-only).
// - En Electron: envuelve window.api para push a Supabase despues de cada save;
//   expone window.api._pullRemote() para sincronizar al arrancar.
// - En browser (PWA): crea window.api completo respaldado por Supabase.

(function () {
  const url  = window.SUPA_URL  || '';
  const anon = window.SUPA_ANON || '';
  if (!url || url.includes('TU-PROYECTO')) return; // credenciales no configuradas

  const { createClient } = window.supabase;
  const sb = createClient(url, anon);

  // ── Auth helpers ──────────────────────────────────────────────────────────
  window.WebAuth = {
    sb,
    async getUser() {
      const { data: { user } } = await sb.auth.getUser();
      return user;
    },
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
  };

  // ── Supabase data helpers ─────────────────────────────────────────────────
  async function uid() {
    const { data: { session } } = await sb.auth.getSession();
    return session?.user?.id ?? null;
  }

  async function fetchAll() {
    const id = await uid();
    if (!id) return {};
    const { data, error } = await sb
      .from('calendar_data')
      .select('key, data')
      .eq('user_id', id);
    if (error) throw error;
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
    const orig = {
      saveDay:     window.api.saveDay.bind(window.api),
      savePending: window.api.savePending.bind(window.api),
      savePrefs:   window.api.savePrefs.bind(window.api),
    };

    window.api.saveDay = async (key, data) => {
      await orig.saveDay(key, data);
      upsertKey(key, data).catch(() => {});
    };
    window.api.savePending = async (tasks) => {
      await orig.savePending(tasks);
      upsertKey('__pending__', tasks).catch(() => {});
    };
    window.api.savePrefs = async (prefs) => {
      await orig.savePrefs(prefs);
      upsertPrefs(prefs).catch(() => {});
    };

    // Called in init() after local load to merge remote data
    window.api._pullRemote = async () => {
      try {
        const user = await window.WebAuth.getUser();
        if (!user) return null;
        return await fetchAll();
      } catch (e) {
        console.warn('[supa] pull failed (offline?):', e.message);
        return null;
      }
    };

    return; // done for Electron
  }

  // ── Browser (PWA) mode: create window.api backed by Supabase ─────────────
  window.api = {
    getData:     fetchAll,
    saveDay:     (key, data) => upsertKey(key, data),
    getDrawing:  async () => null,           // dibujos no sincronizados aun
    saveDrawing: async () => {},
    savePending: (tasks)    => upsertKey('__pending__', tasks),
    getPrefs:    fetchPrefs,
    savePrefs:   upsertPrefs,
  };
})();
