const { app, BrowserWindow, ipcMain, dialog, protocol, net, shell } = require('electron');
const { autoUpdater } = require('electron-updater');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const db = require('./db');

const AUDIO_EXT = new Set(['.mp3', '.flac', '.ogg', '.wav', '.aac', '.m4a', '.wma', '.opus', '.ape']);
let mainWindow;

const watcherMap = new Map(); // folderId → { watcher, timer }

function watchFolder(folderPath, folderId) {
  if (watcherMap.has(folderId)) return;
  let timer = null;
  let watcher;
  try {
    watcher = fs.watch(folderPath, { recursive: true }, (_event, filename) => {
      if (!filename) return;
      const ext = path.extname(filename).toLowerCase();
      if (!AUDIO_EXT.has(ext)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        scanFolder(folderPath, folderId);
        if (mainWindow) mainWindow.webContents.send('tracks:updated');
      }, 600);
    });
    watcher.on('error', () => watcherMap.delete(folderId));
    watcherMap.set(folderId, { watcher, timer: null });
  } catch { /* folder inaccessible or not supported */ }
}

function unwatchFolder(folderId) {
  const entry = watcherMap.get(folderId);
  if (!entry) return;
  clearTimeout(entry.timer);
  try { entry.watcher.close(); } catch {}
  watcherMap.delete(folderId);
}

app.whenReady().then(async () => {
  // Register media:// protocol — safely serve local audio files (handles Cyrillic paths)
  protocol.handle('media', (req) => {
    const filePath = decodeURIComponent(req.url.slice('media://'.length));
    return net.fetch(pathToFileURL(filePath).href);
  });

  await db.init();
  // Watch all already-registered folders and reconcile any files
  // added/removed on disk while the app was closed.
  for (const f of db.getFolders()) {
    scanFolder(f.path, f.id);
    watchFolder(f.path, f.id);
  }
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1050,
    height: 680,
    minWidth: 720,
    minHeight: 520,
    frame: false,
    backgroundColor: '#111111',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false, // allow file:// audio in renderer
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// Window controls
ipcMain.handle('win:minimize', () => mainWindow.minimize());
ipcMain.handle('win:maximize', () => {
  mainWindow.isMaximized() ? mainWindow.restore() : mainWindow.maximize();
});
ipcMain.handle('win:close', () => mainWindow.close());

// Folder dialog
ipcMain.handle('folder:dialog', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory'],
    title: 'Выберите папку с музыкой',
  });
  return result.canceled ? null : result.filePaths[0];
});

// Folders
ipcMain.handle('folder:add-files', async (_, filePaths) => {
  const dirsToAdd = new Set();
  for (const fp of filePaths) {
    try {
      const stat = fs.statSync(fp);
      if (stat.isDirectory()) {
        dirsToAdd.add(fp);
      } else if (AUDIO_EXT.has(path.extname(fp).toLowerCase())) {
        dirsToAdd.add(path.dirname(fp));
      }
    } catch {}
  }
  for (const dir of dirsToAdd) {
    const id = db.addFolder(dir);
    scanFolder(dir, id);
    watchFolder(dir, id);
  }
  if (dirsToAdd.size > 0 && mainWindow) mainWindow.webContents.send('tracks:updated');
  return dirsToAdd.size;
});

ipcMain.handle('folder:add', async (_, folderPath) => {
  const id = db.addFolder(folderPath);
  const count = scanFolder(folderPath, id);
  watchFolder(folderPath, id);
  return count;
});
ipcMain.handle('folder:list', () => db.getFolders());
ipcMain.handle('folder:remove', (_, id) => {
  unwatchFolder(id);
  db.removeFolder(id);
});

// Tracks
ipcMain.handle('tracks:list', (_, folderId) => db.getTracks(folderId ?? null));
ipcMain.handle('tracks:get', (_, id) => {
  const track = db.getTrack(id);
  if (track && fs.existsSync(track.path)) return track;
  return null;
});
ipcMain.handle('tracks:update-duration', (_, id, dur) => db.updateTrackDuration(id, dur));
ipcMain.handle('tracks:move-to-folder', async (_, trackId, folderId) => {
  const track  = db.getTrack(trackId);
  const folder = db.getFolder(folderId);
  if (!track || !folder) return false;
  const newPath = path.join(folder.path, path.basename(track.path));
  if (newPath === track.path) return true;
  try {
    if (fs.existsSync(newPath)) return false;
    fs.renameSync(track.path, newPath);
    db.updateTrackPath(trackId, newPath, folderId);
    return true;
  } catch { return false; }
});
ipcMain.handle('tracks:delete', async (_, trackId) => {
  const track = db.getTrack(trackId);
  if (!track) return false;
  try {
    await shell.trashItem(track.path);
  } catch {
    try { fs.unlinkSync(track.path); } catch { /* file already gone */ }
  }
  db.deleteTrack(trackId);
  return true;
});

// Playlists
ipcMain.handle('playlist:create', (_, name) => db.createPlaylist(name));
ipcMain.handle('playlist:list', () => db.getPlaylists());
ipcMain.handle('playlist:delete', (_, id) => db.deletePlaylist(id));
ipcMain.handle('playlist:rename', (_, id, name) => db.renamePlaylist(id, name));
ipcMain.handle('playlist:add-track', (_, pid, tid) => db.addToPlaylist(pid, tid));
ipcMain.handle('playlist:remove-track', (_, pid, tid) => db.removeFromPlaylist(pid, tid));
ipcMain.handle('playlist:tracks', (_, pid) => db.getPlaylistTracks(pid));

// Settings
ipcMain.handle('settings:get', (_, key, def) => db.getSetting(key, def));
ipcMain.handle('settings:set', (_, key, val) => db.setSetting(key, val));

// Synchronous playback cache save (e.g. on window close/beforeunload)
ipcMain.on('playback:save-sync', (event, data) => {
  try {
    if (data.trackId) db.setSetting('last_track_id', String(data.trackId));
    if (data.time != null) db.setSetting('last_track_time', String(data.time));
    if (data.view) db.setSetting('last_view', JSON.stringify(data.view));
  } catch {}
  event.returnValue = true;
});

// Favorites
ipcMain.handle('favorites:list',   ()       => db.getFavoriteTracks());
ipcMain.handle('favorites:ids',    ()       => db.getFavoriteIds());
ipcMain.handle('favorites:toggle', (_, id)  => db.toggleFavorite(id));

function parseName(filename) {
  // Strip leading track numbers: "01 ", "01. ", "01 - "
  let name = filename.replace(/^\d+[\.\s\-]+\s*/, '').trim();
  const dashIdx = name.indexOf(' - ');
  if (dashIdx !== -1) {
    return { artist: name.slice(0, dashIdx).trim(), title: name.slice(dashIdx + 3).trim() };
  }
  return { artist: '', title: name };
}

function scanFolder(folderPath, folderId) {
  const tracks = [];

  function walk(dir) {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full);
      } else if (AUDIO_EXT.has(path.extname(e.name).toLowerCase())) {
        const { artist, title } = parseName(path.basename(e.name, path.extname(e.name)));
        tracks.push({ path: full, title, artist, folder_id: folderId });
      }
    }
  }

  walk(folderPath);
  if (tracks.length > 0) db.addTracks(tracks);
  db.pruneMissingTracks(folderId, tracks.map(t => t.path));
  return tracks.length;
}

// ─── Auto Updater ──────────────────────────────────────────
let isManualUpdateCheck = false;

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  function handleUpdaterError(err) {
    const errStr = String(err?.message || err || '');
    const is404 = err?.statusCode === 404 || errStr.includes('404');
    if (is404) {
      // 404 означает, что интернет есть, но на GitHub пока не создан раздел Releases
      if (isManualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toast:show', 'На GitHub пока нет опубликованных релизов');
      }
    } else {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toast:show', 'Не удалось проверить наличие обновления');
      }
    }
    isManualUpdateCheck = false;
  }

  // Автоматическая проверка через 3 секунды после запуска
  setTimeout(() => {
    if (app.isPackaged) {
      isManualUpdateCheck = false;
      autoUpdater.checkForUpdates().catch(handleUpdaterError);
    }
  }, 3000);

  autoUpdater.on('error', (err) => handleUpdaterError(err));

  autoUpdater.on('update-available', (info) => {
    isManualUpdateCheck = false;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Доступно обновление',
      message: `Найдена новая версия Player ${info.version}!`,
      detail: 'Хотите скачать и установить новую версию сейчас?',
      buttons: ['Обновить', 'Позже'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('toast:show', 'Загрузка новой версии...');
        }
        autoUpdater.downloadUpdate();
      }
    });
  });

  autoUpdater.on('update-not-available', () => {
    if (isManualUpdateCheck && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('toast:show', 'У вас установлена последняя версия');
    }
    isManualUpdateCheck = false;
  });

  autoUpdater.on('update-downloaded', (info) => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Обновление готово к установке',
      message: `Версия ${info.version} успешно загружена!`,
      detail: 'Перезапустить плеер сейчас для применения обновления?',
      buttons: ['Перезапустить сейчас', 'При следующем закрытии'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall(false, true);
      }
    });
  });

  ipcMain.handle('updater:check', async () => {
    isManualUpdateCheck = true;
    try {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toast:show', 'Проверка обновлений...');
      }
      const res = await autoUpdater.checkForUpdates();
      return { ok: true, version: res?.updateInfo?.version };
    } catch (err) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('toast:show', 'Не удалось проверить наличие обновления');
      }
      return { ok: false, error: err.message };
    }
  });
}
