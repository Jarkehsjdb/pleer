'use strict';

const audio = document.getElementById('audio');

let tracks = [];
let currentIndex = -1;
let currentTrackId = null;
let view = { type: 'all', id: null };
let playlists = [];
let folders = [];
let playingSourceName = '';
let favorites = new Set(); // track IDs
let shuffle = false;
let repeat = 0; // 0=off 1=all 2=one
let ctxTrack = null;
let searchQuery = '';

// Settings state
let currentTheme  = 'dark';
let currentAccent = null;
let isCompact     = false;
let textBright    = false;
let currentSort   = 'title';
let currentScale  = 1.0;

const SCALES = [
  { label: '80%',  value: 0.8  },
  { label: '90%',  value: 0.9  },
  { label: '100%', value: 1.0  },
  { label: '110%', value: 1.1  },
  { label: '125%', value: 1.25 },
  { label: '150%', value: 1.5  },
];

// ─── SVG Icons ────────────────────────────────────────────
const SVG = {
  play:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 3l14 9-14 9V3z"/></svg>`,
  pause:     `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>`,
  prev:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M5 4h3v16H5zm13 16L9 12l9-8z"/></svg>`,
  next:      `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 4h3v16h-3zM6 20l9-8-9-8z"/></svg>`,
  shuffle:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>`,
  repeat:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/></svg>`,
  repeatOne: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><polyline points="7 23 3 19 7 15"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/><text x="12" y="13" font-size="7" fill="currentColor" stroke="none" text-anchor="middle" dominant-baseline="middle" font-family="sans-serif">1</text></svg>`,
};

// ─── Web Audio / Waveform ─────────────────────────────────
let audioCtx   = null;
let analyser   = null;
let waveSrc    = null;
let waveAnimId = null;
let switching  = false;

function setupAudioCtx() {
  if (waveSrc) return;
  audioCtx = new AudioContext();
  analyser  = audioCtx.createAnalyser();
  analyser.fftSize = 256;
  analyser.smoothingTimeConstant = 0.8;
  waveSrc = audioCtx.createMediaElementSource(audio);
  waveSrc.connect(analyser);
  analyser.connect(audioCtx.destination);
}

function accentColor() {
  return getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#fff';
}

function startWave() {
  cancelAnimationFrame(waveAnimId);
  const canvas = document.getElementById('waveform');
  if (!canvas || !analyser) return;
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  const bins = analyser.frequencyBinCount;
  const data = new Uint8Array(bins);
  const COUNT = 72;
  const bw  = W / COUNT;
  const gap = Math.max(1, bw * 0.18);

  function frame() {
    waveAnimId = requestAnimationFrame(frame);
    analyser.getByteFrequencyData(data);
    ctx.clearRect(0, 0, W, H);
    const color = accentColor();
    for (let i = 0; i < COUNT; i++) {
      const di = Math.round(i * bins * 0.7 / COUNT); // use lower 70% of spectrum
      const v  = data[di] / 255;
      const bh = Math.max(2, v * H * 0.92);
      ctx.fillStyle = color;
      ctx.globalAlpha = 0.25 + v * 0.75;
      ctx.fillRect(i * bw + gap / 2, (H - bh) / 2, bw - gap, bh);
    }
    ctx.globalAlpha = 1;
  }
  frame();
}

function stopWave() {
  cancelAnimationFrame(waveAnimId);
  waveAnimId = null;
  drawIdleWave();
}

function drawIdleWave() {
  const canvas = document.getElementById('waveform');
  if (!canvas) return;
  const dpr  = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  if (!rect.width) return;
  canvas.width  = rect.width  * dpr;
  canvas.height = rect.height * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const W = rect.width, H = rect.height;
  ctx.clearRect(0, 0, W, H);
  const COUNT = 72;
  const bw  = W / COUNT;
  const gap = Math.max(1, bw * 0.18);
  ctx.fillStyle = accentColor();
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < COUNT; i++) {
    ctx.fillRect(i * bw + gap / 2, H / 2 - 1, bw - gap, 2);
  }
  ctx.globalAlpha = 1;
}

function initButtons() {
  document.getElementById('btn-play').innerHTML    = SVG.play;
  document.getElementById('btn-prev').innerHTML    = SVG.prev;
  document.getElementById('btn-next').innerHTML    = SVG.next;
  document.getElementById('btn-shuffle').innerHTML = SVG.shuffle;
  document.getElementById('btn-repeat').innerHTML  = SVG.repeat;
}

const ACCENTS = [
  { color: null,      bg: 'linear-gradient(135deg,#fff 50%,#222 50%)', label: 'Авто' },
  { color: '#4dabf7', label: 'Синий'       },
  { color: '#51cf66', label: 'Зелёный'     },
  { color: '#ff6b6b', label: 'Красный'     },
  { color: '#fcc419', label: 'Жёлтый'     },
  { color: '#cc5de8', label: 'Фиолетовый'  },
];

// ─── Init ────────────────────────────────────────────────
async function init() {
  const vol = await api.settings.get('volume', '80');
  document.getElementById('volume').value = vol;
  audio.volume = Number(vol) / 100;
  updateVolumeBar();

  currentTheme  = await api.settings.get('theme', 'dark');
  currentAccent = (await api.settings.get('accent', '')) || null;
  isCompact     = (await api.settings.get('compact', '0')) === '1';
  textBright    = (await api.settings.get('textBright', '0')) === '1';
  currentSort   = await api.settings.get('sort', 'title');
  currentScale  = parseFloat(await api.settings.get('scale', '1')) || 1.0;

  applyTheme(currentTheme, false);
  applyAccent(currentAccent, false);
  applyCompact(isCompact, false);
  applyTextBright(textBright, false);
  applyScale(currentScale, false);
  syncSortBar();

  const favIds = await api.favorites.ids();
  favorites = new Set(favIds);

  initButtons();
  bindControls();
  bindSettings();
  bindAudio();

  // Restore saved view if exists
  const savedViewStr = await api.settings.get('last_view', null);
  if (savedViewStr) {
    try {
      const parsedView = JSON.parse(savedViewStr);
      if (parsedView && parsedView.type) {
        view = parsedView;
      }
    } catch {}
  }

  await refreshFolders();
  await refreshPlaylists();
  updateNavActive();
  await loadTracks();
  await restoreLastPlayback();
  setTimeout(drawIdleWave, 150);
}

function updateNavActive() {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  if (view.type === 'all') {
    document.getElementById('nav-all')?.classList.add('active');
  } else if (view.type === 'favorites') {
    document.getElementById('nav-favorites')?.classList.add('active');
  } else if (view.type === 'folder' && view.id != null) {
    const li = document.querySelector(`#folder-list li[data-fid="${view.id}"]`);
    if (li) {
      li.classList.add('active');
    } else {
      view = { type: 'all', id: null };
      document.getElementById('nav-all')?.classList.add('active');
    }
  } else if (view.type === 'playlist' && view.id != null) {
    const li = document.querySelector(`#playlist-list li[data-pid="${view.id}"]`);
    if (li) {
      li.classList.add('active');
    } else {
      view = { type: 'all', id: null };
      document.getElementById('nav-all')?.classList.add('active');
    }
  } else {
    view = { type: 'all', id: null };
    document.getElementById('nav-all')?.classList.add('active');
  }
}

// ─── Data ─────────────────────────────────────────────────
async function refreshFolders() {
  folders = await api.folder.list();
  const ul = document.getElementById('folder-list');
  ul.innerHTML = '';

  for (const f of folders) {
    const name = f.path.split(/[\\/]/).pop();
    const li = navItem(name, f.path, () => {
      activateNav(li);
      view = { type: 'folder', id: f.id };
      loadTracks();
      closeSettings();
    }, async () => {
      await api.folder.remove(f.id);
      if (view.type === 'folder' && view.id === f.id) {
        view = { type: 'all', id: null };
        activateNav(document.getElementById('nav-all'));
      }
      await refreshFolders();
      await loadTracks();
    });
    li.dataset.fid = String(f.id);
    if (view.type === 'folder' && view.id === f.id) li.classList.add('active');
    // Drop track onto folder → move file to that folder on disk
    li.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/x-track-id')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        li.classList.add('drag-over');
      }
    });
    li.addEventListener('dragleave', (e) => {
      if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over');
    });
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const trackId = parseInt(e.dataTransfer.getData('text/x-track-id'), 10);
      if (!isNaN(trackId)) {
        await api.tracks.moveToFolder(trackId, f.id);
        await loadTracks();
      }
    });

    ul.appendChild(li);
  }
}

async function refreshPlaylists() {
  playlists = await api.playlist.list();
  const ul = document.getElementById('playlist-list');
  ul.innerHTML = '';
  for (const p of playlists) {
    const li = navItem(p.name, '', () => {
      activateNav(li);
      view = { type: 'playlist', id: p.id };
      loadTracks();
      closeSettings();
    }, async () => {
      await api.playlist.delete(p.id);
      if (view.type === 'playlist' && view.id === p.id) {
        view = { type: 'all', id: null };
        activateNav(document.getElementById('nav-all'));
      }
      await refreshPlaylists();
      await loadTracks();
    });
    li.dataset.pid = p.id;

    // Drop target: accept dragged tracks
    li.addEventListener('dragover', (e) => {
      if (e.dataTransfer.types.includes('text/x-track-id')) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        li.classList.add('drag-over');
      }
    });
    li.addEventListener('dragleave', (e) => {
      if (!li.contains(e.relatedTarget)) li.classList.remove('drag-over');
    });
    li.addEventListener('drop', async (e) => {
      e.preventDefault();
      li.classList.remove('drag-over');
      const trackId = parseInt(e.dataTransfer.getData('text/x-track-id'));
      if (!isNaN(trackId)) {
        await api.playlist.addTrack(p.id, trackId);
        if (view.type === 'playlist' && view.id === p.id) await loadTracks();
      }
    });

    ul.appendChild(li);
    if (view.type === 'playlist' && view.id === p.id) li.classList.add('active');
  }
}

async function loadTracks() {
  searchQuery = '';
  const si = document.getElementById('search-input');
  if (si) si.value = '';
  const sc = document.getElementById('search-clear');
  if (sc) sc.classList.remove('visible');
  let raw;
  if (view.type === 'favorites') {
    raw = await api.favorites.list();
  } else if (view.type === 'playlist') {
    raw = await api.playlist.tracks(view.id);
  } else {
    raw = await api.tracks.list(view.type === 'folder' ? view.id : undefined);
  }
  tracks = sortTracks(raw, currentSort);
  currentIndex = currentTrackId != null ? tracks.findIndex(t => t.id === currentTrackId) : -1;
  if (currentTrackId != null && currentIndex === -1) {
    const stillExists = api.tracks.get ? await api.tracks.get(currentTrackId) : null;
    if (!stillExists) {
      audio.pause();
      audio.src = '';
      currentTrackId = null;
      document.getElementById('p-title').textContent = '';
      document.getElementById('p-source').textContent = '';
      api.settings.set('last_track_id', '0');
      api.settings.set('last_track_time', '0');
    }
  }
  renderTracks();
  probeDurations(tracks);
}

// ─── Render ───────────────────────────────────────────────
function renderTracks() {
  const el = document.getElementById('track-list');
  if (tracks.length === 0) {
    el.innerHTML = `<div class="empty">
      <div>${view.type === 'playlist' ? 'Плейлист пуст' : view.type === 'favorites' ? 'Нет любимых треков' : 'Нет треков'}</div>
      ${view.type === 'all' ? '<small>Добавьте папку с музыкой (+)</small>' : ''}
    </div>`;
    return;
  }

  el.innerHTML = '';
  tracks.forEach((t, i) => {
    const displayTitle = t.artist ? `${t.artist} — ${t.title}` : t.title;
    const liked = favorites.has(t.id);

    const div = document.createElement('div');
    div.className = 'track-item' + (t.id === currentTrackId ? ' playing' : '');
    div.dataset.trackIdx = String(i);

    const numSpan = document.createElement('span');
    numSpan.className = 'c-num';
    if (t.id === currentTrackId) {
      numSpan.innerHTML = '<span class="eq-bars"><span class="eq-bar"></span><span class="eq-bar"></span><span class="eq-bar"></span></span>';
    } else {
      numSpan.textContent = String(i + 1);
    }

    const titleSpan = document.createElement('span');
    titleSpan.className = 'c-title';
    titleSpan.title = displayTitle;
    titleSpan.textContent = displayTitle;

    const durSpan = document.createElement('span');
    durSpan.className = 'c-dur';
    durSpan.textContent = fmt(t.duration);

    const heartBtn = document.createElement('button');
    heartBtn.className = 'heart-btn' + (liked ? ' liked' : '');
    heartBtn.textContent = liked ? '♥' : '♡';
    heartBtn.title = liked ? 'Убрать из любимого' : 'Добавить в любимое';
    heartBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      await api.favorites.toggle(t.id);
      if (favorites.has(t.id)) {
        favorites.delete(t.id);
        heartBtn.classList.remove('liked');
        heartBtn.textContent = '♡';
        heartBtn.title = 'Добавить в любимое';
        if (view.type === 'favorites') loadTracks();
      } else {
        favorites.add(t.id);
        heartBtn.classList.add('liked');
        heartBtn.textContent = '♥';
        heartBtn.title = 'Убрать из любимого';
      }
    });

    const delBtn = document.createElement('button');
    delBtn.className = 'del-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Удалить трек';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      confirmDeleteTrack(t);
    });

    div.append(numSpan, titleSpan, durSpan, heartBtn, delBtn);
    div.addEventListener('click', () => play(i));
    div.addEventListener('contextmenu', (e) => showCtx(e, t));

    // Drag track to playlist
    div.draggable = true;
    div.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'copy';
      e.dataTransfer.setData('text/x-track-id', String(t.id));
      setTimeout(() => div.classList.add('dragging'), 0);
    });
    div.addEventListener('dragend', () => div.classList.remove('dragging'));

    el.appendChild(div);
  });
  applySearch();
}

// ─── Search filter ────────────────────────────────────────
function applySearch() {
  const q = searchQuery.toLowerCase().trim();
  const list = document.getElementById('track-list');
  if (!list) return;
  let visible = 0;
  list.querySelectorAll('.track-item').forEach(div => {
    const idx = parseInt(div.dataset.trackIdx, 10);
    const t = tracks[idx];
    if (!t) return;
    const match = !q || t.title.toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q);
    div.classList.toggle('search-hidden', !match);
    if (match) visible++;
  });
  let noRes = list.querySelector('.search-no-results');
  if (q && visible === 0 && tracks.length > 0) {
    if (!noRes) {
      noRes = document.createElement('div');
      noRes.className = 'empty search-no-results';
      noRes.innerHTML = '<div>Ничего не найдено</div>';
      list.appendChild(noRes);
    }
  } else if (noRes) {
    noRes.remove();
  }
}

// ─── Playback ─────────────────────────────────────────────
function play(index) {
  if (index < 0 || index >= tracks.length) return;
  currentIndex = index;
  currentTrackId = tracks[index].id;
  const t = tracks[index];
  switching = true;
  setupAudioCtx();
  if (audioCtx) audioCtx.resume();
  audio.src = pathToUrl(t.path);
  audio.play().finally(() => { switching = false; });
  const displayTitle = t.artist ? `${t.artist} — ${t.title}` : t.title;
  document.getElementById('p-title').textContent = displayTitle;
  playingSourceName = getSourceName(view);
  document.getElementById('p-source').textContent = playingSourceName;
  renderTracks();
  savePlaybackState(true);
}

function pathToUrl(filePath) {
  const fwdSlash = filePath.replace(/\\/g, '/');
  const encoded = fwdSlash.split('/').map((p, i) => {
    if (i === 0 && /^[a-zA-Z]:$/.test(p)) return p;
    return encodeURIComponent(p);
  }).join('/');
  return 'file:///' + encoded;
}

function togglePlay() {
  if (!audio.src || audio.src === location.href) {
    if (tracks.length) play(0);
    return;
  }
  if (audio.paused) {
    setupAudioCtx();
    if (audioCtx) audioCtx.resume();
    audio.play();
  } else {
    audio.pause();
  }
}

// ─── Playback state caching ───────────────────────────────
let lastSavedSec = -1;
let saveTimer = null;

function savePlaybackState(immediate = false) {
  if (!currentTrackId) return;
  const curTime = audio.currentTime || 0;
  const curSec = Math.floor(curTime);

  const doSave = () => {
    lastSavedSec = curSec;
    let timeToSave = curTime;
    if (audio.ended || (audio.duration && curTime >= audio.duration - 0.5)) {
      timeToSave = 0;
    }
    const data = {
      trackId: currentTrackId,
      time: timeToSave,
      view: view
    };
    if (immediate && window.api?.playback?.saveSync) {
      window.api.playback.saveSync(data);
    } else {
      api.settings.set('last_track_id', String(data.trackId));
      api.settings.set('last_track_time', String(data.time));
      api.settings.set('last_view', JSON.stringify(data.view));
    }
  };

  if (immediate) {
    clearTimeout(saveTimer);
    saveTimer = null;
    doSave();
  } else {
    if (Math.abs(curSec - lastSavedSec) >= 2) {
      lastSavedSec = curSec;
      clearTimeout(saveTimer);
      saveTimer = setTimeout(doSave, 400);
    }
  }
}

async function restoreLastPlayback() {
  const savedTrackId = parseInt(await api.settings.get('last_track_id', '0'), 10);
  const savedTime = parseFloat(await api.settings.get('last_track_time', '0')) || 0;

  if (!savedTrackId) return;

  let track = tracks.find(t => t.id === savedTrackId);
  if (!track && api.tracks.get) {
    track = await api.tracks.get(savedTrackId);
  }
  if (!track) return;

  currentTrackId = track.id;
  currentIndex = tracks.findIndex(t => t.id === track.id);

  audio.src = pathToUrl(track.path);
  audio.pause();

  const displayTitle = track.artist ? `${track.artist} — ${track.title}` : track.title;
  document.getElementById('p-title').textContent = displayTitle;
  playingSourceName = getSourceName(view);
  document.getElementById('p-source').textContent = playingSourceName;

  document.getElementById('btn-play').innerHTML = SVG.play;
  document.body.classList.remove('audio-playing');

  const dur = track.duration || 0;
  const initialTime = (dur > 0 && savedTime >= dur) ? 0 : savedTime;

  if (dur > 0) {
    document.getElementById('t-total').textContent = fmt(dur);
    const pct = initialTime / dur;
    document.getElementById('progress').value = pct * 1000;
    document.getElementById('t-cur').textContent = fmt(initialTime);
    updateProgressBar(pct * 100);
  } else {
    document.getElementById('t-cur').textContent = fmt(initialTime);
  }

  const setAudioTime = () => {
    if (initialTime > 0 && isFinite(initialTime)) {
      try {
        const maxTime = (audio.duration && audio.duration > 0) ? audio.duration : initialTime + 1;
        audio.currentTime = Math.min(initialTime, maxTime);
      } catch {}
    }
    const finalDur = audio.duration || track.duration || 0;
    const finalCur = audio.currentTime || initialTime || 0;
    if (finalDur > 0) {
      document.getElementById('t-total').textContent = fmt(finalDur);
      const pct = finalCur / finalDur;
      document.getElementById('progress').value = pct * 1000;
      document.getElementById('t-cur').textContent = fmt(finalCur);
      updateProgressBar(pct * 100);
    }
  };

  if (audio.readyState >= 1) {
    setAudioTime();
  } else {
    audio.addEventListener('loadedmetadata', setAudioTime, { once: true });
  }

  renderTracks();
}

function prevTrack() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  play(currentIndex > 0 ? currentIndex - 1 : tracks.length - 1);
}

function nextTrack() {
  if (!tracks.length) return;
  if (repeat === 2) { audio.currentTime = 0; audio.play(); return; }
  let next = shuffle ? Math.floor(Math.random() * tracks.length) : currentIndex + 1;
  if (next >= tracks.length) {
    if (repeat === 1) next = 0; else return;
  }
  play(next);
}

// ─── Duration probing ─────────────────────────────────────
function probeDurations(list) {
  const toProbe = list.filter(t => !t.duration || t.duration === 0).slice(0, 50);
  if (!toProbe.length) return;
  let updated = false;

  async function runBatch(i) {
    if (i >= toProbe.length) { if (updated) renderTracks(); return; }
    await Promise.all(toProbe.slice(i, i + 6).map(probeOne));
    runBatch(i + 6);
  }

  function probeOne(t) {
    return new Promise(resolve => {
      const a = new Audio();
      a.preload = 'metadata';
      a.src = pathToUrl(t.path);
      const done = () => {
        if (a.duration && isFinite(a.duration)) {
          t.duration = a.duration;
          api.tracks.updateDuration(t.id, a.duration);
          updated = true;
        }
        a.src = '';
        resolve();
      };
      a.onloadedmetadata = done;
      a.onerror = done;
      setTimeout(done, 4000);
    });
  }
  runBatch(0);
}

// ─── Sort ─────────────────────────────────────────────────
function sortTracks(arr, by) {
  if (by === 'artist') {
    return [...arr].sort((a, b) =>
      (a.artist || '').localeCompare(b.artist || '') || a.title.localeCompare(b.title));
  }
  if (by === 'date') {
    return [...arr].sort((a, b) => b.id - a.id);
  }
  return arr; // 'title' — already ordered by DB
}

function getSourceName(v) {
  if (v.type === 'all')       return 'Все треки';
  if (v.type === 'favorites') return '♥ Любимое';
  if (v.type === 'playlist') {
    const pl = playlists.find(p => p.id === v.id);
    return pl ? `♪ ${pl.name}` : '';
  }
  if (v.type === 'folder') {
    const f = folders.find(fo => fo.id === v.id);
    return f ? f.path.split(/[\\/]/).pop() : '';
  }
  return '';
}

function syncSortBar() {
  document.querySelectorAll('.sort-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.sort === currentSort));
}

// ─── Controls ─────────────────────────────────────────────
function bindControls() {
  document.getElementById('btn-min').onclick   = () => api.win.minimize();
  document.getElementById('btn-max').onclick   = () => api.win.maximize();
  document.getElementById('btn-close').onclick = () => {
    savePlaybackState(true);
    api.win.close();
  };
  window.addEventListener('beforeunload', () => savePlaybackState(true));

  document.getElementById('btn-play').onclick = togglePlay;
  document.getElementById('btn-prev').onclick = prevTrack;
  document.getElementById('btn-next').onclick = nextTrack;

  document.getElementById('btn-shuffle').onclick = function () {
    shuffle = !shuffle;
    this.classList.toggle('active', shuffle);
  };

  document.getElementById('btn-repeat').onclick = function () {
    repeat = (repeat + 1) % 3;
    this.classList.toggle('active', repeat > 0);
    this.innerHTML = repeat === 2 ? SVG.repeatOne : SVG.repeat;
    this.title = ['Повтор выкл.', 'Повтор плейлиста', 'Повтор трека'][repeat];
  };

  document.getElementById('progress').oninput = () => {
    const p = document.getElementById('progress');
    if (audio.duration) {
      audio.currentTime = (p.value / 1000) * audio.duration;
      document.getElementById('t-cur').textContent = fmt(audio.currentTime);
      updateProgressBar((p.value / 1000) * 100);
      savePlaybackState(false);
    }
  };
  document.getElementById('progress').onchange = () => {
    savePlaybackState(true);
  };

  document.getElementById('volume').oninput = () => {
    audio.volume = document.getElementById('volume').value / 100;
    api.settings.set('volume', document.getElementById('volume').value);
    updateVolumeBar();
  };

  document.getElementById('btn-add-folder').onclick   = addFolder;
  document.getElementById('btn-add-playlist').onclick = newPlaylist;
  document.getElementById('btn-settings').onclick     = openSettings;

  document.querySelectorAll('.sort-btn').forEach(btn => {
    btn.addEventListener('click', () => applySort(btn.dataset.sort));
  });

  document.getElementById('nav-all').addEventListener('click', () => {
    activateNav(document.getElementById('nav-all'));
    view = { type: 'all', id: null };
    loadTracks();
    closeSettings();
  });

  document.getElementById('nav-favorites').addEventListener('click', () => {
    activateNav(document.getElementById('nav-favorites'));
    view = { type: 'favorites', id: null };
    loadTracks();
    closeSettings();
  });

  document.addEventListener('click', hideCtx);
  document.addEventListener('keydown', onKey);

  api.on.tracksUpdated(() => loadTracks());

  const searchInput = document.getElementById('search-input');
  const searchClear = document.getElementById('search-clear');
  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value;
    searchClear.classList.toggle('visible', searchQuery.length > 0);
    applySearch();
  });
  searchClear.addEventListener('click', () => {
    searchQuery = '';
    searchInput.value = '';
    searchClear.classList.remove('visible');
    applySearch();
    searchInput.focus();
  });

  bindFileDrop();
}

// ─── File drop (from OS) ──────────────────────────────────
function bindFileDrop() {
  const content = document.querySelector('.content');
  const overlay = document.createElement('div');
  overlay.className = 'file-drop-overlay';
  overlay.innerHTML = `
    <svg viewBox="0 0 24 24" fill="currentColor" width="36" height="36" style="opacity:.7">
      <path d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2zm-2 10h-3v3h-2v-3H10v-2h3v-3h2v3h3v2z"/>
    </svg>
    <span>Добавить файлы или папку</span>`;
  content.appendChild(overlay);

  let dragCount = 0;
  const hasFiles = (e) => [...(e.dataTransfer?.items || [])].some(i => i.kind === 'file');

  content.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    dragCount++;
    overlay.classList.add('visible');
  });
  content.addEventListener('dragleave', () => {
    dragCount = Math.max(0, dragCount - 1);
    if (dragCount === 0) overlay.classList.remove('visible');
  });
  content.addEventListener('dragover', (e) => {
    if (hasFiles(e)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }
  });
  content.addEventListener('drop', async (e) => {
    e.preventDefault();
    dragCount = 0;
    overlay.classList.remove('visible');
    const paths = [...e.dataTransfer.files].map(f => f.path).filter(Boolean);
    if (!paths.length) return;
    const added = await api.folder.addFiles(paths);
    if (added > 0) { await refreshFolders(); await loadTracks(); }
  });
}

function bindAudio() {
  audio.ontimeupdate = () => {
    if (!audio.duration) return;
    const pct = audio.currentTime / audio.duration;
    document.getElementById('progress').value = pct * 1000;
    document.getElementById('t-cur').textContent = fmt(audio.currentTime);
    updateProgressBar(pct * 100);
    savePlaybackState(false);
  };

  audio.onloadedmetadata = async () => {
    document.getElementById('t-total').textContent = fmt(audio.duration);
    const t = tracks[currentIndex];
    if (t && !t.duration) {
      await api.tracks.updateDuration(t.id, audio.duration);
      t.duration = audio.duration;
    }
  };

  audio.onended = () => {
    savePlaybackState(true);
    nextTrack();
  };
  audio.onplay  = () => {
    setupAudioCtx();
    document.getElementById('btn-play').innerHTML = SVG.pause;
    document.body.classList.add('audio-playing');
    if (audioCtx) audioCtx.resume();
    startWave();
    savePlaybackState(true);
  };
  audio.onpause = () => {
    if (switching) return;
    document.getElementById('btn-play').innerHTML = SVG.play;
    document.body.classList.remove('audio-playing');
    stopWave();
    savePlaybackState(true);
  };
}

function updateProgressBar(pct) {
  document.getElementById('progress').style.setProperty('--fill', pct + '%');
}
function updateVolumeBar() {
  const v = document.getElementById('volume').value;
  document.getElementById('volume').style.setProperty('--fill', v + '%');
}

// ─── Sidebar helpers ───────────────────────────────────────
function navItem(label, title, onClick, onRemove) {
  const li = document.createElement('li');
  li.className = 'nav-item';
  li.innerHTML = `<span title="${esc(title || label)}">${esc(label)}</span>
    <button class="rm-btn" title="Удалить">✕</button>`;
  li.addEventListener('click', (e) => { if (!e.target.classList.contains('rm-btn')) onClick(); });
  li.querySelector('.rm-btn').addEventListener('click', (e) => { e.stopPropagation(); onRemove(); });
  return li;
}

function activateNav(el) {
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  el?.classList.add('active');
}

// ─── Folder & Playlist ────────────────────────────────────
async function addFolder() {
  const p = await api.folder.dialog();
  if (!p) return;
  await api.folder.add(p);
  await refreshFolders();
  await loadTracks();
}

async function newPlaylist() {
  showModal('Новый плейлист', '', async (name) => {
    if (!name.trim()) return;
    await api.playlist.create(name.trim());
    await refreshPlaylists();
  });
}

// ─── Context menu ──────────────────────────────────────────
function showCtx(e, track) {
  e.preventDefault();
  e.stopPropagation();
  ctxTrack = track;
  const menu = document.getElementById('ctx-menu');
  menu.innerHTML = '';

  addCtxItem(menu, 'Воспроизвести', () => {
    const i = tracks.findIndex(t => t.id === track.id);
    if (i !== -1) play(i);
    hideCtx();
  });

  addCtxItem(menu, favorites.has(track.id) ? '♥ Убрать из любимого' : '♡ В любимое', async () => {
    await api.favorites.toggle(track.id);
    if (favorites.has(track.id)) { favorites.delete(track.id); if (view.type === 'favorites') loadTracks(); }
    else favorites.add(track.id);
    renderTracks();
    hideCtx();
  });

  if (playlists.length) {
    menu.appendChild(ctxSep());
    for (const p of playlists) {
      addCtxItem(menu, `→ ${p.name}`, async () => {
        await api.playlist.addTrack(p.id, track.id);
        hideCtx();
      });
    }
  }

  if (view.type === 'playlist') {
    menu.appendChild(ctxSep());
    addCtxItem(menu, 'Убрать из плейлиста', async () => {
      await api.playlist.removeTrack(view.id, track.id);
      await loadTracks();
      hideCtx();
    }, true);
  }

  menu.appendChild(ctxSep());
  addCtxItem(menu, 'Удалить трек', () => {
    hideCtx();
    confirmDeleteTrack(track);
  }, true);

  menu.style.display = 'block';
  const x = Math.min(e.clientX, innerWidth - menu.offsetWidth - 6);
  const y = Math.min(e.clientY, innerHeight - menu.offsetHeight - 6);
  menu.style.left = x + 'px';
  menu.style.top  = y + 'px';
}

function addCtxItem(menu, label, fn, danger) {
  const d = document.createElement('div');
  d.className = 'ctx-item' + (danger ? ' danger' : '');
  d.textContent = label;
  d.addEventListener('click', fn);
  menu.appendChild(d);
}
function ctxSep() { const d = document.createElement('div'); d.className = 'ctx-sep'; return d; }
function hideCtx() { document.getElementById('ctx-menu').style.display = 'none'; }

// ─── Modal ─────────────────────────────────────────────────
function showModal(title, def, cb) {
  document.getElementById('modal-title').textContent = title;
  document.getElementById('modal-message').style.display = 'none';
  const input = document.getElementById('modal-input');
  input.style.display = '';
  input.value = def;
  const okBtn = document.getElementById('modal-ok');
  okBtn.textContent = 'OK';
  okBtn.classList.remove('danger');
  okBtn.classList.add('primary');
  const bg = document.getElementById('modal-bg');
  bg.classList.add('open');
  setTimeout(() => input.focus(), 40);
  const close = () => bg.classList.remove('open');
  okBtn.onclick = () => { cb(input.value); close(); };
  document.getElementById('modal-cancel').onclick = close;
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { cb(input.value); close(); }
    if (e.key === 'Escape') close();
  };
}

// Confirmation dialog (no text input), used for destructive actions
function showConfirm(title, message, onConfirm) {
  document.getElementById('modal-title').textContent = title;
  const msgEl = document.getElementById('modal-message');
  msgEl.textContent = message;
  msgEl.style.display = '';
  const input = document.getElementById('modal-input');
  input.style.display = 'none';
  input.onkeydown = null;
  const okBtn = document.getElementById('modal-ok');
  okBtn.textContent = 'Удалить';
  okBtn.classList.remove('primary');
  okBtn.classList.add('danger');
  const bg = document.getElementById('modal-bg');
  bg.classList.add('open');
  const close = () => bg.classList.remove('open');
  okBtn.onclick = () => { onConfirm(); close(); };
  document.getElementById('modal-cancel').onclick = close;
}

async function confirmDeleteTrack(track) {
  const displayTitle = track.artist ? `${track.artist} — ${track.title}` : track.title;
  showConfirm('Удалить трек?', `«${displayTitle}» будет удалён с диска (в корзину). Это действие можно отменить только через корзину Windows.`, async () => {
    await api.tracks.delete(track.id);
    favorites.delete(track.id);
    if (currentTrackId === track.id) {
      currentTrackId = null;
      currentIndex = -1;
      audio.pause();
      audio.src = '';
      document.getElementById('p-title').textContent = '';
      document.getElementById('p-source').textContent = '';
      api.settings.set('last_track_id', '0');
      api.settings.set('last_track_time', '0');
    }
    await loadTracks();
  });
}

// ─── Settings ─────────────────────────────────────────────
function openSettings() {
  document.getElementById('library-view').style.display   = 'none';
  document.getElementById('settings-panel').style.display = 'block';
  document.getElementById('btn-settings').classList.add('active');
  syncSettingsUI();
}

function closeSettings() {
  document.getElementById('library-view').style.display   = 'flex';
  document.getElementById('settings-panel').style.display = 'none';
  document.getElementById('btn-settings').classList.remove('active');
}

function syncSettingsUI() {
  document.querySelectorAll('.theme-btn').forEach(b =>
    b.classList.toggle('active', b.dataset.theme === currentTheme));
  document.querySelectorAll('.accent-dot').forEach(d =>
    d.classList.toggle('active', d.dataset.color === (currentAccent || '')));
  document.querySelectorAll('.scale-btn').forEach(b =>
    b.classList.toggle('active', Math.abs(currentScale - parseFloat(b.dataset.scale)) < 0.01));
  document.getElementById('set-compact').checked = isCompact;
  document.getElementById('set-text-bright').checked = textBright;
  document.getElementById('set-sort').value = currentSort;
}

function applyTheme(theme, save = true) {
  currentTheme = theme;
  document.body.classList.remove('light', 'black');
  if (theme !== 'dark') document.body.classList.add(theme);
  if (save) api.settings.set('theme', theme);
}

function applyAccent(color, save = true) {
  currentAccent = color;
  if (color) {
    document.documentElement.style.setProperty('--accent', color);
    const r = parseInt(color.slice(1,3),16), g = parseInt(color.slice(3,5),16), b = parseInt(color.slice(5,7),16);
    const isLight = (r*299 + g*587 + b*114) / 1000 > 140;
    document.documentElement.style.setProperty('--accent-text', isLight ? '#111' : '#eee');
  } else {
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-text');
  }
  if (save) api.settings.set('accent', color || '');
}

function applyCompact(on, save = true) {
  isCompact = on;
  document.body.classList.toggle('compact', on);
  if (save) api.settings.set('compact', on ? '1' : '0');
}

function applyTextBright(on, save = true) {
  textBright = on;
  document.body.classList.toggle('text-bright', on);
  if (save) api.settings.set('textBright', on ? '1' : '0');
}

function applySort(by, save = true) {
  currentSort = by;
  if (save) api.settings.set('sort', by);
  syncSortBar();
  loadTracks();
}

function applyScale(factor, save = true) {
  currentScale = factor;
  api.zoom.set(factor);
  if (save) api.settings.set('scale', String(factor));
}

function bindSettings() {
  const picker = document.getElementById('accent-picker');
  ACCENTS.forEach(a => {
    const dot = document.createElement('span');
    dot.className = 'accent-dot' + (currentAccent === a.color ? ' active' : '');
    dot.title = a.label;
    dot.dataset.color = a.color || '';
    dot.style.background = a.bg || a.color;
    dot.addEventListener('click', () => {
      applyAccent(a.color);
      document.querySelectorAll('.accent-dot').forEach(d =>
        d.classList.toggle('active', d.dataset.color === (a.color || '')));
    });
    picker.appendChild(dot);
  });

  document.querySelectorAll('.theme-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      applyTheme(btn.dataset.theme);
      document.querySelectorAll('.theme-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.theme === currentTheme));
    });
  });

  const scaleSwitcher = document.getElementById('scale-switcher');
  SCALES.forEach(s => {
    const btn = document.createElement('button');
    btn.className = 'theme-btn scale-btn' + (Math.abs(currentScale - s.value) < 0.01 ? ' active' : '');
    btn.textContent = s.label;
    btn.dataset.scale = s.value;
    btn.addEventListener('click', () => {
      applyScale(s.value);
      scaleSwitcher.querySelectorAll('.scale-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
    scaleSwitcher.appendChild(btn);
  });

  document.getElementById('set-compact').addEventListener('change', function () { applyCompact(this.checked); });
  document.getElementById('set-text-bright').addEventListener('change', function () { applyTextBright(this.checked); });
  document.getElementById('set-sort').addEventListener('change', function () { applySort(this.value); });

  const btnCheckUpdates = document.getElementById('btn-check-updates');
  if (btnCheckUpdates) {
    btnCheckUpdates.addEventListener('click', () => {
      if (api.updater?.check) api.updater.check();
    });
  }
}

// ─── Keyboard ──────────────────────────────────────────────
function onKey(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight' && e.shiftKey) nextTrack();
  else if (e.code === 'ArrowLeft' && e.shiftKey) prevTrack();
  else if (e.code === 'ArrowRight') audio.currentTime = Math.min(audio.duration || 0, audio.currentTime + 5);
  else if (e.code === 'ArrowLeft')  audio.currentTime = Math.max(0, audio.currentTime - 5);
  if (e.key === 'Escape') closeSettings();
}

// ─── Utilities ─────────────────────────────────────────────
function fmt(s) {
  if (!s || isNaN(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}
function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showToast(msg, duration = 5000) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(el._timer);
  el._timer = setTimeout(() => {
    el.classList.remove('show');
  }, duration);
}

if (api.on?.showToast) {
  api.on.showToast((msg) => showToast(msg, 5000));
}

init();
