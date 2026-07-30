const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('node:path');
const fs   = require('node:fs');

// ── paths ──────────────────────────────────────────────────────────────────
const dataFile    = () => path.join(app.getPath('userData'), 'data.json');
const drawingsDir = () => path.join(app.getPath('userData'), 'drawings');
const prefsFile   = () => path.join(app.getPath('userData'), 'prefs.json');

function ensureDirs() {
  fs.mkdirSync(drawingsDir(), { recursive: true });
}

// ── data helpers ───────────────────────────────────────────────────────────
function readAll() {
  try { return JSON.parse(fs.readFileSync(dataFile(), 'utf8')); }
  catch { return {}; }
}

function writeAll(obj) {
  fs.writeFileSync(dataFile(), JSON.stringify(obj, null, 2), 'utf8');
}

// ── window ─────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 820,
    minHeight: 560,
    icon: path.join(__dirname, 'Calendaria.ico'),
    title: 'Calendaria',
    backgroundColor: '#F5F1EB',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    show: false,
  });

  win.loadFile('renderer/index.html');
  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());
}

// ── IPC handlers ───────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ensureDirs();

  // all calendar data (without drawings)
  ipcMain.handle('getData', () => readAll());

  // save one day's note + tasks + hasDrawing flag
  ipcMain.handle('saveDay', (_, key, dayData) => {
    const all = readAll();
    all[key] = { ...(all[key] || {}), ...dayData };
    writeAll(all);
  });

  // load drawing for a day (returns data-url or null)
  ipcMain.handle('getDrawing', (_, key) => {
    const file = path.join(drawingsDir(), `${key}.png`);
    if (!fs.existsSync(file)) return null;
    return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64');
  });

  // save drawing (data-url -> png file). Returns true if content exists.
  ipcMain.handle('saveDrawing', (_, key, dataUrl) => {
    const file = path.join(drawingsDir(), `${key}.png`);

    // blank canvas  → remove file
    if (!dataUrl || dataUrl.length < 200) {
      try { fs.unlinkSync(file); } catch {}
      const all = readAll();
      if (all[key]) { all[key].hasDrawing = false; writeAll(all); }
      return false;
    }

    const b64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
    fs.writeFileSync(file, Buffer.from(b64, 'base64'));
    const all = readAll();
    if (!all[key]) all[key] = { note: '', tasks: [], hasDrawing: false };
    all[key].hasDrawing = true;
    writeAll(all);
    return true;
  });

  // global pending tasks (unassigned to any day)
  ipcMain.handle('savePending', (_, tasks) => {
    const all = readAll();
    all['__pending__'] = tasks;
    writeAll(all);
  });

  // user preferences (theme)
  ipcMain.handle('getPrefs', () => {
    try { return JSON.parse(fs.readFileSync(prefsFile(), 'utf8')); }
    catch { return {}; }
  });
  ipcMain.handle('savePrefs', (_, prefs) => {
    fs.writeFileSync(prefsFile(), JSON.stringify(prefs), 'utf8');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
