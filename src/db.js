const path = require('path');
const fs   = require('fs');
const { app } = require('electron');
const initSqlJs = require('sql.js');

let db;
let dbPath;

// ─── Init ─────────────────────────────────────────────────
async function init() {
  const wasmPath = app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm')
    : path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm');

  const SQL = await initSqlJs({ locateFile: () => wasmPath });

  dbPath = path.join(app.getPath('userData'), 'player.db');

  if (fs.existsSync(dbPath)) {
    db = new SQL.Database(fs.readFileSync(dbPath));
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      path TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tracks (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      path      TEXT UNIQUE NOT NULL,
      title     TEXT NOT NULL,
      artist    TEXT DEFAULT '',
      duration  REAL DEFAULT 0,
      folder_id INTEGER,
      FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS playlists (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      created_at INTEGER DEFAULT (strftime('%s','now'))
    );
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      playlist_id INTEGER NOT NULL,
      track_id    INTEGER NOT NULL,
      position    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (playlist_id, track_id),
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id)    REFERENCES tracks(id)    ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS favorites (
      track_id INTEGER PRIMARY KEY,
      added_at INTEGER DEFAULT (strftime('%s','now')),
      FOREIGN KEY (track_id) REFERENCES tracks(id) ON DELETE CASCADE
    );
  `);

  save();
  app.on('before-quit', save);
}

// ─── Core helpers ─────────────────────────────────────────
function save() {
  if (!db || !dbPath) return;
  try { fs.writeFileSync(dbPath, Buffer.from(db.export())); } catch {}
}

function queryAll(sql, params) {
  const stmt = db.prepare(sql);
  if (params?.length) stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function queryOne(sql, params) {
  const rows = queryAll(sql, params);
  return rows[0] ?? null;
}

function run(sql, params) {
  db.run(sql, params ?? []);
}

// ─── Folders ──────────────────────────────────────────────
function addFolder(folderPath) {
  run('INSERT OR IGNORE INTO folders (path) VALUES (?)', [folderPath]);
  save();
  return queryOne('SELECT id FROM folders WHERE path = ?', [folderPath])?.id;
}

function getFolders() {
  return queryAll('SELECT * FROM folders ORDER BY id');
}

function removeFolder(id) {
  const tracksInFolder = queryAll('SELECT id FROM tracks WHERE folder_id = ?', [id]);
  for (const t of tracksInFolder) deleteTrackRow(t.id);
  run('DELETE FROM folders WHERE id = ?', [id]);
  save();
}

// ─── Tracks ───────────────────────────────────────────────
function addTracks(tracks) {
  run('BEGIN TRANSACTION');
  const stmt = db.prepare(
    'INSERT OR IGNORE INTO tracks (path, title, artist, folder_id) VALUES (?, ?, ?, ?)'
  );
  for (const t of tracks) stmt.run([t.path, t.title, t.artist, t.folder_id]);
  stmt.free();
  run('COMMIT');
  save();
}

function getTracks(folderId) {
  if (folderId != null) {
    return queryAll('SELECT * FROM tracks WHERE folder_id = ? ORDER BY title COLLATE NOCASE', [folderId]);
  }
  return queryAll('SELECT * FROM tracks ORDER BY title COLLATE NOCASE');
}

function getTrack(id) {
  return queryOne('SELECT * FROM tracks WHERE id = ?', [id]);
}

function getFolder(id) {
  return queryOne('SELECT * FROM folders WHERE id = ?', [id]);
}

function updateTrackDuration(id, duration) {
  run('UPDATE tracks SET duration = ? WHERE id = ?', [duration, id]);
  save();
}

function updateTrackPath(id, newPath, newFolderId) {
  run('UPDATE tracks SET path = ?, folder_id = ? WHERE id = ?', [newPath, newFolderId, id]);
  save();
}

// Delete a track and its dependent rows. Done explicitly rather than relying
// on ON DELETE CASCADE — sql.js does not reliably cascade across multiple
// FK-referencing tables in this build.
function deleteTrackRow(id) {
  run('DELETE FROM favorites WHERE track_id = ?', [id]);
  run('DELETE FROM playlist_tracks WHERE track_id = ?', [id]);
  run('DELETE FROM tracks WHERE id = ?', [id]);
}

function deleteTrack(id) {
  deleteTrackRow(id);
  save();
}

// Remove DB tracks under a folder whose file no longer exists on disk
function pruneMissingTracks(folderId, existingPaths) {
  const keep = new Set(existingPaths);
  const rows = queryAll('SELECT id, path FROM tracks WHERE folder_id = ?', [folderId]);
  const removedIds = [];
  for (const r of rows) {
    if (!keep.has(r.path)) {
      deleteTrackRow(r.id);
      removedIds.push(r.id);
    }
  }
  if (removedIds.length) save();
  return removedIds;
}

// ─── Playlists ────────────────────────────────────────────
function createPlaylist(name) {
  run('INSERT INTO playlists (name) VALUES (?)', [name]);
  save();
  return queryOne('SELECT id, name, created_at FROM playlists WHERE name = ? ORDER BY id DESC LIMIT 1', [name]);
}

function getPlaylists() {
  return queryAll('SELECT * FROM playlists ORDER BY created_at DESC');
}

function deletePlaylist(id) {
  run('DELETE FROM playlist_tracks WHERE playlist_id = ?', [id]);
  run('DELETE FROM playlists WHERE id = ?', [id]);
  save();
}

function renamePlaylist(id, name) {
  run('UPDATE playlists SET name = ? WHERE id = ?', [name, id]);
  save();
}

function addToPlaylist(playlistId, trackId) {
  const row = queryOne('SELECT COALESCE(MAX(position),0) AS m FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
  const pos = (row?.m ?? 0) + 1;
  run('INSERT OR IGNORE INTO playlist_tracks (playlist_id, track_id, position) VALUES (?,?,?)', [playlistId, trackId, pos]);
  save();
}

function removeFromPlaylist(playlistId, trackId) {
  run('DELETE FROM playlist_tracks WHERE playlist_id = ? AND track_id = ?', [playlistId, trackId]);
  save();
}

function getPlaylistTracks(playlistId) {
  return queryAll(`
    SELECT t.* FROM tracks t
    JOIN playlist_tracks pt ON pt.track_id = t.id
    WHERE pt.playlist_id = ?
    ORDER BY pt.position
  `, [playlistId]);
}

// ─── Settings ─────────────────────────────────────────────
function getSetting(key, defaultValue) {
  const row = queryOne('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : (defaultValue ?? null);
}

function setSetting(key, value) {
  run('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)', [key, String(value)]);
  save();
}

// ─── Favorites ────────────────────────────────────────────
function getFavoriteTracks() {
  return queryAll(`
    SELECT t.* FROM tracks t
    JOIN favorites f ON f.track_id = t.id
    ORDER BY f.added_at DESC
  `);
}

function getFavoriteIds() {
  return queryAll('SELECT track_id FROM favorites').map(r => r.track_id);
}

function toggleFavorite(trackId) {
  const exists = queryOne('SELECT track_id FROM favorites WHERE track_id = ?', [trackId]);
  if (exists) {
    run('DELETE FROM favorites WHERE track_id = ?', [trackId]);
  } else {
    run('INSERT INTO favorites (track_id) VALUES (?)', [trackId]);
  }
  save();
  return !exists; // true = added, false = removed
}

module.exports = {
  init,
  addFolder, getFolders, removeFolder,
  addTracks, getTracks, updateTrackDuration,
  createPlaylist, getPlaylists, deletePlaylist, renamePlaylist,
  addToPlaylist, removeFromPlaylist, getPlaylistTracks,
  getSetting, setSetting,
  getFavoriteTracks, getFavoriteIds, toggleFavorite,
  getTrack, getFolder, updateTrackPath,
  deleteTrack, pruneMissingTracks,
};
