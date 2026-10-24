const { contextBridge, ipcRenderer, webFrame } = require('electron');

contextBridge.exposeInMainWorld('api', {
  win: {
    minimize: () => ipcRenderer.invoke('win:minimize'),
    maximize: () => ipcRenderer.invoke('win:maximize'),
    close:    () => ipcRenderer.invoke('win:close'),
  },
  folder: {
    dialog:   ()        => ipcRenderer.invoke('folder:dialog'),
    add:      (p)       => ipcRenderer.invoke('folder:add', p),
    addFiles: (paths)   => ipcRenderer.invoke('folder:add-files', paths),
    list:     ()        => ipcRenderer.invoke('folder:list'),
    remove:   (id)      => ipcRenderer.invoke('folder:remove', id),
  },
  tracks: {
    list:           (fid)       => ipcRenderer.invoke('tracks:list', fid),
    get:            (id)        => ipcRenderer.invoke('tracks:get', id),
    updateDuration: (id, dur)   => ipcRenderer.invoke('tracks:update-duration', id, dur),
    moveToFolder:   (tid, fid)  => ipcRenderer.invoke('tracks:move-to-folder', tid, fid),
    delete:         (id)        => ipcRenderer.invoke('tracks:delete', id),
  },
  playlist: {
    create:      (name)      => ipcRenderer.invoke('playlist:create', name),
    list:        ()          => ipcRenderer.invoke('playlist:list'),
    delete:      (id)        => ipcRenderer.invoke('playlist:delete', id),
    rename:      (id, name)  => ipcRenderer.invoke('playlist:rename', id, name),
    addTrack:    (pid, tid)  => ipcRenderer.invoke('playlist:add-track', pid, tid),
    removeTrack: (pid, tid)  => ipcRenderer.invoke('playlist:remove-track', pid, tid),
    tracks:      (pid)       => ipcRenderer.invoke('playlist:tracks', pid),
  },
  settings: {
    get: (key, def) => ipcRenderer.invoke('settings:get', key, def),
    set: (key, val) => ipcRenderer.invoke('settings:set', key, val),
  },
  favorites: {
    list:   ()    => ipcRenderer.invoke('favorites:list'),
    ids:    ()    => ipcRenderer.invoke('favorites:ids'),
    toggle: (id)  => ipcRenderer.invoke('favorites:toggle', id),
  },
  playback: {
    saveSync: (data) => ipcRenderer.sendSync('playback:save-sync', data),
  },
  zoom: {
    set: (factor) => webFrame.setZoomFactor(factor),
    get: ()       => webFrame.getZoomFactor(),
  },
  updater: {
    check: () => ipcRenderer.invoke('updater:check'),
  },
  on: {
    tracksUpdated: (cb) => ipcRenderer.on('tracks:updated', () => cb()),
    showToast:     (cb) => ipcRenderer.on('toast:show', (_, msg) => cb(msg)),
  },
});
