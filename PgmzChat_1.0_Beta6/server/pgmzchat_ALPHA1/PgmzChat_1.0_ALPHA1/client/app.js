// PgmzChat 1.0_ALPHA1 — background P2P connection lifetime and stable channel ownership
import { canonicalMediaMime, normalizeMediaDataUrl } from './media-utils.js';
const $ = (id) => document.getElementById(id);
const STORE = {
  oldMessages: 'pgmz.clientserver.testMessages.v095',
  seeded: 'pgmz.clientserver.seeded.v097',
  rooms: 'pgmz.clientserver.rooms.v097',
  contacts: 'pgmz.clientserver.contacts.v097',
  selectedRoom: 'pgmz.clientserver.selectedRoom.v097',
  clientId: 'pgmz.clientserver.clientId',
  deviceId: 'pgmz.clientserver.deviceId',
  accountId: 'pgmz.account.id',
  authToken: 'pgmz.account.token',
  account: 'pgmz.account.public',
  server: 'pgmz.clientserver.serverUrl',
  servers: 'pgmz.clientserver.serverProfiles.v100',
  profile: 'pgmz.clientserver.profile',
  enhanced: 'pgmz.clientserver.enhancedAnimations',
  reduce: 'pgmz.clientserver.reduceMotion',
  compact: 'pgmz.clientserver.compact',
  sound: 'pgmz.clientserver.sound',
  theme: 'pgmz.clientserver.theme',
  fontSize: 'pgmz.clientserver.fontSize',
  folders: 'pgmz.clientserver.chatFolders.v098',
  activeFolder: 'pgmz.clientserver.activeChatFolder.v098',
  recordMode: 'pgmz.clientserver.recordMode.v101'
};
const BUILTIN_STICKERS = ['👋','👍','❤️','😂','🔥','🎉','🥹','😎','🤝','💜','✅','🚀','✨','🙌','☕','🐈','💯','🤔'];
const MAX_MEDIA = 8 * 1024 * 1024;
const SANDBOX_FLAG = 'pgmz.auth.testMode';
function nativeDebugBuild() { try { return !!(window.PgmzNative && window.PgmzNative.isDebugBuild && window.PgmzNative.isDebugBuild()); } catch { return false; } }
const SANDBOX_AVAILABLE = nativeDebugBuild();
// Remove a stale debug flag when this install is a release/browser build.
if (!SANDBOX_AVAILABLE && localStorage.getItem(SANDBOX_FLAG) === '1') localStorage.removeItem(SANDBOX_FLAG);
const sandboxActiveAtBoot = SANDBOX_AVAILABLE && localStorage.getItem(SANDBOX_FLAG) === '1';
const isSandboxActive = () => SANDBOX_AVAILABLE && localStorage.getItem(SANDBOX_FLAG) === '1';
const profileStorageKey = () => isSandboxActive() ? `${STORE.profile}.sandbox` : STORE.profile;
const MAX_VOICE_SECONDS = 180;
const MAX_CIRCLE_SECONDS = 60;
const MAX_OWNED_CHANNELS = 3;
const PAGE = 100;

const get = (key, fallback = null) => { try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch { return fallback; } };
const set = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { toast('Не удалось сохранить настройки'); return false; } };
// Chat content is stored on devices. The debug-only sandbox is isolated from regular P2P history and never contacts a server.
// Regular chats use one local P2P namespace so changing the discovery server never hides existing history.
const currentServerKey = () => isSandboxActive() ? '__sandbox__' : '__p2p__';
const scopedStorageKey = name => `${STORE[name]}.scope.${isSandboxActive() ? 'sandbox' : 'p2p'}`;
function legacyScopedValues(name) {
  const prefix = `${STORE[name]}.scope.${isSandboxActive() ? 'sandbox' : 'p2p'}`; const values = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.startsWith(prefix) && key !== scopedStorageKey(name)) values.push(localStorage.getItem(key));
  }
  return values;
}
function getScoped(name, fallback = null) {
  const key = scopedStorageKey(name);
  if (localStorage.getItem(key) !== null) return get(key, fallback);
  if (isSandboxActive()) return fallback;
  const scoped = legacyScopedValues(name).map(raw => { try { return JSON.parse(raw); } catch { return null; } }).filter(Boolean);
  if (scoped.length) {
    let merged = scoped[0];
    if (scoped.every(Array.isArray)) {
      const items = new Map();
      for (const list of scoped) for (const item of list) {
        const id = item?.id || item?.peerId || item?.username;
        if (id) items.set(String(id), { ...(items.get(String(id)) || {}), ...item });
      }
      merged = [...items.values()];
    }
    set(key, merged); return merged;
  }
  const legacy = localStorage.getItem(STORE[name]);
  if (legacy !== null) {
    localStorage.setItem(key, legacy); localStorage.removeItem(STORE[name]);
    try { return JSON.parse(legacy); } catch { return fallback; }
  }
  return fallback;
}
function setScoped(name, value) { return set(scopedStorageKey(name), value); }
function getScopedString(name, fallback = '') {
  const key = scopedStorageKey(name);
  if (localStorage.getItem(key) !== null) return localStorage.getItem(key) || fallback;
  if (isSandboxActive()) { setScopedString(name, fallback); return fallback; }
  const configured = localStorage.getItem(STORE.server) || '';
  const likelyOldKey = `${STORE[name]}.scope.${encodeURIComponent(configured || 'local')}`;
  const oldValue = localStorage.getItem(likelyOldKey) || legacyScopedValues(name)[0];
  if (oldValue !== undefined && oldValue !== null) { setScopedString(name, oldValue); return oldValue || fallback; }
  const legacy = localStorage.getItem(STORE[name]);
  if (legacy !== null) { localStorage.setItem(key, legacy); localStorage.removeItem(STORE[name]); return legacy || fallback; }
  return fallback;
}
function setScopedString(name, value) { try { localStorage.setItem(scopedStorageKey(name), String(value)); } catch { toast('Не удалось сохранить настройки'); } }
const randomId = () => (globalThis.crypto?.randomUUID?.() || `m-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
function stableDeviceCode() { try { const nativeCode = window.PgmzNative?.getDeviceCode?.(); if (typeof nativeCode === 'string' && /^[a-zA-Z0-9_-]{24,128}$/.test(nativeCode)) return nativeCode; } catch {} return localStorage.getItem(STORE.deviceId) || localStorage.getItem(STORE.clientId) || randomId(); }
const time = (v = new Date()) => new Date(v).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
const formatDuration = value => {
  const raw = Number(value);
  const n = Number.isFinite(raw) ? Math.max(0, Math.floor(raw)) : 0;
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
function cleanDuration(value, type = '') {
  const n = Number(value);
  const cap = type === 'voice' ? MAX_VOICE_SECONDS : type === 'circle' ? MAX_CIRCLE_SECONDS : 3600;
  // Discard impossible legacy values instead of capping 47 minutes to a misleading 60/180 seconds.
  if (!Number.isFinite(n) || n <= 0 || n > cap) return 0;
  return Math.floor(n);
}
function trustedMediaDuration(mediaDuration, storedDuration, type = '') {
  const max = type === 'voice' ? MAX_VOICE_SECONDS : type === 'circle' ? MAX_CIRCLE_SECONDS : 3600;
  const stored = cleanDuration(storedDuration, type);
  const media = Number(mediaDuration);
  if (stored > 0) {
    // Some Android WebViews report a wildly incorrect WebM duration. The
    // recorder's monotonic elapsed time is the stable duration for our own notes.
    if (!Number.isFinite(media) || media <= 0 || media > max || Math.abs(media - stored) > Math.max(3, stored * 0.5)) return stored;
    return Math.min(max, Math.floor(media));
  }
  return Number.isFinite(media) && media > 0 && media <= max ? Math.floor(media) : 0;
}
const dateKey = v => new Date(v).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
const initials = v => String(v || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0] || '').join('').toUpperCase().slice(0, 2) || '?';
function setAvatarElement(el, avatarData, fallbackName) {
  if (!el) return;
  el.replaceChildren();
  const valid = typeof avatarData === 'string' && avatarData.startsWith('data:image/') && avatarData.length < 220000;
  el.classList.toggle('has-photo', valid);
  if (valid) {
    const img = document.createElement('img'); img.src = avatarData; img.alt = ''; img.draggable = false; img.decoding = 'async';
    img.onerror = () => { el.classList.remove('has-photo'); el.replaceChildren(document.createTextNode(initials(fallbackName))); };
    el.append(img);
  } else el.textContent = initials(fallbackName);
}
async function encodeProfileAvatar(file) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('Выбери файл изображения.');
  if (file.size > 8 * 1024 * 1024) throw new Error('Изображение больше 8 МБ. Выбери файл поменьше.');
  let bitmap;
  if (window.createImageBitmap) bitmap = await createImageBitmap(file);
  else bitmap = await new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Не удалось открыть изображение.')); image.src = URL.createObjectURL(file); });
  const sourceWidth = bitmap.width || bitmap.naturalWidth || 0, sourceHeight = bitmap.height || bitmap.naturalHeight || 0;
  if (!sourceWidth || !sourceHeight) throw new Error('Не удалось прочитать изображение.');
  const edge = 256, scale = Math.min(1, edge / Math.max(sourceWidth, sourceHeight));
  const canvas = document.createElement('canvas'); canvas.width = Math.max(1, Math.round(sourceWidth * scale)); canvas.height = Math.max(1, Math.round(sourceHeight * scale));
  const ctx = canvas.getContext('2d', { alpha: false }); if (!ctx) throw new Error('Не удалось обработать изображение.');
  ctx.fillStyle = '#20283b'; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  if (bitmap.close) bitmap.close();
  const data = canvas.toDataURL('image/jpeg', 0.78); canvas.width = 1; canvas.height = 1;
  if (data.length > 180000) throw new Error('Не удалось достаточно сжать изображение. Выбери другое фото.');
  return data;
}
const svg = (path) => { const n = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); n.setAttribute('viewBox', '0 0 24 24'); n.setAttribute('class', 'ui-icon'); n.setAttribute('aria-hidden', 'true'); n.innerHTML = path; return n; };
const plural = (n, w) => { const a = n % 10, b = n % 100; return (a === 1 && b !== 11) ? w[0] : (a >= 2 && a <= 4 && (b < 12 || b > 14)) ? w[1] : w[2]; };
const ICON = {
  forward: '<path d="M14 4l7 7-7 7M21 11H9a6 6 0 0 0-6 6v2"/>',
  reaction: '<circle cx="12" cy="12" r="9"/><path d="M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01"/>',
  pin: '<path d="m16 3 5 5-4 1-3 5-3-3-5 5-2-2 5-5-3-3 5-3 1-4Z"/>',
  reply: '<path d="M9 14 4 9l5-5M4 9h9a7 7 0 0 1 7 7v3"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M5 15V6.5A2.5 2.5 0 0 1 7.5 4H15"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16v4ZM13.5 6.5l4 4"/>',
  trash: '<path d="M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 11v5M14 11v5"/>',
  retry: '<path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>'
};

// ---------- storage (IndexedDB: messages and stickers; localStorage: settings) ----------
let db = null;
const idb = {
  open: () => new Promise((resolve, reject) => {
    const r = indexedDB.open('pgmzchat', 5);
    r.onupgradeneeded = () => {
      for (const store of ['messages', 'stickers', 'rooms', 'contacts', 'events', 'outbox']) if (!r.result.objectStoreNames.contains(store)) r.result.createObjectStore(store, { keyPath: 'id' });
      if (r.result.objectStoreNames.contains('gifs')) r.result.deleteObjectStore('gifs');
    };
    r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
  }),
  run: (store, mode, fn) => new Promise((resolve) => {
    if (!db) return resolve(null);
    try {
      const tx = db.transaction(store, mode); const req = fn(tx.objectStore(store));
      tx.oncomplete = () => resolve(req ? req.result : true); tx.onerror = tx.onabort = () => resolve(null);
    } catch { resolve(null); }
  }),
  all: store => idb.run(store, 'readonly', s => s.getAll()).then(r => r || []),
  put: (store, v) => idb.run(store, 'readwrite', s => s.put(v)),
  del: (store, id) => idb.run(store, 'readwrite', s => s.delete(id)),
  clear: store => idb.run(store, 'readwrite', s => s.clear())
};
const saveMsg = async m => {
  const roomId = m.roomId || 'global';
  const prefs = getLocalChatPref(roomId);
  // keepHistory=false means do not persist this chat; in-memory chat may continue until it is left/restarted.
  if (prefs.keepHistory === false) return idb.del('messages', m.id);
  const persisted = { ...m };
  // Avoid persisting base64 media when media caching is disabled. Keep the in-memory object
  // untouched so an outgoing upload can still complete in this session.
  if (prefs.cacheMedia !== true && prefs.allowPeerSeed !== true && prefs.allowPeerDownload !== true) { delete persisted.mediaData; delete persisted.imageData; }
  return idb.put('messages', persisted);
};
function updateMessageStatus(id, delivery) {
  const message = msgMap.get(id);
  if (!message) {
    idb.all('messages').then(all => { const stored = all.find(m => m.id === id); if (stored) { stored.delivery = delivery; saveMsg(stored); } });
    return;
  }
  message.delivery = delivery;
  saveMsg(message);
  const row = rowEl(id);
  if (row) updateMeta(row, message);
  updateConnectionStatus();
}

const DEFAULT_MESSAGES = () => [
  { id: 'hello-intro-1', username: 'PgmzChat', text: 'Привет! Это PgmzChat. Напиши сообщение, отправь стикер, голосовое или изображение.', createdAt: new Date(Date.now() - 300000).toISOString(), mine: false, system: true, delivery: 'received' },
  { id: 'hello-intro-2', username: 'PgmzChat', text: 'Зажми любое сообщение — появится меню действий. Здесь можно записывать голосовые и видеокружки.', createdAt: new Date(Date.now() - 240000).toISOString(), mine: false, system: true, delivery: 'received' }
];

const LOCAL_CHAT_PREFS_KEY = 'pgmzchat.localChatPrefs.v1';
const LOCAL_CLEANUP_KEY = 'pgmzchat.localAutoCleanup.v1';
const LOCAL_HIDDEN_MESSAGES_KEY = 'pgmzchat.locallyDeletedMessageIds.v1';
const LOCAL_CHAT_PREFS = () => { try { return JSON.parse(localStorage.getItem(LOCAL_CHAT_PREFS_KEY) || '{}'); } catch { return {}; } };
const localPrefKey = roomId => `${currentServerKey()}::${roomId || 'global'}`;
const getLocalChatPref = roomId => {
  const all = LOCAL_CHAT_PREFS();
  const stored = all[localPrefKey(roomId)] || all[roomId || 'global'] || {};
  // P2P history permissions are required capabilities, not user-switchable preferences.
  return { ...stored, allowPeerDownload: true, allowPeerSeed: true };
};
function hiddenLocalMessageSet() { const values = get(LOCAL_HIDDEN_MESSAGES_KEY, []); return new Set(Array.isArray(values) ? values.filter(v => typeof v === 'string') : []); }
function localMessageKey(m) { return `${m.serverKey || currentServerKey()}::${m.id}`; }
function isLocallyHiddenMessage(m) { return hiddenLocalMessageSet().has(localMessageKey(m)); }
function hideLocalMessages(messages) { if (!messages?.length) return; const values = [...hiddenLocalMessageSet()]; const seen = new Set(values); for (const m of messages) { const key = localMessageKey(m); if (!seen.has(key)) { values.push(key); seen.add(key); } } set(LOCAL_HIDDEN_MESSAGES_KEY, values.slice(-12000)); }
function unhideLocalMessage(message) { const key=localMessageKey(message),values=[...hiddenLocalMessageSet()].filter(v=>v!==key);set(LOCAL_HIDDEN_MESSAGES_KEY,values); }
const state = {
  deviceId: stableDeviceCode(),
  accountId: sandboxActiveAtBoot ? '' : (localStorage.getItem(STORE.accountId) || ''),
  authToken: sandboxActiveAtBoot ? '' : (localStorage.getItem(STORE.authToken) || ''),
  testMode: sandboxActiveAtBoot,
  account: sandboxActiveAtBoot ? null : get(STORE.account, null),
  clientId: sandboxActiveAtBoot ? (localStorage.getItem('pgmz.sandbox.clientId') || `sandbox_${randomId()}`) : (localStorage.getItem(STORE.accountId) || localStorage.getItem(STORE.clientId) || localStorage.getItem(STORE.deviceId) || randomId()),
  profile: get(sandboxActiveAtBoot ? `${STORE.profile}.sandbox` : STORE.profile, sandboxActiveAtBoot ? { name: 'Тестовый пользователь', handle: 'tester', avatar: '' } : { name: 'Гость', handle: 'guest', avatar: '' }),
  serverUrl: sandboxActiveAtBoot ? '' : (localStorage.getItem(STORE.server) || ((window.location.protocol === 'https:' && window.location.hostname && window.location.hostname !== 'appassets.androidplatform.net') ? window.location.origin : '')), 
  servers: (get(STORE.servers, []) || []).filter(v => typeof v === 'string').slice(0, 8),
  messages: [], userStickers: [], stickerPacks: [], rooms: [], contacts: [], selectedRoomId: getScopedString('selectedRoom', 'global'),
  recorder: null, recordingStream: null, recordingCameraStream: null, recordingCanvas: null, recordingCanvasFrame: 0, recordingFacingMode: 'user', recordingUsesCanvas: false, recordingChunks: [], recordingMode: null, recordingStartedAt: 0, recordingTimeout: null, recordingTicker: null, recordingLocked: false, recordingStarting: false, recordingStopRequested: false, discardRecording: false, recordingSaveInProgress: false, nativeCaptureAudioActive: false, recordingPressTimer: null, recordingPress: null, recordingAudioContext: null, recordingAnalyser: null, recordingSource: null, recordingLevelTimer: null, recordingLevels: [], composerMediaMode: get(STORE.recordMode, 'voice') === 'circle' ? 'circle' : 'voice', pendingStickerPackName: '',
  call: null, p2pTransfer: null, pendingHistoryRequest: null, callPollTimer: null, callSignalCursor: Date.now() - 120000, callPollBusy: false,
  onlinePeers: [], meshPeers: new Map(), meshTimer: null, meshBusy: false, meshSeenEvents: new Set(), meshTransfers: new Map(),
  enhanced: get(STORE.enhanced, true), reduce: get(STORE.reduce, false), compact: get(STORE.compact, false),
  sound: get(STORE.sound, false), notifications: get('pgmz.clientserver.notifications', false), theme: get(STORE.theme, 'dark'), fontSize: Number(get(STORE.fontSize, 15)) || 15,
  activePage: 'chat', activeFolder: getScopedString('activeFolder', 'all'), folders: [], toastTimer: null, pollTimer: null, pollBusy: false, serverEpoch: 0,
  limit: PAGE, lastDay: '', lastSyncAt: 0, replyTo: null, editingId: null, stick: true
};
const msgMap = new Map();
if (!state.testMode) localStorage.setItem(STORE.clientId, state.clientId); localStorage.setItem(STORE.deviceId, state.deviceId);

// ---------- helpers ----------
function toast(message, ms = 2400) { const el = $('toast'); el.textContent = message; el.classList.add('show'); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove('show'), ms); }
const motionOk = () => state.enhanced && !state.reduce && !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function animateButton(button) { if (!motionOk()) return; button.classList.remove('is-animating'); void button.offsetWidth; button.classList.add('is-animating'); setTimeout(() => button.classList.remove('is-animating'), 850); }
const area = () => $('messageArea');
const nearBottom = () => { const a = area(); return a.scrollHeight - a.scrollTop - a.clientHeight < 140; };
const toBottom = () => { const a = area(); a.scrollTop = a.scrollHeight; };
const rowEl = id => $('messages').querySelector(`.message-row[data-id="${CSS.escape(id)}"]`);
const isMedia = m => !!(m.imageData || m.mediaData || m.mediaUrl || (m.type && m.type !== 'text'));
const previewOf = m => m.text ? m.text.slice(0, 140) : ({voice:'Голосовое сообщение',circle:'Видеокружок',video:'Видео',sticker:'Стикер',image:'Изображение',file:'Файл'}[m.type] || 'Медиафайл');
const activeRoom = () => state.rooms.find(r => r.id === state.selectedRoomId) || {id:'global', name:'Общая группа', type:'group', ownerId:'system'};
function isRoomOwner(room) {
  if (!room || room.type !== 'channel') return true;
  // Account ownership survives reinstall/device changes; legacy account IDs remain valid.
  const ownerAccountId = String(room.ownerAccountId || (/^u_[a-f0-9]{32}$/i.test(String(room.ownerId || '')) ? room.ownerId : ''));
  if (ownerAccountId) return !!state.accountId && ownerAccountId === state.accountId;
  return !state.accountId && String(room.ownerId || '') === state.clientId;
}
function countOwnedChannels() {
  return state.rooms.filter(room => {
    if (room?.type !== 'channel' || room.id === 'sandbox-channel-news') return false;
    if (room.ownerAccountId) return state.accountId ? room.ownerAccountId === state.accountId : room.ownerDeviceId === state.deviceId;
    if (/^u_[a-f0-9]{32}$/i.test(String(room.ownerId || ''))) return state.accountId ? room.ownerId === state.accountId : room.ownerDeviceId === state.deviceId;
    return room.ownerId === state.clientId || (!state.accountId && room.ownerDeviceId === state.deviceId);
  }).length;
}
const serverMediaUrl = (value, origin = state.serverUrl) => !value ? '' : (/^(https?:|data:|blob:)/i.test(value) ? value : `${origin || ''}${value}`);
function blobToDataUrl(blob, fallbackMime = 'application/octet-stream') { const mime = canonicalMediaMime(blob?.type, fallbackMime); const safeBlob = blob?.type === mime ? blob : new Blob([blob], { type: mime }); return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(normalizeMediaDataUrl(String(reader.result || ''), mime)); reader.onerror = () => reject(reader.error || new Error('Не удалось сохранить медиа')); reader.readAsDataURL(safeBlob); }); }
const mediaCacheInFlight = new Set();
async function cacheRemoteMediaForMessage(m) {
  const localPrefs = getLocalChatPref(m?.roomId || 'global');
  if (!m?.mediaUrl || m.mediaData || m.imageData || !localPrefs.cacheMedia || localPrefs.keepHistory === false) return false;
  if (mediaCacheInFlight.has(m.id)) return false;
  const source = serverMediaUrl(m.mediaUrl, m.mediaOrigin || state.serverUrl);
  if (!/^https?:/i.test(source)) return false;
  mediaCacheInFlight.add(m.id);
  try {
    const response = await fetch(source, { cache: 'no-store' }); if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob(); if (!blob.size || blob.size > MAX_MEDIA) throw new Error('Размер медиа превышает локальный лимит 8 МиБ');
    const dataUrl = await blobToDataUrl(blob);
    if (m.type === 'image' || m.type === 'sticker' || String(blob.type || m.mediaMime).startsWith('image/')) m.imageData = dataUrl; else m.mediaData = dataUrl;
    await saveMsg(m);
    if (state.selectedRoomId === (m.roomId || 'global')) { const row = rowEl(m.id); if (row) row.replaceWith(createRow(m)); }
    return true;
  } catch (error) { console.debug('Local media cache skipped', error); return false; }
  finally { mediaCacheInFlight.delete(m.id); }
}


function applySettings() {
  const b = document.body;
  b.classList.toggle('no-enhanced-animation', !state.enhanced);
  b.classList.toggle('reduce-motion', state.reduce || window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  b.classList.toggle('compact', state.compact);
  document.documentElement.style.setProperty('--font-size', `${state.fontSize}px`);
  $('enhancedAnimationsToggle').checked = state.enhanced; $('reduceMotionToggle').checked = state.reduce;
  $('compactModeToggle').checked = state.compact; $('soundToggle').checked = state.sound; if ($('notificationsToggle')) $('notificationsToggle').checked = state.notifications;
  $('fontSizeLabel').textContent = `${state.fontSize} px`;
  document.querySelectorAll('.theme-option').forEach(x => x.classList.toggle('active', x.dataset.theme === state.theme));
  const themes = ['dark','light','amoled','classic','telegram','sepia','frost','ocean','violet','pearl','forest','sunset','rose','mint','amber'];
  b.classList.remove(...themes.map(t => `theme-${t}`));
  const resolvedTheme = state.theme === 'system' ? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : state.theme;
  b.classList.add(`theme-${resolvedTheme}`);
  document.documentElement.style.colorScheme = ['light','telegram','sepia','pearl'].includes(resolvedTheme) ? 'light' : 'dark';
  renderFolderTabs();
}
function setPage(page) {
  state.activePage = page;
  document.querySelectorAll('.page-panel').forEach(p => p.classList.add('hidden'));
  $({ chat: 'chatPage', settings: 'settingsPage', contacts: 'contactsPage', saved: 'savedPage' }[page] || 'chatPage').classList.remove('hidden');
  document.querySelectorAll('[data-page]').forEach(b => b.classList.toggle('active', b.dataset.page === page));
  closeSidebar(); closeMenu(); toggleSticker(false);
  if (page === 'settings') $('settingsPage').scrollTop = 0;
  if (page === 'saved') renderSaved();
}
function openSettings(section) {
  setPage('settings');
  const id = section === 'server' ? 'serverSettingsCard' : section === 'themes' ? 'themesSection' : null;
  if (id) requestAnimationFrame(() => $(id).scrollIntoView({ behavior: motionOk() ? 'smooth' : 'auto', block: 'start' }));
}
function openSidebar() { $('sidebar').classList.add('open'); $('sidebarScrim').classList.add('show'); }
function closeSidebar() { $('sidebar').classList.remove('open'); $('sidebarScrim').classList.remove('show'); }
function openAbout() { closeSidebar(); $('aboutDialog').showModal(); }
function renderProfile() {
  const name = state.profile.name || (state.testMode ? 'Тестовый пользователь' : 'Гость'); const handle = (state.account?.username || state.profile.handle || 'guest').replace(/^@/, '');
  $('myName').textContent = name; $('myHandle').textContent = '@' + handle; setAvatarElement($('myAvatar'), state.profile.avatar, name); setAvatarElement($('profileBtn'), state.profile.avatar, name);
  $('profileNameInput').value = name; $('profileHandleInput').value = handle; $('profileHandleInput').disabled = !!state.account; $('profileHandleInput').title = state.account ? 'Username аккаунта нельзя изменить здесь' : 'Локальный username профиля';
  state.profileAvatarDraft = state.profile.avatar || '';
  if ($('profileAvatarPreview')) setAvatarElement($('profileAvatarPreview'), state.profileAvatarDraft, name);
  if ($('account-card')) $('account-card').classList.toggle('hidden', !!state.testMode);
  document.body.classList.toggle('sandbox-mode', !!state.testMode);
  if ($('exitTestModeBtn')) $('exitTestModeBtn').classList.toggle('hidden', !state.testMode);
  const account=state.account; if($('accountUsernameInput'))$('accountUsernameInput').value=account?.username||handle; if($('accountIdOutput'))$('accountIdOutput').textContent=account?.id||'—'; if($('accountStatusText'))$('accountStatusText').textContent=account?(state.authToken?`Выполнен вход: @${account.username}`:`Аккаунт @${account.username} сохранён локально, но сервер не подтвердил сессию. Войди заново.`):(state.testMode?'В локальной песочнице аккаунт не создаётся; эти данные не публикуются.':'Не выполнен вход. Для реальных чатов нужен серверный аккаунт.'); if($('logoutAccountBtn'))$('logoutAccountBtn').classList.toggle('hidden',!state.account); if($('loginAccountBtn'))$('loginAccountBtn').classList.toggle('hidden',!!state.authToken); if($('registerAccountBtn'))$('registerAccountBtn').classList.toggle('hidden',!!state.authToken);
}

// ---------- message rendering ----------
function updateMeta(row, m) {
  const meta = row.querySelector('.message-meta'); if (!meta) return; meta.replaceChildren();
  if (m.starred) { const s = document.createElement('span'); s.className = 'meta-star'; s.append(svg(ICON.star)); meta.append(s); }
  const t = document.createElement('span'); t.textContent = time(m.createdAt); meta.append(t);
  if (m.edited) { const e = document.createElement('span'); e.className = 'meta-edit'; e.textContent = 'изм.'; meta.append(e); }
  if (m.mine && ['sent', 'sending', 'queued', 'error'].includes(m.delivery)) {
    const st = document.createElement('span'); st.className = 'delivery-label';
    const readers = Array.isArray(m.readBy) ? m.readBy.length : 0;
    if (m.delivery === 'sent' && readers > 0) { st.append(svg('<path d="m2 12 4 4L15 6M8 12l4 4L22 6"/>')); st.title = `Прочитано: ${readers}`; }
    else if (m.delivery === 'sent') { st.append(svg('<path d="m4 12 4 4L18 6"/>')); st.title = 'Отправлено'; }
    else if (m.delivery === 'sending') { st.textContent = '…'; st.title = 'Передаётся устройствам'; }
    else if (m.delivery === 'queued') { st.textContent = '◷'; st.title = 'Ожидает подключения участников; сообщение хранится локально'; }
    else { st.classList.add('message-error'); st.textContent = '!'; st.title = 'Не отправлено'; }
    meta.append(st);
  }
}
function refreshMeta(m) { const row = rowEl(m.id); if (row) updateMeta(row, m); updateConnectionStatus(); }
// Full-screen media viewer: clones the source into an isolated dialog so inline playback stays intact.
let mediaViewerDialog = null;
function ensureMediaViewer() {
  if (mediaViewerDialog) return mediaViewerDialog;
  const dialog = document.createElement('dialog');
  dialog.className = 'media-viewer-dialog';
  dialog.setAttribute('aria-label', 'Просмотр медиа');
  dialog.innerHTML = '<div class="media-viewer-top"><span class="media-viewer-caption"></span><button type="button" class="media-viewer-close" aria-label="Закрыть просмотр">×</button></div><div class="media-viewer-stage"></div><div class="media-viewer-hint">Нажми вне медиа или ×, чтобы закрыть</div>';
  document.body.append(dialog);
  const close = () => { const stage = dialog.querySelector('.media-viewer-stage'); stage.querySelectorAll('video').forEach(v => { try { v.pause(); } catch {} }); dialog.close(); stage.replaceChildren(); };
  dialog.querySelector('.media-viewer-close').addEventListener('click', close);
  dialog.addEventListener('click', e => { if (e.target === dialog) close(); });
  dialog.addEventListener('cancel', e => { e.preventDefault(); close(); });
  mediaViewerDialog = dialog;
  return dialog;
}
function openMediaViewer(src, type = 'image', caption = '') {
  if (!src) return;
  const dialog = ensureMediaViewer();
  const stage = dialog.querySelector('.media-viewer-stage');
  stage.replaceChildren();
  dialog.querySelector('.media-viewer-caption').textContent = caption || (type === 'video' ? 'Видео' : 'Изображение');
  if (type === 'video') {
    const video = document.createElement('video');
    video.className = 'media-viewer-video'; video.src = src; video.controls = true; video.autoplay = true;
    video.playsInline = true; video.preload = 'auto'; video.setAttribute('controlsList', 'nodownload');
    video.addEventListener('error', () => toast('Не удалось открыть видео. Проверь доступность файла.', 3000));
    stage.append(video);
    dialog.showModal();
    video.play().catch(() => {});
  } else {
    const img = document.createElement('img'); img.className = 'media-viewer-image'; img.src = src; img.alt = caption || 'Изображение';
    img.addEventListener('error', () => toast('Не удалось загрузить изображение.', 2500));
    stage.append(img); dialog.showModal();
  }
}
function addMediaExpandButton(container, src, type, caption = '') {
  const button = document.createElement('button');
  button.type = 'button'; button.className = 'media-expand-button'; button.setAttribute('aria-label', 'Открыть на весь экран');
  button.title = 'Открыть на весь экран';
  button.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 4H4v4M16 4h4v4M20 16v4h-4M4 16v4h4"/></svg>';
  button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); openMediaViewer(src, type, caption); });
  container.append(button);
}

function fillBubble(bubble, m) {
  if (m.forwarded) { const f = document.createElement('div'); f.className = 'forwarded-label'; f.textContent = `Переслано от ${m.forwardedFrom || 'собеседника'}`; bubble.append(f); }
  if (m.replyTo) {
    const q = document.createElement('div'); q.className = 'reply-quote'; q.dataset.reply = m.replyTo.id;
    const b = document.createElement('b'); b.textContent = m.replyTo.name || 'Сообщение';
    const s = document.createElement('span'); s.textContent = m.replyTo.text || ''; q.append(b, s); bubble.append(q);
  }
  const rawSrc = m.mediaData || m.imageData || serverMediaUrl(m.mediaUrl, m.mediaOrigin || state.serverUrl) || '';
  const fallbackMime = m.type === 'circle' || m.type === 'video' ? 'video/webm' : m.type === 'voice' ? 'audio/webm' : 'application/octet-stream';
  const src = normalizeMediaDataUrl(rawSrc, canonicalMediaMime(m.mediaMime, fallbackMime));
  if (m.type === 'voice') {
    const wrap = document.createElement('div'); wrap.className = 'voice-message';
    const play = document.createElement('button'); play.type = 'button'; play.className = 'voice-play'; play.setAttribute('aria-label', 'Воспроизвести голосовое'); play.textContent = '▶';
    const audio = document.createElement('audio'); audio.preload = 'metadata'; audio.src = src;
    const wave = document.createElement('button'); wave.type = 'button'; wave.className = 'voice-wave'; wave.setAttribute('aria-label', 'Перемотать голосовое');
    for (let i = 0; i < 32; i++) { const bar = document.createElement('i'); const samples = Array.isArray(m.waveform) && m.waveform.length ? m.waveform : null; const sample = samples ? Math.max(0, Math.min(1, Number(samples[Math.round(i * (samples.length - 1) / 31)]) || 0)) : null; const h = sample === null ? 5 + ((i * 17 + String(m.id).length * 3) % 15) : 4 + sample * 18; bar.style.setProperty('--bar-height', `${h}px`); wave.append(bar); }
    const speed = document.createElement('button'); speed.type = 'button'; speed.className = 'voice-speed'; speed.textContent = '1×'; speed.setAttribute('aria-label', 'Скорость воспроизведения');
    speed.addEventListener('click', () => { const rates = [1, 1.5, 2]; const next = rates[(rates.indexOf(audio.playbackRate) + 1) % rates.length] || 1; audio.playbackRate = next; speed.textContent = `${next}×`; });
    const info = document.createElement('small'); info.className = 'voice-time';
    const storedDuration = cleanDuration(m.duration, 'voice');
    const trustedDuration = () => trustedMediaDuration(audio.duration, storedDuration, 'voice');
    const sync = () => {
      const d = trustedDuration();
      const rawCurrent = Number.isFinite(audio.currentTime) ? Math.max(0, audio.currentTime) : 0;
      const current = d > 0 ? Math.min(rawCurrent, d) : rawCurrent;
      info.textContent = `${formatDuration(current)} / ${formatDuration(d)}`;
      const pct = d ? (current / d) * 100 : 0; const safePct = Math.max(0, Math.min(100, pct));
      wave.style.setProperty('--played', `${safePct}%`);
      [...wave.children].forEach((bar, i, bars) => bar.classList.toggle('played', i < Math.ceil(safePct * bars.length / 100)));
      play.textContent = audio.paused ? '▶' : 'Ⅱ';
      play.setAttribute('aria-label', audio.paused ? 'Воспроизвести голосовое' : 'Приостановить голосовое');
      wrap.classList.toggle('is-playing', !audio.paused);
    };
    play.addEventListener('click', async () => { try { if (audio.paused) { if (audio.ended || (storedDuration && audio.currentTime >= storedDuration)) audio.currentTime = 0; await audio.play(); } else audio.pause(); } catch { toast('Не удалось воспроизвести аудио'); } sync(); });
    audio.addEventListener('timeupdate', () => {
      const d = trustedDuration();
      const playbackLimit = d || MAX_VOICE_SECONDS;
      // Stop at a trusted duration, or at the format's hard limit if old metadata is corrupt.
      if (Number.isFinite(audio.duration) && audio.duration > playbackLimit + 3 && audio.currentTime >= playbackLimit) {
        audio.pause(); try { audio.currentTime = playbackLimit; } catch {}
      }
      sync();
    });
    audio.addEventListener('loadedmetadata', sync); audio.addEventListener('play', sync); audio.addEventListener('pause', sync); audio.addEventListener('ended', sync);
    audio.addEventListener('error', () => { play.disabled = true; info.textContent = 'Файл недоступен'; wrap.classList.add('is-error'); });
    wave.addEventListener('click', e => { const d = trustedDuration(); if (!d) return; const r = wave.getBoundingClientRect(); if (!r.width) return; const ratio = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); audio.currentTime = ratio * d; sync(); });
    wrap.append(play, wave, info, speed, audio); bubble.append(wrap); sync(); return;
  }
  if (m.type === 'circle') {
    const wrap = document.createElement('div'); wrap.className = 'video-note-player';
    const video = document.createElement('video'); video.className = 'circle-video-note';
    video.controls = false; video.playsInline = true; video.preload = 'metadata';
    if (typeof m.posterData === 'string' && m.posterData.startsWith('data:image/') && m.posterData.length <= 180_000) video.poster = m.posterData;
    video.src = src;
    video.setAttribute('aria-label', 'Видеокружок'); video.setAttribute('controlsList', 'nodownload');
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'video-note-play'; toggle.setAttribute('aria-label', 'Воспроизвести видеокружок');
    toggle.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5c0-.8.9-1.3 1.6-.9l10 6.1a1.5 1.5 0 0 1 0 2.6l-10 6.1c-.7.4-1.6-.1-1.6-.9z"/></svg>';
    const speed = document.createElement('button'); speed.type = 'button'; speed.className = 'video-note-speed'; speed.textContent = '1×'; speed.setAttribute('aria-label', 'Скорость воспроизведения'); speed.addEventListener('click', event => { event.stopPropagation(); const rates = [1, 1.5, 2]; const next = rates[(rates.indexOf(video.playbackRate) + 1) % rates.length] || 1; video.playbackRate = next; speed.textContent = `${next}×`; });
    const duration = document.createElement('span'); duration.className = 'video-note-duration';
    const recordedDuration = cleanDuration(m.duration, 'circle');
    duration.textContent = recordedDuration ? formatDuration(recordedDuration) : 'Видео';
    const setPlaybackState = () => {
      const playing = !video.paused && !video.ended;
      wrap.classList.toggle('is-playing', playing);
      toggle.setAttribute('aria-label', playing ? 'Приостановить видеокружок' : 'Воспроизвести видеокружок');
      toggle.innerHTML = playing
        ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5h4v14H7zM14 5h4v14h-4z"/></svg>'
        : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5c0-.8.9-1.3 1.6-.9l10 6.1a1.5 1.5 0 0 1 0 2.6l-10 6.1c-.7.4-1.6-.1-1.6-.9z"/></svg>';
    };
    const togglePlayback = async event => {
      event?.stopPropagation?.();
      try {
        if (video.paused || video.ended) {
          if (video.ended || (recordedDuration && video.currentTime >= recordedDuration)) video.currentTime = 0;
          await video.play();
        } else video.pause();
      } catch { toast('Не удалось воспроизвести видеосообщение. Проверь доступность файла и формат записи.', 3500); }
      setPlaybackState();
    };
    toggle.addEventListener('click', togglePlayback);
    video.addEventListener('click', togglePlayback);
    video.addEventListener('play', setPlaybackState); video.addEventListener('pause', setPlaybackState); video.addEventListener('ended', setPlaybackState);
    video.addEventListener('timeupdate', () => {
      // Hide misleading WebM controls and stop at the recorded duration. If both
      // legacy values are corrupt, never let a video note run beyond 60 seconds.
      const playbackLimit = recordedDuration || MAX_CIRCLE_SECONDS;
      if (Number.isFinite(video.duration) && video.duration > playbackLimit + 3 && video.currentTime >= playbackLimit) {
        video.pause(); try { video.currentTime = playbackLimit; } catch {}
      }
    });
    video.addEventListener('loadedmetadata', () => { if (!recordedDuration) { const d = trustedMediaDuration(video.duration, 0, 'circle'); if (d) duration.textContent = formatDuration(d); } });
    video.addEventListener('error', () => { wrap.classList.add('is-error'); duration.textContent = 'Видео недоступно'; toggle.disabled = true; toggle.setAttribute('aria-label', 'Видео недоступно'); });
    wrap.append(video, toggle, duration, speed); addMediaExpandButton(wrap, src, 'video', m.text || 'Видеокружок'); bubble.append(wrap); setPlaybackState(); return;
  }
  if (m.type === 'video') {
    const mediaWrap = document.createElement('div'); mediaWrap.className = 'message-video-wrap';
    const video = document.createElement('video'); video.className = 'message-video';
    video.controls = true; video.playsInline = true; video.preload = 'metadata'; video.src = src;
    video.setAttribute('aria-label', 'Видео'); video.setAttribute('controlsList', 'nodownload');
    video.addEventListener('error', () => { video.title = 'Видео не загрузилось. Проверь соединение с сервером и повтори попытку.'; });
    mediaWrap.append(video); addMediaExpandButton(mediaWrap, src, 'video', m.text || m.imageName || 'Видео'); bubble.append(mediaWrap);
    const storedDuration = cleanDuration(m.duration, 'video');
    if (storedDuration) { const d = document.createElement('div'); d.className = 'media-duration'; d.textContent = formatDuration(storedDuration); bubble.append(d); }
    return;
  }
  if (m.type === 'sticker' && m.text && !src) {
    const st = document.createElement('span'); st.className = 'emoji-sticker'; st.textContent = m.text; bubble.classList.add('sticker-bubble'); bubble.append(st); return;
  }
  if (src) {
    const img = document.createElement('img'); img.className = 'message-image'; img.src = src; img.alt = m.imageName || (m.type === 'sticker' ? 'Стикер' : 'Изображение');
    img.decoding = 'async'; img.loading = 'lazy'; img.draggable = false;
    img.tabIndex = 0; img.setAttribute('role', 'button'); img.setAttribute('aria-label', 'Открыть изображение на весь экран');
    img.addEventListener('click', () => openMediaViewer(src, 'image', m.text || m.imageName || 'Изображение'));
    img.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMediaViewer(src, 'image', m.text || m.imageName || 'Изображение'); } });
    if (m.type === 'sticker') { img.classList.add('sticker-image'); bubble.classList.add('sticker-bubble'); }
    bubble.append(img);
    if (m.text && m.type !== 'sticker') { const c = document.createElement('div'); c.className = 'image-caption'; c.textContent = m.text; bubble.append(c); }
    if (!m.text && !m.replyTo) bubble.classList.add('media-bubble');
  } else if (m.text) bubble.append(document.createTextNode(m.text));
}
function createRow(m) {
  const row = document.createElement('article'); row.className = `message-row ${m.mine ? 'mine' : 'theirs'}`; row.dataset.id = m.id;
  const avatar = document.createElement('div'); avatar.className = 'message-avatar'; setAvatarElement(avatar, m.avatar, m.username || 'PgmzChat');
  const stack = document.createElement('div'); stack.className = 'message-stack';
  if (!m.mine) { const sn = document.createElement('strong'); sn.className = 'message-sender'; sn.textContent = m.username || 'PgmzChat'; stack.append(sn); }
  const bubble = document.createElement('div'); bubble.className = 'message-bubble'; fillBubble(bubble, m);
  const meta = document.createElement('div'); meta.className = 'message-meta';
  stack.append(bubble);
  if (m.pinned || m.pinnedLocal) { const pin = document.createElement('button'); pin.type = 'button'; pin.className = 'message-local-pin'; pin.textContent = m.pinned ? '📌 Закреплено в чате' : '⌖ Закреплено у вас'; pin.title = 'Открыть закреплённые сообщения'; pin.onclick = () => openPinnedMessages(); stack.append(pin); }
  const reactions = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
  const entries = Object.entries(reactions).filter(([, users]) => Array.isArray(users) && users.length);
  if (entries.length) { const tray = document.createElement('div'); tray.className = 'message-reactions'; for (const [emoji, users] of entries) { const rb = document.createElement('button'); rb.type = 'button'; rb.className = 'reaction-chip' + (users.includes(state.clientId) ? ' mine' : ''); rb.textContent = `${emoji} ${users.length}`; rb.title = `Реакция ${emoji}`; rb.onclick = () => toggleReaction(m, emoji); tray.append(rb); } stack.append(tray); }
  stack.append(meta); row.append(avatar, stack); updateMeta(row, m); return row;
}
function createIntroCard() {
  const card = document.createElement('div'); card.className = 'intro-card';
  const h = document.createElement('h2'); h.textContent = 'Лаборатория сообщений';
  const p = document.createElement('p'); p.textContent = 'Отвечай, редактируй, отправляй стикеры, голосовые и видеокружки. Зажми сообщение, чтобы открыть действия.';
  const chip = document.createElement('span'); chip.className = 'intro-chip'; chip.textContent = state.serverUrl ? 'СЕРВЕР НАСТРОЕН' : 'PGMZCHAT';
  card.append(h, p, chip); return card;
}
function dayDivider(key) { const d = document.createElement('div'); d.className = 'day-divider'; d.textContent = key; return d; }
function emptyChat() {
  const e = document.createElement('div'); e.className = 'empty-chat';
  e.innerHTML = `<span class="empty-chat-icon"><svg class="ui-icon" viewBox="0 0 24 24"><path d="M20.5 11.6a8.1 8.1 0 0 1-8.1 8.1 8.9 8.9 0 0 1-3.8-.85L3 20.5l1.7-5.3a8.6 8.6 0 0 1-.8-3.6 8.2 8.2 0 0 1 8.2-8.2h.4a8.1 8.1 0 0 1 8 8.2Z"/></svg></span><strong>Пока пусто</strong><p>Напиши первое сообщение.</p>`;
  return e;
}
function updateCount() { const n = state.messages.length; $('messageCount').textContent = `${n} ${plural(n, ['сообщение', 'сообщения', 'сообщений'])}`; }
function renderAll(prevHeight = 0) {
  const frag = document.createDocumentFragment(); frag.append(createIntroCard());
  const total = state.messages.length, start = Math.max(0, total - state.limit);
  if (start > 0) {
    const more = document.createElement('button'); more.type = 'button'; more.className = 'more-btn'; more.textContent = `Показать предыдущие (${start})`;
    more.onclick = () => { const h = area().scrollHeight; state.limit += PAGE; renderAll(h); }; frag.append(more);
  }
  let prev = '';
  for (let i = start; i < total; i++) {
    const m = state.messages[i], key = dateKey(m.createdAt);
    if (key !== prev) { frag.append(dayDivider(key)); prev = key; }
    frag.append(createRow(m));
  }
  state.lastDay = prev; if (!total) frag.append(emptyChat());
  $('messages').replaceChildren(frag);
  if (prevHeight) area().scrollTop = area().scrollHeight - prevHeight; else toBottom();
  updateCount(); updateConnectionStatus();
}
function appendRow(m, animate) {
  const box = $('messages'); box.querySelector('.empty-chat')?.remove();
  const key = dateKey(m.createdAt); if (key !== state.lastDay) { box.append(dayDivider(key)); state.lastDay = key; }
  const row = createRow(m); box.append(row);
  if (animate && motionOk()) row.classList.add('message-enter-optimized');
  updateCount();
}
function removeRow(id) {
  const row = rowEl(id); updateCount();
  if (!state.messages.length) { renderAll(); return; }
  state.lastDay = dateKey(state.messages[state.messages.length - 1].createdAt);
  if (!row) return;
  const done = () => { const p = row.previousElementSibling, n = row.nextElementSibling; row.remove(); if (p?.classList.contains('day-divider') && (!n || n.classList.contains('day-divider'))) p.remove(); };
  if (motionOk()) { row.classList.add('removing'); setTimeout(done, 170); } else done();
}
function jumpTo(id) {
  const idx = state.messages.findIndex(m => m.id === id); if (idx < 0) return false;
  setPage('chat');
  if (idx < state.messages.length - state.limit) { state.limit = state.messages.length - idx + 20; renderAll(); }
  requestAnimationFrame(() => {
    const row = rowEl(id); if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: motionOk() ? 'smooth' : 'auto' });
    row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1100);
  });
  return true;
}

function updateConnectionStatus() {
  const on = !!state.serverUrl, pending = state.messages.some(m => m.mine && m.delivery === 'sending');
  const color = on ? '#63e6b8' : '#94a1ba';
  $('statusDot').style.background = color; $('sideStatusDot').style.background = color;
  $('connectionStatus').textContent = on ? 'Сервер задан' : 'Готов к переписке';
  $('sideStatusText').textContent = on ? 'Сервер задан' : 'PgmzChat готов';
  $('serverSideStatus').textContent = on ? 'Адрес сохранён' : 'Не настроен';
  $('chatStatusText').textContent = on ? (pending ? 'Отправка…' : 'Сервер задан') : 'Готов к переписке';
}

// ---------- sending / actions ----------
function autoHeight() { const i = $('messageInput'); i.style.height = 'auto'; i.style.height = `${Math.min(i.scrollHeight, 132)}px`; }
function keepFocus() { const i = $('messageInput'); if (document.activeElement !== i) i.focus({ preventScroll: true }); }
function playSendSound() {
  if (!state.sound) return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext; if (!Ctx) return;
    const ctx = new Ctx(), osc = ctx.createOscillator(), g = ctx.createGain();
    osc.type = 'sine'; osc.frequency.setValueAtTime(780, ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(510, ctx.currentTime + .07);
    g.gain.setValueAtTime(.035, ctx.currentTime); g.gain.exponentialRampToValueAtTime(.001, ctx.currentTime + .09);
    osc.connect(g); g.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + .1); osc.onended = () => ctx.close();
  } catch { }
}
function newMessage(extra) {
  const m = { id: randomId(), serverKey: currentServerKey(), clientId: state.clientId, username: state.profile.name || 'Гость', avatar: state.profile.avatar || '', text: '', createdAt: new Date().toISOString(), mine: true, delivery: 'local', roomId: state.selectedRoomId, type: 'text', ...extra };
  if (state.replyTo) { m.replyTo = state.replyTo; clearReply(); }
  return m;
}
function addMessage(m) {
  state.messages.push(m); msgMap.set(m.id, m);
  if ((m.text || isMedia(m)) && state.serverUrl && !state.testMode) m.delivery = 'sending';
  saveMsg(m); appendRow(m, true); toBottom(); playSendSound();
  if (m.delivery === 'sending' && !state.testMode) postMessage(m);
  if (state.testMode && m.mine) scheduleSandboxReply(m);
}
function sendMessage() {
  const room=activeRoom(); if(room.type==='channel'&&!isRoomOwner(room)){toast('Публиковать в этом канале может только его владелец');keepFocus();return;}
  const input = $('messageInput'), text = input.value.trim();
  if (state.editingId) { commitEdit(text); keepFocus(); return; }
  if (!text) { keepFocus(); return; }
  animateButton($('sendBtn'));
  const sent = newMessage({ text }); addMessage(sent);
  input.value = ''; autoHeight(); keepFocus(); requestAnimationFrame(() => { if (document.activeElement !== input) input.focus({preventScroll:true}); });
}
function sendMedia(extra) { const room=activeRoom(); if(room.type==='channel'&&!isRoomOwner(room)){toast('Публиковать в этом канале может только его владелец');return;} const sent=newMessage(extra); addMessage(sent); toggleSticker(false); }
function commitEdit(text) {
  const m = msgMap.get(state.editingId); if (!m) { cancelEdit(); return; }
  if (!text) { toast('Сообщение не может быть пустым'); return; }
  if (text !== m.text) {
    m.text = text; m.edited = true; m.updatedAt = new Date().toISOString(); void saveMsg(m);
    void broadcastMeshEvent(m.roomId || state.selectedRoomId || 'global', 'edit', { messageId: m.id, actorId: state.clientId, text: m.text, updatedAt: m.updatedAt });
    const row = rowEl(m.id); if (row) row.replaceWith(createRow(m));
  }
  cancelEdit();
}
function setBar(title, text, icon) { $('replyTitle').textContent = title; $('replyText').textContent = text; $('replyIcon').innerHTML = icon; $('replyBar').classList.remove('hidden'); }
function clearReply() { state.replyTo = null; if (!state.editingId) $('replyBar').classList.add('hidden'); }
function cancelEdit() { if (state.editingId) { state.editingId = null; $('messageInput').value = ''; autoHeight(); } $('replyBar').classList.add('hidden'); }
function startReply(m) {
  if (state.editingId) cancelEdit();
  state.replyTo = { id: m.id, name: m.mine ? (state.profile.name || 'Вы') : (m.username || 'Собеседник'), text: previewOf(m) };
  setBar(`Ответ: ${state.replyTo.name}`, state.replyTo.text, ICON.reply); keepFocus();
}
async function forwardMessage(m) {
  const rooms = state.rooms.filter(r => r.id !== state.selectedRoomId && (r.type !== 'channel' || isRoomOwner(r)));
  if (!rooms.length) { toast('Создай или добавь другой чат, куда можно переслать сообщение'); return; }
  const menu = rooms.map((r, i) => `${i + 1}. ${r.name || r.username || r.id}`).join('\n');
  const answer = window.prompt(`Куда переслать? Введи номер чата:\n${menu}`, '1');
  if (answer === null) return;
  if (!/^\d+$/.test(answer.trim())) { toast('Введи номер чата из списка'); return; }
  const target = rooms[Number(answer.trim()) - 1]; if (!target) { toast('Такого номера нет в списке'); return; }
  const copy = { ...m, id: randomId(), serverKey: currentServerKey(), clientId: state.clientId, username: state.profile.name || 'Гость', mine: true, delivery: state.serverUrl ? 'sending' : 'local', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), roomId: target.id, forwarded: true, forwardedFrom: m.username || 'собеседника', replyTo: null, reactions: {}, readBy: [], pinned: false, pinnedLocal: false, pinnedBy: '', pinnedAt: null, starred: false, edited: false };
  await saveMsg(copy);
  if (state.serverUrl) await postMessage(copy);
  toast(`Пересылка в «${target.name || target.username || 'чат'}» ${copy.delivery === 'error' ? 'не удалась' : 'выполнена'}`, 2600);
}
function startEdit(m) {
  state.replyTo = null; state.editingId = m.id; toggleSticker(false);
  setBar('Изменение сообщения', previewOf(m), ICON.edit);
  const i = $('messageInput'); i.value = m.text; autoHeight(); i.focus({ preventScroll: true }); i.setSelectionRange(i.value.length, i.value.length);
}
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = document.createElement('textarea'); t.value = text; t.style.cssText = 'position:fixed;opacity:0;left:-999px'; document.body.append(t); t.select();
    try { document.execCommand('copy'); } catch { } t.remove();
  }
  toast('Скопировано', 1600);
}
const REACTION_EMOJIS = [...new Set(
  '👍 👎 ❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💔 ❤️‍🔥 ❤️‍🩹 🩷 🩵 🩶 💯 🔥 ✨ ⭐ 🌟 💫 🎉 🎊 🥳 🚀 💪 🙌 👏 🤝 🙏 🫶 👌 ✌️ 🤞 🤟 🤘 🤙 👀 💅 💐 🌹 🌷 🌈 ☀️ 🌙 ⚡ ❄️ ☕ 🍿 🍕 🍔 🍟 🍩 🍰 🍓 🍒 🍉 🥑 🐈 🐱 🐶 🐻 🦊 🐼 🦄 🦋 🐸 🐢 😂 😀 😃 😄 😁 😆 😅 🤣 🥲 🥹 ☺️ 😊 🙂 🙃 😉 😌 😍 🥰 😘 😗 😙 😚 😋 😛 😜 🤪 😝 🤗 🤭 🫢 🫣 🤫 🤔 🫡 🤨 😐 😑 😶 🫥 😏 😒 🙄 😬 🤥 🫨 😮 😯 😲 😳 🥺 🥹 😦 😧 😨 😰 😥 😢 😭 😱 😖 😣 😞 😓 😩 😫 🥱 😤 😡 😠 🤬 🤯 😵 😵‍💫 🥴 🤢 🤮 😷 🤒 🤕 🤑 🤓 😎 🥸 🤡 💀 ☠️ 👻 👽 🤖 💩 🤠 😇 🫠 🫢 🫤 🫡 😮‍💨 🥵 🥶 🫨 🧠 🫀 🏆 🥇 🥈 🥉 ⚽ 🏀 🎮 🎯 💡 🔑 🛠️ ✅ ❌ ❓ ❗ 💤 💌 💋 💍 💎 🧸 🎵 🎶 🪄 🪩 🧋 🏳️‍🌈 🕊️'.split(/\s+/)
)].filter(Boolean);
const REACTION_QUICK = ['👍','❤️','😂','🔥','🎉','😮','😢','🙏','👎','💯'];
const REACTION_KEYWORDS = {'👍':'лайк хорошо согласен палец вверх','👎':'дизлайк не согласен палец вниз','❤️':'сердце любовь лайк красное','🧡':'сердце оранжевое','💛':'сердце жёлтое','💚':'сердце зелёное','💙':'сердце синее','💜':'сердце фиолетовое','🤍':'сердце белое','🖤':'сердце чёрное','😂':'смех смешно ржу','🤣':'смех катаюсь','😢':'грусть плачу','😭':'слёзы плач','🥰':'любовь влюблён','😍':'глаза сердце любовь','😮':'удивление вау','😱':'страх испуг','🔥':'огонь круто жарко','🎉':'праздник поздравление','👏':'аплодисменты хлопки','🙏':'спасибо пожалуйста молитва','💯':'сто идеально','🤔':'думаю вопрос','✅':'галочка да готово','❌':'крест нет ошибка','🚀':'ракета запуск','⭐':'звезда рейтинг','😡':'злость злой','🤝':'рукопожатие договор','🥹':'умиление тронут','💀':'череп умер со смеху','🤡':'клоун','☕':'кофе','🍕':'пицца','🐈':'кошка','🐶':'собака','⚽':'футбол','🎮':'игра гейминг','✨':'блеск магия'};
function showReactionPicker(m, anchor) {
  document.querySelectorAll('.reaction-picker').forEach(el => el.remove());
  const picker = document.createElement('div'); picker.className = 'reaction-picker'; picker.setAttribute('role','dialog'); picker.setAttribute('aria-label','Выбрать реакцию');
  const head = document.createElement('div'); head.className = 'reaction-picker-header';
  const title = document.createElement('strong'); title.className = 'reaction-picker-title'; title.textContent = 'Реакции'; head.append(title);
  const search = document.createElement('input'); search.type='search'; search.className='reaction-picker-search'; search.placeholder='Найти эмодзи'; search.setAttribute('aria-label','Поиск эмодзи'); head.append(search); picker.append(head);
  const quick = document.createElement('div'); quick.className='reaction-picker-quick';
  for (const emoji of REACTION_QUICK) { const b=document.createElement('button');b.type='button';b.className='reaction-picker-quick-item';b.textContent=emoji;b.title=`Поставить ${emoji}`;b.onclick=()=>{void toggleReaction(m,emoji);picker.remove();};quick.append(b); }
  picker.append(quick);
  const grid = document.createElement('div'); grid.className = 'reaction-picker-grid'; grid.setAttribute('role','listbox'); picker.append(grid);
  const renderEmojiGrid = () => {
    const q=search.value.trim().toLocaleLowerCase('ru'); grid.replaceChildren();
    const list=q?REACTION_EMOJIS.filter(emoji=>emoji.includes(q)||(REACTION_KEYWORDS[emoji]||'').includes(q)):REACTION_EMOJIS;
    for (const emoji of list) { const b = document.createElement('button'); b.type='button'; b.className='reaction-picker-emoji'; b.textContent=emoji; b.setAttribute('aria-label',`Поставить ${emoji}`); b.addEventListener('click',()=>{ void toggleReaction(m,emoji); picker.remove(); }); grid.append(b); }
    if (!list.length) { const empty=document.createElement('p');empty.className='reaction-picker-empty';empty.textContent='Эмодзи не найдены';grid.append(empty); }
  };
  search.addEventListener('input',renderEmojiGrid); renderEmojiGrid(); document.body.append(picker);
  const rect = anchor.getBoundingClientRect(); const mobile = window.innerWidth <= 520;
  const w = Math.min(340, window.innerWidth-24);
  if (mobile) { picker.classList.add('reaction-picker-mobile'); picker.style.width=`${w}px`; }
  else { picker.style.width = `${w}px`; picker.style.left = `${Math.max(12,Math.min(window.innerWidth-w-12,rect.left))}px`; picker.style.top = `${Math.max(12,Math.min(window.innerHeight-340,rect.top-250))}px`; }
  const dismiss = e => { if (!picker.contains(e.target) && e.target !== anchor) { picker.remove(); document.removeEventListener('pointerdown',dismiss,true); } };
  setTimeout(()=>document.addEventListener('pointerdown',dismiss,true),0);
  setTimeout(()=>search.focus({preventScroll:true}),30);
}
async function toggleReaction(m, emoji) {
  if (!m || !emoji) return;
  m.reactions = m.reactions && typeof m.reactions === 'object' ? m.reactions : {};
  const alreadySelected = Array.isArray(m.reactions[emoji]) && m.reactions[emoji].includes(state.clientId);
  for (const key of Object.keys(m.reactions)) {
    const ids = Array.isArray(m.reactions[key]) ? m.reactions[key] : [];
    m.reactions[key] = ids.filter(id => id !== state.clientId);
    if (!m.reactions[key].length) delete m.reactions[key];
  }
  if (!alreadySelected) m.reactions[emoji] = [...(m.reactions[emoji] || []), state.clientId];
  m.updatedAt = new Date().toISOString(); m.reactionsUpdatedAt = m.updatedAt;
  await saveMsg(m);
  const row = rowEl(m.id); if (row) row.replaceWith(createRow(m));
  const sent = await broadcastMeshEvent(m.roomId || state.selectedRoomId || 'global', 'reaction', {
    messageId: m.id, emoji, active: !alreadySelected, actorId: state.clientId, updatedAt: m.updatedAt
  });
  if (!sent && state.authToken) toast('Реакция сохранена на этом устройстве; участники пока не подключены.', 2200);
}

async function togglePin(m) {
  if (!m) return;
  const next = !(m.pinned || m.pinnedLocal);
  m.pinned = next; m.pinnedLocal = next; m.pinnedBy = next ? state.clientId : ''; m.pinnedAt = next ? new Date().toISOString() : null; m.updatedAt = new Date().toISOString();
  await saveMsg(m);
  const row = rowEl(m.id); if (row) row.replaceWith(createRow(m));
  const sent = await broadcastMeshEvent(m.roomId || state.selectedRoomId || 'global', 'pin', {
    messageId: m.id, pinned: next, actorId: state.clientId, updatedAt: m.updatedAt
  });
  toast(next ? (sent ? 'Закрепление отправлено участникам P2P-сети' : 'Закреплено на этом устройстве') : (sent ? 'Закрепление снято у участников P2P-сети' : 'Локальное закрепление снято'));
}

function openPinnedMessages() {
  const pins=state.messages.filter(m=>m.pinned||m.pinnedLocal).sort((a,b)=>new Date(b.pinnedAt||b.createdAt)-new Date(a.pinnedAt||a.createdAt));
  const box=$('pinnedMessagesList'); if(!box)return; box.replaceChildren();
  if(!pins.length){const empty=document.createElement('p');empty.className='form-caption';empty.textContent='В этом чате нет закреплённых сообщений.';box.append(empty);}
  for(const m of pins){const b=document.createElement('button');b.type='button';b.className='search-result';const t=document.createElement('span');t.textContent=(m.text||({image:'Изображение',video:'Видео',circle:'Видеокружок',voice:'Голосовое сообщение',sticker:'Стикер'}[m.type]||'Сообщение')).slice(0,240);const small=document.createElement('small');small.textContent=`${m.pinned?'Закреплено у участников':'Закреплено у вас'} · ${m.username||'Вы'} · ${time(m.createdAt)}`;b.append(t,small);b.onclick=()=>{closeDialog('pinnedMessagesDialog');jumpTo(m.id);};box.append(b);}
  $('pinnedMessagesDialog').showModal();
}
function toggleStar(m) { m.starred = !m.starred; saveMsg(m); refreshMeta(m); toast(m.starred ? 'Добавлено в избранное' : 'Убрано из избранного', 1800); if (state.activePage === 'saved') renderSaved(); }
async function deleteMessage(m) {
  if (!await askConfirm('Удалить сообщение?', 'Сообщение будет удалено из переписки.', 'Удалить')) return;
  state.messages = state.messages.filter(x => x.id !== m.id); msgMap.delete(m.id); hideLocalMessages([m]); await idb.del('messages', m.id); await idb.del('outbox', m.id);
  if (state.editingId === m.id) cancelEdit(); if (state.replyTo?.id === m.id) { state.replyTo = null; $('replyBar').classList.add('hidden'); }
  removeRow(m.id); toast('Сообщение удалено', 1600);
}
async function clearChat() {
  if (!await askConfirm('Очистить историю?', 'Сообщения этого чата будут удалены только с этого телефона. Копии у других участников останутся.', 'Очистить локально')) return;
  const roomId=state.selectedRoomId,serverKey=currentServerKey(),all=await idb.all('messages');
  const doomed=all.filter(m=>(m.roomId||'global')===roomId&&(m.serverKey||currentServerKey())===serverKey);
  hideLocalMessages(doomed);for(const m of doomed){await idb.del('messages',m.id);await idb.del('outbox',m.id);}
  for(const event of await idb.all('events'))if(event.roomId===roomId)await idb.del('events',event.id);
  state.messages = []; msgMap.clear(); cancelEdit(); state.replyTo = null; $('replyBar').classList.add('hidden');
  renderAll(); toast(`Локальная история чата очищена (${doomed.length} сообщений)`);
}
function askConfirm(title, text, okLabel) {
  return new Promise(resolve => {
    const d = $('confirmDialog'); $('confirmTitle').textContent = title; $('confirmText').textContent = text; $('confirmYes').textContent = okLabel;
    let done = false;
    const onClose = () => finish(false);
    const finish = v => { if (done) return; done = true; d.removeEventListener('close', onClose); if (d.open) d.close(); resolve(v); };
    $('confirmYes').onclick = () => finish(true); $('confirmNo').onclick = () => finish(false);
    d.addEventListener('close', onClose); d.showModal();
  });
}

// ---------- message menu (long press / right click) ----------
let menuRow = null;
function closeMenu() { $('msgMenu').classList.add('hidden'); $('msgMenuScrim').classList.add('hidden'); menuRow?.classList.remove('is-selected'); menuRow = null; }
function openMenu(row, x, y) {
  const m = msgMap.get(row.dataset.id); if (!m) return;
  if (menuRow === row) return; closeMenu(); menuRow = row; row.classList.add('is-selected');
  const items = [['reply', 'Ответить', () => startReply(m)], ['forward', 'Переслать в другой чат', () => forwardMessage(m)], ['reaction', 'Поставить реакцию', () => showReactionPicker(m, row.querySelector('.message-bubble'))], ['pin', (m.pinned || m.pinnedLocal) ? 'Открепить сообщение' : 'Закрепить сообщение', () => togglePin(m)]];
  if (m.text) items.push(['copy', 'Копировать', () => copyText(m.text)]);
  items.push(['star', m.starred ? 'Убрать из избранного' : 'В избранное', () => toggleStar(m)]);
  if (m.mine && m.text && !isMedia(m) && !m.system) items.push(['edit', 'Изменить', () => startEdit(m)]);
  if (m.mine && m.delivery === 'error' && m.text) items.push(['retry', 'Отправить снова', () => { m.delivery = 'sending'; refreshMeta(m); postMessage(m); }]);
  items.push(null, ['trash', 'Удалить', () => deleteMessage(m), true]);
  const menu = $('msgMenu'); menu.replaceChildren();
  for (const it of items) {
    if (!it) { menu.append(document.createElement('hr')); continue; }
    const b = document.createElement('button'); b.type = 'button'; b.setAttribute('role', 'menuitem'); if (it[3]) b.className = 'danger';
    b.append(svg(ICON[it[0]]), document.createTextNode(it[1])); b.onclick = () => { closeMenu(); it[2](); }; menu.append(b);
  }
  $('msgMenuScrim').classList.remove('hidden'); menu.classList.remove('hidden');
  const r = row.querySelector('.message-bubble').getBoundingClientRect(), w = menu.offsetWidth, h = menu.offsetHeight, vw = innerWidth, vh = innerHeight;
  let top = r.bottom + 8, below = true;
  if (top + h > vh - 12) { top = r.top - h - 8; below = false; }
  if (top < 12) { top = Math.min(Math.max(12, y - h / 2), vh - h - 12); below = true; }
  let left = m.mine ? r.right - w : r.left; left = Math.min(Math.max(10, left), vw - w - 10);
  menu.style.top = `${Math.round(top)}px`; menu.style.left = `${Math.round(left)}px`;
  menu.style.setProperty('--mo', `${m.mine ? '100%' : '0%'} ${below ? '0%' : '100%'}`);
}
function setupMessageGestures() {
  const box = $('messages'); let press = null, suppress = false;
  const cancel = () => { if (!press) return; clearTimeout(press.timer); press.row.classList.remove('pressing'); press = null; };
  box.addEventListener('pointerdown', e => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const row = e.target.closest('.message-row'); if (!row) return; cancel();
    const p = press = { row, x: e.clientX, y: e.clientY };
    row.classList.add('pressing');
    p.timer = setTimeout(() => {
      if (press !== p) return; row.classList.remove('pressing'); press = null; suppress = true; setTimeout(() => suppress = false, 500);
      navigator.vibrate?.(14); openMenu(row, p.x, p.y);
    }, 380);
  });
  box.addEventListener('pointermove', e => { if (press && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) cancel(); });
  for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) box.addEventListener(ev, cancel);
  box.addEventListener('contextmenu', e => { e.preventDefault(); const row = e.target.closest('.message-row'); if (row && menuRow !== row) { cancel(); openMenu(row, e.clientX, e.clientY); } });
  box.addEventListener('click', e => {
    if (suppress) { e.preventDefault(); e.stopPropagation(); suppress = false; return; }
    const q = e.target.closest('.reply-quote'); if (q) { if (!jumpTo(q.dataset.reply)) toast('Исходное сообщение удалено'); }
  }, true);
  $('msgMenuScrim').addEventListener('pointerdown', e => { e.preventDefault(); closeMenu(); });
  $('msgMenu').addEventListener('mousedown', e => e.preventDefault());
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeMenu(); toggleSticker(false); } });
  area().addEventListener('scroll', () => { state.stick = nearBottom(); }, { passive: true });
}

// ---------- stickers, voice notes and video circles ----------
function toggleSticker(force) {
  const panel = $('stickerPanel'), open = force ?? panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !open); if (open) { renderStickerPanel(); loadServerStickerPacks(); }
}
function renderStickerPanel() {
  const grid = $('stickerGrid'), frag = document.createDocumentFragment();
  const add = document.createElement('button'); add.type = 'button'; add.className = 'sticker-item sticker-add'; add.textContent = '＋'; add.setAttribute('aria-label', 'Создать набор стикеров'); add.onclick = () => $('stickerInput').click(); frag.append(add);
  for (const sticker of BUILTIN_STICKERS) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sticker-item emoji-sticker-tile'; b.textContent = sticker; b.title = 'Отправить стикер'; b.onclick = () => sendMedia({ type: 'sticker', text: sticker }); frag.append(b);
  }
  for (const sticker of state.userStickers) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'sticker-item';
    const img = document.createElement('img'); img.src = sticker.data || serverMediaUrl(sticker.serverUrl, sticker.serverOrigin || state.serverUrl); img.alt = sticker.name || 'Мой стикер'; img.loading = 'lazy'; img.decoding = 'async'; b.append(img);
    b.title = sticker.name || 'Мой стикер'; b.onclick = () => sendMedia({ type: 'sticker', imageData: sticker.data || '', mediaUrl: sticker.serverUrl || '', imageName: sticker.name }); frag.append(b);
  }
  grid.replaceChildren(frag);
}
const readFile = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = () => rej(r.error); r.readAsDataURL(file); });
async function addUserStickers(files) {
  const list = Array.from(files || []).slice(0, 20); if (!list.length) return;
  let added = 0;
  for (const file of list) {
    if (!['image/png','image/jpeg','image/webp','image/avif'].includes(file.type)) { toast('Для стикеров подходят PNG, JPEG, WebP и AVIF'); continue; }
    if (file.size > 700 * 1024) { toast(`${file.name}: размер стикера больше 700 КБ`); continue; }
    try { const data = await readFile(file); const sticker = { id: randomId(), name: file.name.slice(0, 80), data, createdAt: Date.now() }; state.userStickers.unshift(sticker); await idb.put('stickers', sticker); added++; } catch { toast('Не удалось прочитать один из файлов'); }
  }
  renderStickerPanel(); if (added) toast(`Добавлено стикеров: ${added}`);
}
async function createStickerPack() {
  const name = prompt('Название локального набора стикеров:'); if (!name?.trim()) return;
  state.pendingStickerPackName = name.trim().slice(0,60); $('stickerInput').click();
}
async function publishStickerPack(name, files) {
  const list=[];
  for (const file of files.slice(0,20)) {
    if (!['image/png','image/jpeg','image/webp','image/avif'].includes(file.type) || file.size > 700*1024) continue;
    try { list.push({id:randomId(),name:file.name.slice(0,80),data:await readFile(file),createdAt:Date.now()}); } catch {}
  }
  if (!list.length) { toast('Нужны статичные PNG/JPEG/WebP/AVIF до 700 КБ'); return; }
  const packId=randomId();
  for (const sticker of list) { sticker.packId=packId; sticker.packName=name; sticker.name=`${name} · ${sticker.name}`; state.userStickers.unshift(sticker); await idb.put('stickers',sticker); }
  renderStickerPanel();
  // Send bounded batches: WebRTC frames cap an envelope at 16 MiB, so never risk dropping an oversized whole pack.
  const items=list.map(({id,name,data})=>({id,name,data}));
  let batch=[],size=0;
  for(const item of items){const length=JSON.stringify(item).length;if(batch.length&&size+length>10*1024*1024){await broadcastMeshEvent(state.selectedRoomId,'sticker-pack',{id:packId,name,stickers:batch});batch=[];size=0;}batch.push(item);size+=length;}
  if(batch.length)await broadcastMeshEvent(state.selectedRoomId,'sticker-pack',{id:packId,name,stickers:batch});
  toast(`Локальный набор «${name}» создан; участники получат его по P2P, когда будут подключены.`,3000);
}
async function loadServerStickerPacks() {
  const box=$('stickerPackList'); if(!box)return; state.stickerPacks=[];box.replaceChildren();
  const p=document.createElement('p');p.className='sticker-pack-empty';p.textContent='Общие наборы передаются напрямую от участников. Локальные стикеры доступны без сервера.';box.append(p);
}
async function downloadStickerPack(id) {
  const matches=state.userStickers.filter(s=>s.packId===id); if(matches.length){renderStickerPanel();toast('Набор уже сохранён на этом устройстве');return;}
  toast('Набор ещё не получен от участника P2P-сети.');
}

async function addImage(file) {
  if (!file) return; if (!file.type.startsWith('image/')) { toast('Можно прикрепить только изображение'); return; }
  if (file.size > MAX_MEDIA) { toast('Изображение должно быть меньше 8 МиБ'); return; }
  try { sendMedia({ imageData: await readFile(file), type:'image', imageName: file.name }); }
  catch { toast('Не удалось прочитать изображение'); }
}
const VOICE_BUTTON_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3"/><path d="M5 10.5a7 7 0 0 0 14 0M12 17.5V22m-4 0h8"/></svg>';
const VIDEO_BUTTON_ICON = '<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="12" r="8.5"/><path d="m9 8 6 4-6 4z"/><path d="M19 5 22 2"/></svg>';
function updateRecordModeButton() {
  const button = $('recordBtn'); if (!button) return;
  const videoMode = state.composerMediaMode === 'circle';
  button.innerHTML = videoMode ? VIDEO_BUTTON_ICON : VOICE_BUTTON_ICON;
  button.classList.toggle('is-video-mode', videoMode);
  button.setAttribute('aria-label', videoMode ? 'Режим видеокружка. Короткое нажатие переключает на голосовое' : 'Режим голосового. Короткое нажатие переключает на видеокружок');
  button.title = `${videoMode ? 'Видеокружок' : 'Голосовое'} · удерживай для записи · короткое нажатие переключает режим`;
}
function toggleComposerMediaMode() {
  if (state.recorder || state.recordingStarting) return;
  state.composerMediaMode = state.composerMediaMode === 'voice' ? 'circle' : 'voice';
  set(STORE.recordMode, state.composerMediaMode);
  updateRecordModeButton();
  toast(state.composerMediaMode === 'voice' ? 'Режим: голосовое сообщение' : 'Режим: видеокружок', 1300);
}
function chooseMediaMime(kind) {
  const choices = kind === 'voice'
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
    : ['video/webm;codecs=vp8,opus', 'video/webm;codecs=vp8', 'video/webm;codecs=vp9,opus', 'video/webm', 'video/mp4'];
  return choices.find(t => window.MediaRecorder?.isTypeSupported?.(t)) || '';
}
const meshSleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function stopTracks(stream) { for (const track of stream?.getTracks?.() || []) { try { track.stop(); } catch {} } }
async function acquireAudioOnly() {
  // Ask for clear speech with echo cancellation, noise suppression and automatic
  // gain control. Keep constraints as preferences and retain a plain-audio
  // fallback because vendor Android WebViews vary in supported capture options.
  const attempts = [
    { audio: { echoCancellation: { ideal: true }, noiseSuppression: { ideal: true }, autoGainControl: { ideal: true }, sampleRate: { ideal: 48000 }, channelCount: { ideal: 1 } }, video: false },
    { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false },
    { audio: true, video: false }
  ];
  let firstError = null;
  for (let i = 0; i < attempts.length; i++) {
    try { return await navigator.mediaDevices.getUserMedia(attempts[i]); }
    catch (error) {
      firstError ||= error;
      const retryable = ['NotReadableError', 'TrackStartError', 'AbortError', 'OverconstrainedError', 'ConstraintNotSatisfiedError', 'NotSupportedError'].includes(error?.name);
      if (!retryable) throw error;
      if (i < attempts.length - 1) await meshSleep(i === 0 ? 180 : 350);
    }
  }
  throw firstError || new Error('Микрофон недоступен');
}
async function acquireRecordingStream(kind) {
  if (kind === 'voice') return acquireAudioOnly();

  // Keep MediaRecorder's track list stable while allowing the live camera source
  // to change. Wait for real camera frames before capturing the canvas; this
  // avoids starting with an empty/black first frame on Android WebView.
  let audioStream = null, cameraStream = null, canvasStream = null;
  try {
    audioStream = await acquireAudioOnly();
    await meshSleep(120);
    const cameraConstraints = [
      { audio: false, video: { facingMode: { ideal: state.recordingFacingMode || 'user' }, width: { ideal: 360 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } } },
      { audio: false, video: { facingMode: 'user' } },
      { audio: false, video: true }
    ];
    let lastError = null;
    for (const constraints of cameraConstraints) {
      try { cameraStream = await navigator.mediaDevices.getUserMedia(constraints); break; }
      catch (error) { lastError = error; }
    }
    if (!cameraStream?.getVideoTracks?.().length) throw lastError || new Error('Camera unavailable');

    const preview = $('recordingPreview');
    if (!preview) throw new Error('Не найден элемент предпросмотра камеры');
    preview.muted = true; preview.playsInline = true; preview.autoplay = true; preview.srcObject = cameraStream;
    await preview.play().catch(() => {});
    if (!(preview.readyState >= 2 && preview.videoWidth > 0 && preview.videoHeight > 0)) {
      await new Promise((resolve, reject) => {
        let done = false;
        const finish = error => {
          if (done) return; done = true; clearTimeout(timer);
          preview.removeEventListener('loadeddata', onData); preview.removeEventListener('canplay', onData);
          error ? reject(error) : resolve();
        };
        const onData = () => { if (preview.videoWidth > 0 && preview.videoHeight > 0 && preview.readyState >= 2) finish(); };
        const timer = setTimeout(() => finish(new Error('Камера не передала видеокадры')), 6000);
        preview.addEventListener('loadeddata', onData); preview.addEventListener('canplay', onData); onData();
      });
    }

    const canvas = document.createElement('canvas'); canvas.width = 360; canvas.height = 360;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx || !canvas.captureStream) throw new Error('Canvas video capture unavailable');
    state.recordingCameraStream = cameraStream; state.recordingCanvas = canvas; state.recordingUsesCanvas = true;
    const draw = () => {
      if (state.recordingMode !== 'circle' || !state.recordingCanvas) return;
      try {
        if (preview.readyState >= 2 && preview.videoWidth > 0 && preview.videoHeight > 0) {
          const vw = preview.videoWidth, vh = preview.videoHeight, side = Math.min(vw, vh);
          const sx = (vw - side) / 2, sy = (vh - side) / 2;
          ctx.drawImage(preview, sx, sy, side, side, 0, 0, canvas.width, canvas.height);
        }
      } catch (error) { console.debug('Circle preview frame skipped', error); }
      state.recordingCanvasFrame = requestAnimationFrame(draw);
    };
    // Paint at least one actual frame before creating/starting MediaRecorder.
    const vw = preview.videoWidth, vh = preview.videoHeight, side = Math.min(vw, vh);
    ctx.drawImage(preview, (vw-side)/2, (vh-side)/2, side, side, 0, 0, canvas.width, canvas.height);
    draw();
    canvasStream = canvas.captureStream(20);
    const canvasTrack = canvasStream.getVideoTracks()[0];
    if (!canvasTrack || canvasTrack.readyState !== 'live') throw new Error('Canvas video track unavailable');
    return new MediaStream([canvasTrack, ...audioStream.getAudioTracks()]);
  } catch (error) {
    if (state.recordingCanvasFrame) cancelAnimationFrame(state.recordingCanvasFrame);
    state.recordingCanvasFrame = 0;
    stopTracks(audioStream); stopTracks(cameraStream); stopTracks(canvasStream);
    state.recordingCameraStream = null; state.recordingCanvas = null; state.recordingUsesCanvas = false;
    throw error;
  }
}
async function switchRecordingCamera() {
  if (state.recordingMode !== 'circle' || !state.recorder || !state.recordingCanvas || state.recordingCameraSwitching) return;
  state.recordingCameraSwitching = true;
  const button = $('switchCameraBtn'); if (button) button.disabled = true;
  const previousFacing = state.recordingFacingMode || 'user';
  const next = previousFacing === 'user' ? 'environment' : 'user';
  const preview = $('recordingPreview');
  const previous = state.recordingCameraStream;
  let nextStream = null;
  const openCamera = async facing => {
    const constraints = [
      { audio: false, video: { facingMode: { exact: facing }, width: { ideal: 360 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } } },
      { audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 360 }, height: { ideal: 360 } } },
      { audio: false, video: { facingMode: facing } }
    ];
    let lastError = null;
    for (const c of constraints) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia(c);
        if (stream?.getVideoTracks?.().some(track => track.readyState === 'live')) return stream;
        stopTracks(stream);
      } catch (e) { lastError = e; }
    }
    throw lastError || new Error('Camera unavailable');
  };
  try {
    // Android WebView/device camera HALs often cannot open the second lens while
    // the first stream is active. Detach and release the old camera before asking
    // for the other facing mode; the canvas track being recorded stays untouched.
    if (preview) { preview.pause(); preview.srcObject = null; }
    stopTracks(previous);
    state.recordingCameraStream = null;
    await meshSleep(180);
    try {
      nextStream = await openCamera(next);
    } catch (switchError) {
      // If the requested lens is unavailable, restore the original camera so the
      // ongoing recording/preview is not left black.
      try {
        nextStream = await openCamera(previousFacing);
        state.recordingCameraStream = nextStream;
        if (preview) { preview.srcObject = nextStream; await preview.play().catch(() => {}); }
      } catch (restoreError) {
        state.recordingCameraStream = null;
      }
      throw switchError;
    }
    if (!preview) throw new Error('Не найден элемент предпросмотра камеры');
    preview.muted = true; preview.playsInline = true; preview.autoplay = true;
    preview.srcObject = nextStream;
    await preview.play().catch(() => {});
    await new Promise((resolve, reject) => {
      let done = false;
      const finish = error => {
        if (done) return; done = true; clearTimeout(timer);
        preview.removeEventListener('loadeddata', onData); preview.removeEventListener('canplay', onData);
        error ? reject(error) : resolve();
      };
      const onData = () => {
        if (preview.srcObject === nextStream && preview.readyState >= 2 && preview.videoWidth > 0 && preview.videoHeight > 0) finish();
      };
      const timer = setTimeout(() => finish(new Error('Camera did not produce frames')), 6000);
      preview.addEventListener('loadeddata', onData); preview.addEventListener('canplay', onData); onData();
    });
    state.recordingCameraStream = nextStream;
    state.recordingFacingMode = next;
    if (button) button.textContent = next === 'environment' ? '↻ Основная' : '↻ Фронтальная';
  } catch (error) {
    // Keep the recording alive even when the device cannot switch lenses.
    toast(error?.name === 'NotReadableError'
      ? 'Не удалось открыть другую камеру: устройство занято. Запись продолжается.'
      : 'Не удалось переключить камеру. Проверь разрешение на камеру; запись продолжается.');
  } finally {
    state.recordingCameraSwitching = false;
    if (button) button.disabled = false;
  }
}
function updateRecordingClock() {
  if (!state.recordingStartedAt) return;
  const elapsed = Math.max(0, Math.floor((performance.now() - state.recordingStartedAt) / 1000));
  const timer = $('recordingTimer'); if (timer) timer.textContent = formatDuration(elapsed);
}
function showRecordingBar(kind, stream) {
  const bar = $('recordingBar'); if (!bar) return;
  bar.classList.remove('hidden', 'cancel-active', 'locked');
  bar.dataset.kind = kind;
  $('recordingTitle').textContent = kind === 'voice' ? 'Запись голосового' : 'Запись видеокружка';
  $('recordingHint').textContent = 'Смахни влево — отмена · вверх — без удержания';
  $('recordingTimer').textContent = '0:00';
  const preview = $('recordingPreview'), previewWrap = $('recordingPreviewWrap');
  if (kind === 'circle') { previewWrap.classList.remove('hidden'); preview.muted = true; preview.playsInline = true; preview.srcObject = state.recordingCameraStream || stream; preview.play?.().catch(() => {}); const sw=$('switchCameraBtn'); if(sw){sw.classList.toggle('hidden', !state.recordingUsesCanvas);sw.disabled=false;sw.textContent='↻ Основная';} }
  else { previewWrap.classList.add('hidden'); preview.srcObject = null; const sw=$('switchCameraBtn'); if(sw) sw.classList.add('hidden'); }
  $('recordingSendBtn').disabled = false;
  state.recordingTicker = setInterval(updateRecordingClock, 250);
}
function setRecordingHint(text, mode = '') {
  const bar = $('recordingBar'); if (!bar) return;
  bar.classList.toggle('cancel-active', mode === 'cancel');
  bar.classList.toggle('locked', mode === 'locked');
  $('recordingHint').textContent = text;
}
async function toggleRecording(kind) {
  if (state.recorder || state.recordingStarting) {
    if (state.recordingMode && state.recordingMode !== kind) { toast('Сначала заверши текущую запись'); return; }
    stopRecording(); return;
  }
  await startRecording(kind);
}
async function startRecording(kind) {
  if (state.recorder || state.recordingStarting) { toast('Запись уже идёт'); return; }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Запись недоступна. Обнови Android System WebView/Chrome.', 4500); return; }
  if (state.call?.stream?.getTracks?.().some(track => track.readyState === 'live')) { toast('Сначала заверши текущий звонок — микрофон или камера уже используются им.', 4000); return; }
  // Defensively release any leftover capture tracks before asking Android WebView again.
  try { for (const track of state.recordingStream?.getTracks?.() || []) track.stop(); } catch {}
  state.recordingStream = null;
  state.recordingStarting = true; state.recordingMode = kind; if (kind === 'circle') state.recordingFacingMode = 'user'; state.recordingStopRequested = false; state.discardRecording = false; state.recordingLocked = false;
  let stream = null;
  try {
    try { state.nativeCaptureAudioActive = window.PgmzNative?.beginMediaCapture?.() === true; } catch (nativeError) { console.warn('Native audio focus bridge unavailable', nativeError); }
    stream = await acquireRecordingStream(kind);
    if (kind === 'circle' && !stream.getVideoTracks().some(track => track.readyState === 'live')) {
      throw new Error('Камера не создала активную видеодорожку');
    }
    if (kind === 'voice' && !stream.getAudioTracks().some(track => track.readyState === 'live')) {
      throw new Error('Микрофон не создал активную аудиодорожку');
    }
    state.recordingStream = stream;
    state.recordingLevels = [];
    if (kind === 'voice') {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const context = new AudioCtx(); await context.resume().catch(() => {});
          const source = context.createMediaStreamSource(stream), analyser = context.createAnalyser();
          analyser.fftSize = 256; source.connect(analyser);
          state.recordingAudioContext = context; state.recordingSource = source; state.recordingAnalyser = analyser;
          const samples = new Uint8Array(analyser.fftSize);
          state.recordingLevelTimer = setInterval(() => {
            try {
              analyser.getByteTimeDomainData(samples); let sum = 0;
              for (const value of samples) { const centered = (value - 128) / 128; sum += centered * centered; }
              const level = Math.min(1, Math.sqrt(sum / samples.length) * 6);
              state.recordingLevels.push(level);
              const bars = $('recordingWaveform')?.children;
              if (bars?.length) for (let i = 0; i < bars.length; i++) {
                const start = Math.floor(i * state.recordingLevels.length / bars.length);
                const segment = state.recordingLevels.slice(start, Math.max(start + 1, Math.ceil((i + 1) * state.recordingLevels.length / bars.length)));
                const value = segment.reduce((a, b) => a + b, 0) / segment.length;
                bars[i].style.height = `${4 + value * 18}px`;
              }
            } catch {}
          }, 100);
        }
      } catch (e) { console.debug('Audio waveform meter unavailable', e); }
    }
    const mimeType = chooseMediaMime(kind);
    let recorder;
    // Low, explicit bitrates keep round videos small enough to upload reliably
    // from Android WebView over mobile networks.
    const recorderOptions = {
      ...(mimeType ? { mimeType } : {}),
      ...(kind === 'circle' ? { videoBitsPerSecond: 520000, audioBitsPerSecond: 96000 } : { audioBitsPerSecond: 96000 })
    };
    try { recorder = new MediaRecorder(stream, recorderOptions); }
    catch (firstError) {
      try { recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined); }
      catch (secondError) {
        try { recorder = new MediaRecorder(stream); }
        catch { throw secondError || firstError; }
      }
    }
    state.recorder = recorder; state.recordingStream = stream; state.recordingChunks = []; state.recordingStartedAt = performance.now();
    const btn = $('recordBtn'); btn.classList.add('recording'); btn.title = 'Запись идёт · отпусти для отправки'; btn.setAttribute('aria-pressed', 'true');
    showRecordingBar(kind, stream);
    recorder.ondataavailable = e => { if (e.data?.size) state.recordingChunks.push(e.data); };
    recorder.onerror = e => { console.error('PgmzChat recorder error', e); state.discardRecording = true; cleanupRecording(); toast('Ошибка записи. Попробуй ещё раз.', 4000); };
    recorder.onstop = async () => {
      const blob = new Blob(state.recordingChunks, { type: recorder.mimeType || (kind === 'voice' ? 'audio/webm' : 'video/webm') });
      const duration = cleanDuration(Math.max(1, Math.round((performance.now() - state.recordingStartedAt) / 1000)), kind);
      let posterData = '';
      if (kind === 'circle' && state.recordingCanvas) {
        try { posterData = state.recordingCanvas.toDataURL('image/jpeg', 0.78); } catch (error) { console.debug('Video-note poster unavailable', error); }
      }
      const discard = state.discardRecording;
      const waveform = kind === 'voice' && state.recordingLevels.length ? Array.from({ length: 32 }, (_, i) => {
        const start = Math.floor(i * state.recordingLevels.length / 32), end = Math.max(start + 1, Math.floor((i + 1) * state.recordingLevels.length / 32));
        const segment = state.recordingLevels.slice(start, end); return Math.round(Math.min(1, segment.reduce((a, b) => a + b, 0) / segment.length) * 100) / 100;
      }) : [];
      cleanupRecording();
      if (discard) { toast('Запись отменена'); return; }
      if (!blob.size) { toast('Запись пустая. Попробуй ещё раз.'); return; }
      if (kind === 'circle' && !String(blob.type || recorder.mimeType || '').startsWith('video/')) {
        toast('WebView сохранил запись без видеоформата. Обнови Android System WebView и попробуй ещё раз.', 4500); return;
      }
      if (blob.size > MAX_MEDIA) { toast('Файл больше 8 МБ. Запиши видеокружок короче и отправь ещё раз.', 5000); return; }
      try {
        // Do not embed a codecs parameter in a Data URL. Some recorder MIME values
        // contain a comma (for example video/webm;codecs=vp8,opus); that comma is
        // also the Data URL metadata/payload separator and breaks playback.
        const fallbackMime = kind === 'voice' ? 'audio/webm' : 'video/webm';
        const mediaMime = canonicalMediaMime(blob.type || recorder.mimeType, fallbackMime);
        const safeBlob = new Blob([blob], { type: mediaMime });
        const data = await blobToDataUrl(safeBlob, mediaMime);
        const ext = mediaMime.endsWith('/mp4') ? 'mp4' : mediaMime.endsWith('/ogg') ? 'ogg' : 'webm';
        sendMedia({ type: kind === 'voice' ? 'voice' : 'circle', mediaData: data, mediaMime, imageName: kind === 'voice' ? `voice.${ext}` : `circle.${ext}`, duration, ...(kind === 'circle' && posterData.startsWith('data:image/jpeg') && posterData.length <= 180_000 ? { posterData } : {}), ...(waveform.length ? { waveform } : {}) });
      } catch (error) { console.error('Could not prepare recorded media', error); toast('Не удалось подготовить медиа'); }
    };
    try { recorder.start(); }
    catch (e) { throw e; }
    state.recordingStarting = false;
    if (state.recordingStopRequested) { if (state.discardRecording) cancelRecording(); else stopRecording(); }
    state.recordingTimeout = setTimeout(() => { if (state.recorder === recorder) { toast('Достигнут предел записи'); stopRecording(); } }, kind === 'voice' ? 180000 : 60000);
  } catch (e) {
    for (const track of stream?.getTracks?.() || []) track.stop();
    state.recordingStarting = false;
    const name = e?.name || 'Error';
    const msg = name === 'NotAllowedError' || name === 'PermissionDeniedError'
      ? 'Нет разрешения на микрофон или камеру. Проверь разрешения Android и перезапусти приложение.'
      : name === 'NotFoundError' || name === 'DevicesNotFoundError'
      ? 'Не найден микрофон или камера.'
      : name === 'NotReadableError' || name === 'TrackStartError' || name === 'AbortError'
      ? `Android не запустил ${kind === 'voice' ? 'микрофон' : 'камеру или микрофон'} (${name}). Я попробовал совместимый режим захвата. Проверь системный переключатель «Доступ к микрофону/камере», закрой звонки и диктофон, затем перезапусти PgmzChat. Если повторится — нужен журнал PgmzMedia chromium.`
      : name === 'SecurityError' || !window.isSecureContext
      ? 'WebView не предоставляет безопасный контекст для записи. Используй встроенное приложение и обновлённый WebView.'
      : name === 'NotSupportedError'
      ? 'WebView не поддерживает доступный формат записи. Обнови Android System WebView/Chrome.'
      : `Ошибка ${name}: ${e?.message || 'неизвестная причина'}`;
    cleanupRecording(); toast(msg, 6500);
  }
}
function stopRecording() {
  if (state.recordingStarting && !state.recorder) { state.recordingStopRequested = true; return; }
  const recorder = state.recorder;
  if (!recorder) return;
  try { if (recorder.state !== 'inactive') recorder.stop(); else cleanupRecording(); }
  catch (e) { console.warn('Could not stop MediaRecorder', e); cleanupRecording(); toast('Не удалось завершить запись'); }
}
function cancelRecording() {
  state.discardRecording = true;
  if (state.recordingStarting && !state.recorder) { state.recordingStopRequested = true; return; }
  stopRecording();
}
function cleanupRecording() {
  clearTimeout(state.recordingTimeout); state.recordingTimeout = null;
  clearInterval(state.recordingTicker); state.recordingTicker = null;
  clearInterval(state.recordingLevelTimer); state.recordingLevelTimer = null;
  try { state.recordingSource?.disconnect(); state.recordingAnalyser?.disconnect(); } catch {}
  const audioContext = state.recordingAudioContext; state.recordingAudioContext = null; state.recordingAnalyser = null; state.recordingSource = null;
  if (audioContext && audioContext.state !== 'closed') audioContext.close().catch(() => {});
  const preview = $('recordingPreview'); if (preview) { try { preview.pause(); } catch {} preview.srcObject = null; }
  if (state.recordingCanvasFrame) cancelAnimationFrame(state.recordingCanvasFrame); state.recordingCanvasFrame = 0;
  stopTracks(state.recordingCameraStream); state.recordingCameraStream = null; state.recordingCanvas = null; state.recordingUsesCanvas = false;
  stopTracks(state.recordingStream);
  if (state.nativeCaptureAudioActive) { try { window.PgmzNative?.endMediaCapture?.(); } catch {} state.nativeCaptureAudioActive = false; }
  state.recordingStream = null; state.recorder = null; state.recordingChunks = []; state.recordingLevels = []; state.recordingMode = null; state.recordingStartedAt = 0; state.recordingLocked = false; state.recordingStarting = false; state.recordingStopRequested = false;
  $('recordingBar')?.classList.add('hidden'); $('recordingBar')?.classList.remove('cancel-active', 'locked');
  const button = $('recordBtn'); button?.classList.remove('recording'); button?.removeAttribute('aria-pressed');
  updateRecordModeButton();
}
function bindRecordingButton() {
  const cameraSwitch = $('switchCameraBtn'); if (cameraSwitch) cameraSwitch.addEventListener('click', switchRecordingCamera);
  const btn = $('recordBtn'); if (!btn) return;
  updateRecordModeButton();
  btn.addEventListener('pointerdown', e => {
    if (e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    try { btn.setPointerCapture(e.pointerId); } catch {}
    const kind = state.composerMediaMode;
    const alreadyRecording = !!(state.recorder || (state.recordingStarting && state.recordingMode === kind));
    state.recordingPress = { kind, pointerId: e.pointerId, x: e.clientX, y: e.clientY, long: false, cancel: false, locked: false, alreadyRecording };
    if (alreadyRecording) return;
    clearTimeout(state.recordingPressTimer);
    state.recordingPressTimer = setTimeout(() => {
      const p = state.recordingPress; if (!p || p.pointerId !== e.pointerId) return;
      p.long = true;
      startRecording(kind);
    }, 260);
  });
  btn.addEventListener('pointermove', e => {
    const p = state.recordingPress; if (!p || p.pointerId !== e.pointerId || !p.long) return;
    if (e.clientX < p.x - 70) { p.cancel = true; p.locked = false; setRecordingHint('Отпусти, чтобы отменить запись', 'cancel'); }
    else if (e.clientY < p.y - 70) { p.locked = true; state.recordingLocked = true; setRecordingHint('Запись заблокирована · нажми «Отправить» или «Отмена»', 'locked'); }
    else if (!p.cancel && !p.locked) setRecordingHint('Смахни влево — отмена · вверх — блокировка');
  });
  const release = e => {
    const p = state.recordingPress; if (!p || (e.pointerId !== undefined && p.pointerId !== e.pointerId)) return;
    clearTimeout(state.recordingPressTimer); state.recordingPressTimer = null;
    if (p.cancel) cancelRecording();
    else if (p.locked) { state.recordingLocked = true; setRecordingHint('Запись заблокирована · нажми «Отправить» или «Отмена»', 'locked'); }
    else if (p.long || p.alreadyRecording) {
      if (state.recordingStarting && !state.recorder) state.recordingStopRequested = true;
      else stopRecording();
    } else if (!p.alreadyRecording) {
      // Telegram-like interaction: tap switches microphone/video mode; hold records.
      toggleComposerMediaMode();
    }
    state.recordingPress = null;
  };
  btn.addEventListener('pointerup', release);
  btn.addEventListener('pointercancel', e => {
    const p = state.recordingPress; if (p && p.pointerId === e.pointerId) {
      clearTimeout(state.recordingPressTimer); state.recordingPressTimer = null;
      if (p.long || p.alreadyRecording) cancelRecording();
      state.recordingPress = null;
    }
  });
  btn.addEventListener('click', e => { if (e.detail === 0) toggleComposerMediaMode(); });
  btn.addEventListener('contextmenu', e => e.preventDefault());
}

// ---------- saved ----------
function renderSaved() {
  const list = $('savedList'); list.replaceChildren();
  const items = state.messages.filter(m => m.starred).reverse();
  $('savedEmpty').classList.toggle('hidden', items.length > 0);
  for (const m of items) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'search-result';
    const t = document.createElement('span'); t.textContent = previewOf(m);
    const s = document.createElement('small'); s.textContent = `${m.mine ? (state.profile.name || 'Вы') : (m.username || 'Собеседник')} · ${dateKey(m.createdAt)}, ${time(m.createdAt)}`;
    b.append(t, s); b.onclick = () => jumpTo(m.id); list.append(b);
  }
}

// ---------- server ----------
async function uploadMediaData() {
  throw new Error('PgmzChat не загружает медиа на сервер. Вложения передаются напрямую по P2P, когда участник доступен.');
}
async function postMessage(message) {
  if (!message) return;
  const roomId = message.roomId || state.selectedRoomId || 'global';
  message.serverKey = currentServerKey();
  const payload = peerMessagePayload({ ...message, clientId: state.clientId, username: message.username || state.profile.name }, roomId);
  // Keep an outgoing copy on this device until at least one P2P neighbour accepts it.
  // This queue is local IndexedDB, never sent to the signalling server.
  await idb.put('outbox', { id: message.id, roomId, createdAt: message.createdAt || new Date().toISOString(), serverKey: '__p2p__', payload });
  try {
    const sent = await broadcastMeshEvent(roomId, 'message', payload, { eventId: message.id, hops: 8 });
    message.delivery = sent > 0 ? 'sending' : 'queued';
    message.updatedAt = new Date().toISOString();
    await saveMsg(message); updateMessageStatus(message.id, message.delivery);
    if (!sent && state.authToken) toast('Сообщение и вложение стоят в локальной очереди и уйдут при появлении P2P-соседа.', 2800);
    else if (sent > 0) toast('Передано P2P-соседу; ждём подтверждение сохранения.', 1800);
  } catch (error) {
    message.delivery = 'queued'; await saveMsg(message); updateMessageStatus(message.id, 'queued');
    toast(`Сообщение сохранено на этом телефоне и будет повторено при P2P-соединении: ${error.message || 'нет связи'}`, 3200);
  }
}

async function reloadCurrentRoomMessages() {
  const all = await idb.all('messages');
  for (const message of all) {
    if (!message.serverKey) { message.serverKey = currentServerKey(); await saveMsg(message); }
  }
  state.messages = all.filter(m => (m.serverKey || currentServerKey()) === currentServerKey() && (m.roomId || 'global') === state.selectedRoomId).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  msgMap.clear(); for (const m of state.messages) msgMap.set(m.id, m);
  if ($('keepHistoryToggle')) { const p = getLocalChatPref(state.selectedRoomId); $('keepHistoryToggle').checked = p.keepHistory !== false; $('cacheMediaToggle').checked = p.cacheMedia === true; }
  state.limit = PAGE; state.lastDay = ''; renderAll();
}
async function changeServerContext(url) {
  const changed = state.serverUrl !== url;
  if (changed && state.call) await endCall(false);
  if (changed) state.serverEpoch++;
  state.serverUrl = url; localStorage.setItem(STORE.server, url); $('serverUrlInput').value = url; rememberServer(url);
  if (changed) {
    state.lastSyncAt = 0;
    clearInterval(state.pollTimer); state.pollTimer = null; state.pollBusy = false; state.callPollBusy = false;
    state.callSignalCursor = Date.now() - 120000;
    state.selectedRoomId = getScopedString('selectedRoom', 'global');
    state.rooms = getScoped('rooms', [{ id: 'global', name: 'Общая группа', type: 'group', ownerId: 'system' }]);
    state.contacts = getScoped('contacts', []); state.folders = getScoped('folders', []); state.activeFolder = getScopedString('activeFolder', 'all');
    await loadRooms(); await loadContacts();
    if (!state.rooms.some(r => r.id === state.selectedRoomId)) { state.selectedRoomId = 'global'; setScopedString('selectedRoom', 'global'); }
    await reloadCurrentRoomMessages();
    const room = activeRoom(); $('chatPage').querySelector('h1').textContent = room.name; $('chatPage').querySelector('.test-avatar').textContent = room.type === 'channel' ? '◉' : room.type === 'direct' ? '●' : '◌';
    if (room.type === 'channel' && !isRoomOwner(room)) { $('messageInput').placeholder = 'Только владелец канала может публиковать'; $('sendBtn').disabled = true; $('recordBtn').disabled = true; $('attachBtn').disabled = true; }
    else { $('messageInput').placeholder = 'Написать сообщение…'; $('sendBtn').disabled = false; $('recordBtn').disabled = false; $('attachBtn').disabled = false; }
    renderFolderTabs(); renderRoomList(); renderContacts(); updateConnectionStatus(); renderAll();
  }
  setServerStatus('Адрес сохранён'); restartPolling(); loadServerStickerPacks(); startCallPolling();
}
function normalizeServerUrl(raw) {
  let v = String(raw || '').trim(); if (!v) throw new Error('Введи IP-адрес или URL сервера');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `http://${v}`;
  let u; try { u = new URL(v); } catch { throw new Error('Проверь формат адреса сервера'); }
  if (!['http:', 'https:'].includes(u.protocol)) throw new Error('Поддерживаются только HTTP и HTTPS');
  if (!u.hostname) throw new Error('Не указан адрес сервера');
  if (u.username || u.password) throw new Error('Логин и пароль нельзя указывать в URL');
  if (u.search || u.hash) throw new Error('Укажи только адрес сервера без параметров и якоря');
  if (u.pathname !== '/') throw new Error('Укажи адрес сервера без пути, например http://192.168.1.10:8080');
  return u.origin.replace(/\/$/, '');
}
function renderServerProfiles() {
  const select = $('serverProfilesSelect'); if (!select) return;
  const currentSelection = select.value;
  select.replaceChildren();
  const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Выбрать сохранённый сервер…'; select.append(placeholder);
  for (const url of state.servers) { const option = document.createElement('option'); option.value = url; option.textContent = url; select.append(option); }
  select.value = state.servers.includes(currentSelection) ? currentSelection : (state.serverUrl && state.servers.includes(state.serverUrl) ? state.serverUrl : '');
}
function rememberServer(url) {
  state.servers = [url, ...state.servers.filter(x => x !== url)].slice(0, 8);
  set(STORE.servers, state.servers); renderServerProfiles();
}
function setServerStatus(label, status = 'idle') { const pill = $('serverStatusLabel').parentElement; pill.classList.remove('connected', 'error'); if (status === 'ok') pill.classList.add('connected'); if (status === 'error') pill.classList.add('error'); $('serverStatusLabel').textContent = label; }
async function applyServer(url, toastOnSuccess = true) {
  await changeServerContext(url);
  if (toastOnSuccess) toast('Адрес сервера сохранён');
}
function saveServer() {
  try { applyServer(normalizeServerUrl($('serverUrlInput').value)); }
  catch (e) { toast(e.message || 'Некорректный адрес', 3200); $('serverUrlInput').focus(); }
}
function removeServerProfile() {
  let url = $('serverProfilesSelect').value;
  try { url = url || normalizeServerUrl($('serverUrlInput').value || state.serverUrl); } catch {}
  if (!url || !state.servers.includes(url)) { toast('Сначала выбери сохранённый адрес'); return; }
  state.servers = state.servers.filter(x => x !== url); set(STORE.servers, state.servers); renderServerProfiles(); toast('Адрес удалён из списка сохранённых');
}
async function testServer() {
  let url; try { url = normalizeServerUrl($('serverUrlInput').value || state.serverUrl); $('serverUrlInput').value = url; } catch (e) { toast(e.message); return; }
  setServerStatus('Проверяю сервер…'); let lastError = null;
  for (const path of ['/api/health', '/health']) {
    const c = new AbortController(), t = setTimeout(() => c.abort(), 4500);
    try {
      const r = await fetch(`${url}${path}`, { cache: 'no-store', signal: c.signal, headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      await changeServerContext(url); updateConnectionStatus(); setServerStatus(`Подключение успешно · ${path}`, 'ok'); toast('Сервер отвечает');
      restartPolling(); loadRooms(); loadContacts(); loadServerStickerPacks(); startCallPolling(); return;
    } catch (e) { lastError = e; } finally { clearTimeout(t); }
  }
  setServerStatus(`Не удалось подключиться · ${lastError?.message || 'ошибка сети'}`, 'error'); toast('Проверка не прошла. Текущий сервер не изменён; проверь IP, сервер и CORS.', 4000);
}
function restartPolling() {
  // startMesh owns the single presence timer; avoid duplicate requests.
  clearInterval(state.pollTimer); state.pollTimer = null;
  const canKeepConnection = !!(state.serverUrl && state.authToken && state.accountId && !state.testMode);
  try { window.PgmzNative?.setBackgroundConnectionEnabled?.(canKeepConnection); } catch (error) { console.debug('Native background service unavailable', error); }
  if (!canKeepConnection) { stopMesh(); updateMeshUi(); return; }
  void startMesh();
}

async function notifyIncoming(message) {
  if (!state.notifications || document.visibilityState !== 'hidden') return;
  const body=(message.text||({image:'Изображение',voice:'Голосовое сообщение',circle:'Видеокружок',video:'Видео',file:'Файл',sticker:'Стикер'}[message.type]||'Новое сообщение')).slice(0,180);
  try {
    if (window.PgmzNative && typeof window.PgmzNative.showNotification === 'function') {
      window.PgmzNative.showNotification(message.username || 'Новое сообщение', body, `pgmz-${message.roomId || 'global'}`); return;
    }
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) { const reg=await navigator.serviceWorker.ready; if(reg && typeof reg.showNotification==='function') await reg.showNotification(message.username||'Новое сообщение',{body,icon:'/pgmz_icon.png',tag:`pgmz-${message.roomId||'global'}`,data:{roomId:message.roomId||'global'}}); }
  } catch (e) { console.debug('Notification unavailable', e); }
}
async function markRemoteMessageRead(message) {
  if (!message || message.clientId === state.clientId || (message.serverKey || currentServerKey()) !== currentServerKey()) return;
  message.readBy = [...new Set([...(message.readBy || []), state.clientId])].slice(-200);
  message.updatedAt = new Date().toISOString(); await saveMsg(message);
  await broadcastMeshEvent(message.roomId || state.selectedRoomId || 'global', 'read', { messageId: message.id, readerId: state.clientId, updatedAt: message.updatedAt });
  const row = rowEl(message.id); if (row) refreshMeta(message);
}

window.PgmzNativeNotificationPermission = granted => {
  const toggle=$('notificationsToggle'); state.notifications=!!granted; set('pgmz.clientserver.notifications',state.notifications);
  if(toggle)toggle.checked=state.notifications;
  toast(state.notifications?'Уведомления включены':'Разрешение на уведомления не выдано',2800);
};
async function enableNotifications(enabled) {
  const toggle=$('notificationsToggle');
  if(!enabled){state.notifications=false;set('pgmz.clientserver.notifications',false);if(toggle)toggle.checked=false;toast('Уведомления выключены');return;}
  if(window.PgmzNative && typeof window.PgmzNative.requestNotifications==='function'){
    if(toggle)toggle.checked=false;
    try{window.PgmzNative.requestNotifications();}catch(error){state.notifications=false;set('pgmz.clientserver.notifications',false);if(toggle)toggle.checked=false;toast('Не удалось запросить разрешение Android. Настройки не изменены.',3200);}
    return;
  }
  if(!('Notification' in window)||!window.isSecureContext){state.notifications=false;set('pgmz.clientserver.notifications',false);if(toggle)toggle.checked=false;toast('Уведомления недоступны в этом окружении.',3200);return;}
  try{let permission=Notification.permission;if(permission==='default')permission=await Notification.requestPermission();state.notifications=permission==='granted';set('pgmz.clientserver.notifications',state.notifications);if(toggle)toggle.checked=state.notifications;toast(state.notifications?'Уведомления включены':'Разрешение на уведомления не выдано');}
  catch(err){state.notifications=false;set('pgmz.clientserver.notifications',false);if(toggle)toggle.checked=false;console.debug('Notification permission failed safely',err);toast('Не удалось включить уведомления. Интерфейс не изменён.',3000);}
}

async function pollMessages() {
  // No server-side message API exists in this architecture. Polling only keeps
  // ephemeral presence/signalling alive; chat payloads move through WebRTC.
  if (!state.serverUrl || !state.authToken) { updateMeshUi(); return; }
  await announcePresence();
}

// ---------- unified chats, contacts and groups/channels ----------
async function loadRooms() {
  let local=state.rooms.length?state.rooms:getScoped('rooms',[{id:'global',name:'Общая группа',type:'group',ownerId:'system',members:[]}]);
  if(!local.some(r=>r.id==='global'))local.unshift({id:'global',name:'Общая группа',type:'group',ownerId:'system',members:[]});
  let normalized=false;
  for(const room of local){
    if(room.type!=='channel')continue;
    if(!room.ownerAccountId&&/^u_[a-f0-9]{32}$/i.test(String(room.ownerId||''))){room.ownerAccountId=room.ownerId;normalized=true;}
    if(room.ownerAccountId&&room.ownerAccountId===state.accountId){if(!room.ownerUsername){room.ownerUsername=state.account?.username||state.profile.handle||'';normalized=true;}if(!room.ownerDeviceId){room.ownerDeviceId=state.deviceId;normalized=true;}}
    if(!room.ownerAccountId&&!state.accountId&&room.ownerId===state.clientId){room.ownerDeviceId ||= state.deviceId;room.ownerUsername ||= state.profile.handle||'';normalized=true;}
  }
  state.rooms=local;setScoped('rooms',local);renderFolderTabs();renderRoomList();
}
function renderFolderTabs(){
  const container=$('chatFolders');if(!container)return;
  container.querySelectorAll('[data-folder]').forEach(b=>b.classList.toggle('active',b.dataset.folder===state.activeFolder));
  const custom=$('customFolderTabs');if(!custom)return;custom.replaceChildren();
  for(const folder of state.folders||[]){const b=document.createElement('button');b.type='button';b.className='chat-folder-pill custom-folder'+(state.activeFolder===`custom:${folder.id}`?' active':'');b.dataset.folder=`custom:${folder.id}`;b.textContent=folder.name;b.title=`Папка: ${folder.name}. Долгое нажатие — изменить`;
    let hold=null,held=false;b.addEventListener('pointerdown',()=>{held=false;hold=setTimeout(()=>{held=true;editChatFolder(folder.id);},600);});for(const ev of ['pointerup','pointerleave','pointercancel'])b.addEventListener(ev,()=>clearTimeout(hold));
    b.addEventListener('click',()=>{if(held){held=false;return;}state.activeFolder=`custom:${folder.id}`;setScopedString('activeFolder',state.activeFolder);renderFolderTabs();renderRoomList();});custom.append(b);}
}
function folderEntries(){
  const ordered=[...state.rooms].sort((a,b)=>(a.id==='global'?-1:b.id==='global'?1:new Date(a.createdAt||0)-new Date(b.createdAt||0)));
  const roomPeerIds=new Set(ordered.filter(r=>r.type==='direct').flatMap(r=>(r.members||[]).filter(id=>id!==state.clientId)));
  const contacts=state.contacts.filter(c=>!roomPeerIds.has(c.peerId));
  let entries=[];
  const mode=state.activeFolder;
  if(mode==='all')entries=[...ordered,...contacts.map(c=>({id:`contact:${c.peerId}`,name:c.name,type:'contact',contact:c}))];
  else if(mode==='direct')entries=[...ordered.filter(r=>r.type==='direct'),...contacts.map(c=>({id:`contact:${c.peerId}`,name:c.name,type:'contact',contact:c}))];
  else if(mode==='group')entries=ordered.filter(r=>r.type==='group');
  else if(mode==='channel')entries=ordered.filter(r=>r.type==='channel');
  else if(mode==='contacts')entries=[...state.contacts.map(c=>({id:`contact:${c.peerId}`,name:c.name,type:'contact',contact:c}))];
  else if(mode.startsWith('custom:')){const folder=state.folders.find(f=>f.id===mode.slice(7));const setIds=new Set(folder?.items||[]);const selectedRooms=ordered.filter(r=>setIds.has(`room:${r.id}`));const peers=new Set(selectedRooms.filter(r=>r.type==='direct').flatMap(r=>(r.members||[]).filter(id=>id!==state.clientId)));entries=[...selectedRooms,...state.contacts.filter(c=>setIds.has(`contact:${c.peerId}`)&&!peers.has(c.peerId)).map(c=>({id:`contact:${c.peerId}`,name:c.name,type:'contact',contact:c}))];}
  return entries;
}
function renderRoomList(){
  const box=$('roomList');if(!box)return;box.replaceChildren();const entries=folderEntries();
  if(!entries.length){const empty=document.createElement('div');empty.className='room-list-empty';empty.textContent=state.activeFolder.startsWith('custom:')?'Папка пустая. Удерживай её, чтобы добавить чаты.':state.activeFolder==='contacts'?'Контактов пока нет. Добавь контакт в разделе «Контакты».':'Здесь пока ничего нет.';box.append(empty);return;}
  for(const room of entries){const b=document.createElement('button');b.type='button';const isContact=room.type==='contact';const selected=!isContact&&room.id===state.selectedRoomId;b.className='room-list-item'+(selected?' active':'');b.dataset.roomId=room.id;const icon=document.createElement('span');icon.className='room-kind-icon';icon.textContent=room.type==='channel'?'◉':room.type==='direct'?'●':room.type==='contact'?'♙':'◌';const copy=document.createElement('span');copy.className='room-list-copy';const name=document.createElement('strong');name.textContent=room.name;const meta=document.createElement('small');meta.textContent=room.type==='channel'?(room.username?`@${room.username} · Канал${room.ownerUsername?` · создатель @${room.ownerUsername}`:''}`:'Канал'):room.type==='direct'?'Личный чат':room.type==='contact'?'Контакт':(room.username?`@${room.username} · Группа`:'Группа');copy.append(name,meta);b.append(icon,copy);
    b.onclick=()=>{if(isContact)openDirectContact(room.contact);else switchRoom(room);};box.append(b);}
}
function renderFolderEditor(folderId=null){
  const old=state.folders.find(f=>f.id===folderId);$('folderDialogTitle').textContent=old?'Настроить папку':'Создать папку';$('folderNameInput').value=old?.name||'';const box=$('folderItems');box.replaceChildren();const checked=new Set(old?.items||[]);
  const sections=[{title:'Группы, каналы и личные чаты',items:state.rooms.map(r=>({key:`room:${r.id}`,name:r.name,desc:r.type==='channel'?'Канал':r.type==='direct'?'Личный чат':r.id==='global'?'Общая группа':'Группа'}))},{title:'Контакты',items:state.contacts.map(c=>({key:`contact:${c.peerId}`,name:c.name||'Контакт',desc:'Контакт'}))}];
  for(const section of sections){if(!section.items.length)continue;const heading=document.createElement('div');heading.className='folder-section-title';heading.textContent=section.title;box.append(heading);for(const item of section.items){const label=document.createElement('label');label.className='folder-item';const input=document.createElement('input');input.type='checkbox';input.value=item.key;input.checked=checked.has(item.key);const text=document.createElement('span');const name=document.createElement('strong');name.textContent=item.name;const desc=document.createElement('small');desc.textContent=item.desc;text.append(name,desc);label.append(input,text);box.append(label);}}
  $('saveChatFolderBtn').dataset.folderId=folderId||'';$('deleteChatFolderBtn').classList.toggle('hidden',!old);$('folderDialog').showModal();setTimeout(()=>$('folderNameInput').focus(),50);
}
function editChatFolder(id){const folder=state.folders.find(f=>f.id===id);if(folder)renderFolderEditor(id);}
function addChatFolder(){renderFolderEditor(null);}
function saveChatFolder(){const name=$('folderNameInput').value.trim().slice(0,30);if(!name){toast('Введи название папки');return;}const id=$('saveChatFolderBtn').dataset.folderId;const items=[...$('folderItems').querySelectorAll('input[type=checkbox]:checked')].map(x=>x.value);if(id){state.folders=state.folders.map(f=>f.id===id?{...f,name,items}:f);}else{if(state.folders.some(f=>f.name.toLocaleLowerCase('ru')===name.toLocaleLowerCase('ru'))){toast('Папка с таким названием уже есть');return;}state.folders.push({id:randomId(),name,items,createdAt:new Date().toISOString()});}setScoped('folders',state.folders);const latest=id?state.folders.find(f=>f.id===id):state.folders[state.folders.length-1];state.activeFolder=`custom:${latest.id}`;setScopedString('activeFolder',state.activeFolder);closeDialog('folderDialog');renderFolderTabs();renderRoomList();toast('Папка сохранена');}

async function switchRoom(room){if(!room)return;if(room.id===state.selectedRoomId){setPage('chat');return;}state.lastSyncAt=0;state.selectedRoomId=room.id;setScopedString('selectedRoom',room.id);const roomPrefs=getLocalChatPref(room.id);if($('keepHistoryToggle'))$('keepHistoryToggle').checked=roomPrefs.keepHistory!==false;if($('cacheMediaToggle'))$('cacheMediaToggle').checked=roomPrefs.cacheMedia===true;const all=await idb.all('messages');state.messages=all.filter(m=>!isLocallyHiddenMessage(m)&&(m.serverKey||currentServerKey())===currentServerKey()&&(m.roomId||'global')===room.id).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));msgMap.clear();for(const m of state.messages)msgMap.set(m.id,m);state.limit=PAGE;state.lastDay='';$('chatPage').querySelector('h1').textContent=room.name;$('chatPage').querySelector('.test-avatar').textContent=room.type==='channel'?'◉':room.type==='direct'?'●':'◌';renderRoomList();renderAll();if(room.type==='channel'&&!isRoomOwner(room)){$('messageInput').placeholder='Только владелец канала может публиковать';$('sendBtn').disabled=true;$('recordBtn').disabled=true;$('attachBtn').disabled=true;}else{$('messageInput').placeholder='Написать сообщение…';$('sendBtn').disabled=false;$('recordBtn').disabled=false;$('attachBtn').disabled=false;}if(state.serverUrl){state.pollBusy=false;pollMessages();}setPage('chat');}
let roomCreatorType = 'group';
let roomCreatorUsernameEdited = false;
function transliterateForUsername(value) {
  const map = { а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'e', ж:'zh', з:'z', и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', о:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ф:'f', х:'h', ц:'ts', ч:'ch', ш:'sh', щ:'sch', ы:'y', э:'e', ю:'yu', я:'ya', ъ:'', ь:'' };
  return [...String(value || '').toLowerCase()].map(ch => map[ch] ?? ch).join('').replace(/[^a-z0-9_]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
}
function suggestRoomUsername(name) {
  let base = transliterateForUsername(name).replace(/^[^a-z]+/, '');
  if (!base) base = 'pgmz_chat';
  if (!/^[a-z]/.test(base)) base = `chat_${base}`;
  if (base.length < 5) base = `${base}_chat`;
  return base.slice(0, 24);
}
function updateRoomCreatorPreview() {
  const name = $('roomCreateName').value.trim();
  const type = roomCreatorType;
  $('roomCreateTitle').textContent = type === 'channel' ? 'Создать канал' : 'Создать группу';
  $('roomCreateLead').textContent = type === 'channel' ? 'Публикуй новости и материалы для подписчиков.' : 'Собери участников в отдельном пространстве для общения.';
  $('roomCreateAvatar').textContent = type === 'channel' ? '◉' : '◌';
  $('roomCreateAvatar').classList.toggle('channel', type === 'channel');
  $('roomCreateTypeGroup').classList.toggle('active', type === 'group');
  $('roomCreateTypeChannel').classList.toggle('active', type === 'channel');
  $('roomCreateDescription').placeholder = type === 'channel' ? 'О чём этот канал? (необязательно)' : 'Для чего создана группа? (необязательно)';
  if (!roomCreatorUsernameEdited) $('roomCreateUsername').value = suggestRoomUsername(name);
  $('roomCreateUsernamePrefix').textContent = '@';
  $('roomUsernameExample').textContent = '@' + ($('roomCreateUsername').value || 'community');
}
function createRoom(type) {
  if (type === 'channel' && countOwnedChannels() >= MAX_OWNED_CHANNELS) {
    toast('Можно создать не больше 3 каналов от одного аккаунта.');
    return;
  }
  roomCreatorType = type === 'channel' ? 'channel' : 'group';
  roomCreatorUsernameEdited = false;
  $('roomCreateName').value = '';
  $('roomCreateUsername').value = '';
  $('roomCreateDescription').value = '';
  updateRoomCreatorPreview();
  $('roomCreateDialog').showModal();
  setTimeout(() => $('roomCreateName').focus(), 80);
}
async function createRoomFromDialog() {
  if (roomCreatorType === 'channel' && countOwnedChannels() >= MAX_OWNED_CHANNELS) {
    toast('Лимит достигнут: у одного аккаунта может быть не больше 3 каналов.');
    closeDialog('roomCreateDialog');
    return;
  }
  const name = $('roomCreateName').value.trim().slice(0, 64);
  const username = $('roomCreateUsername').value.trim().replace(/^@+/, '').toLowerCase();
  const description = $('roomCreateDescription').value.trim().slice(0, 280);
  if (name.length < 2) { toast('Название должно содержать хотя бы 2 символа'); $('roomCreateName').focus(); return; }
  if (!/^[a-z][a-z0-9_]{4,31}$/.test(username)) { toast('Username: 5–32 символа, латинские буквы, цифры и _, первый символ — буква'); $('roomCreateUsername').focus(); return; }
  const duplicate = state.rooms.some(r => ['group', 'channel'].includes(r.type) && r.username && String(r.username).toLowerCase() === username);
  if (duplicate) { toast('Такой username уже есть среди загруженных чатов'); $('roomCreateUsername').focus(); return; }
  const creatorId = state.accountId || state.clientId;
  let room = {
    id: randomId(), name, username, type: roomCreatorType,
    ownerId: creatorId,
    ...(roomCreatorType === 'channel' ? {
      ownerAccountId: state.accountId || '',
      ownerUsername: state.account?.username || state.profile.handle || '',
      ownerDeviceId: state.deviceId,
      userCreated: true
    } : {}),
    description, createdAt: new Date().toISOString()
  };
  // Room metadata stays local and is shared to invitees over the peer mesh, never stored on the server.
  closeDialog('roomCreateDialog');
  state.rooms = [room, ...state.rooms.filter(item => item.id !== room.id)];
  setScoped('rooms', state.rooms); state.activeFolder = 'all'; setScopedString('activeFolder', 'all');
  renderFolderTabs(); renderRoomList(); await switchRoom(room);
  toast(room.type === 'channel' ? `Канал создан · @${room.username}` : `Группа создана · @${room.username}`, 2600);
}
async function loadContacts(){state.contacts=getScoped('contacts',[]);setScoped('contacts',state.contacts);renderContacts();renderFolderTabs();renderRoomList();}
function renderContacts(){const box=$('contactList');if(!box)return;box.replaceChildren();const own=document.createElement('div');own.className='self-id-row';const label=document.createElement('span');label.textContent=state.account?'Твой ID аккаунта':'ID этого устройства (локальный режим)';const id=document.createElement('code');id.textContent=state.clientId;const copy=document.createElement('button');copy.type='button';copy.className='text-button';copy.textContent='Копировать';copy.onclick=()=>copyText(state.clientId);own.append(label,id,copy);box.append(own);
  for(const c of state.contacts){const b=document.createElement('button');b.type='button';b.className='contact-item';const a=document.createElement('span');a.className='contact-avatar';setAvatarElement(a,c.avatar,c.name);const text=document.createElement('span');text.className='contact-copy';const strong=document.createElement('strong');strong.textContent=c.name;const small=document.createElement('small');small.textContent=c.username?`@${c.username} · ${c.peerId}`:c.peerId;text.append(strong,small);b.append(a,text);b.onclick=()=>openDirectContact(c);box.append(b);}
  if(!state.contacts.length){const p=document.createElement('p');p.className='form-caption';p.textContent='Контактов пока нет. Для добавления человека открой профиль, войди в аккаунт и нажми «Добавить контакт».';box.append(p);}}
async function searchAccount(term){const username=String(term||'').trim().replace(/^@+/,'').toLowerCase();if(!/^[a-z0-9_]{3,32}$/.test(username))return [];if(state.testMode)return username==='demo_friend'?[{id:'sandbox-demo-friend',username:'demo_friend'}]:[];if(!state.serverUrl||!state.authToken)throw new Error('Для поиска username войди в аккаунт и подключи сервер');const response=await fetch(`${state.serverUrl}/api/users/search?q=${encodeURIComponent(username)}`,{headers:{Authorization:`Bearer ${state.authToken}`},cache:'no-store'});const data=await response.json().catch(()=>({}));if(!response.ok)throw new Error(data.message||data.error||`HTTP ${response.status}`);return Array.isArray(data.users)?data.users.filter(x=>String(x.username||'').toLowerCase()===username):[];}
async function addContact(){const raw=prompt('Введи точный username (например, alex_2026), можно с @:');if(!raw?.trim())return;let users=[];try{users=await searchAccount(raw.trim());}catch(e){toast(e.message,3200);if(!state.authToken&&!state.testMode)openProfile();return;}if(!users.length){toast('Пользователь с таким точным username не найден.',3200);return;}let user=users[0];if(users.length>1){const menu=users.map((x,i)=>`${i+1}. @${x.username} · ${x.id}`).join('\n');const answer=prompt(`Кого добавить? Введи номер:\n${menu}`,'1');if(answer===null)return;if(!/^\d+$/.test(answer.trim())||!users[Number(answer)-1]){toast('Неверный номер пользователя');return;}user=users[Number(answer)-1];}const name=user.username;const c={id:randomId(),ownerId:state.clientId,peerId:user.id,username:user.username,name,createdAt:new Date().toISOString()};state.contacts=[c,...state.contacts.filter(x=>x.peerId!==c.peerId)];setScoped('contacts',state.contacts);await openDirectContact(c);renderContacts();renderRoomList();}
async function openDirectContact(contact){const members=[state.clientId,contact.peerId].sort(),id=`dm-${members.join('-')}`;let room=state.rooms.find(r=>r.id===id);
  if(!room){room={id,name:contact.name||contact.username||'Личный чат',username:contact.username||'',type:'direct',ownerId:state.clientId,members,createdAt:new Date().toISOString()};state.rooms.push(room);setScoped('rooms',state.rooms);state.activeFolder='all';setScopedString('activeFolder','all');renderFolderTabs();renderRoomList();}
  if(room.id===state.selectedRoomId)setPage('chat');else await switchRoom(room);setPage('chat');if(state.authToken&&!state.testMode)void sendMeshInvite(contact.peerId,room);if(state.testMode){toast('Демо-чат локальный: ответы в нём имитируются только для проверки интерфейса.',3200);}else if(!state.onlinePeers.some(p=>p.accountId===contact.peerId)){toast('Чат создан локально. Собеседник появится в P2P-сети, когда откроет приложение и выполнит вход.',3500);}}

// ---------- WebRTC mesh transport; server is only account auth + transient signalling ----------
const MESH_CHUNK_BYTES = 16 * 1024;
const MESH_HEADER_BYTES = 55;
const MESH_MAX_PAYLOAD = 16 * 1024 * 1024;
const MESH_MAX_TRANSFERS_PER_PEER = 6;
const MESH_MAX_NEIGHBORS = 12;
const MESH_STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

function authHeaders(extra = {}) { return { 'X-Pgmz-Device-Code': state.deviceId, ...extra, ...(state.authToken ? { Authorization: `Bearer ${state.authToken}` } : {}) }; }
async function accountApi(path, options = {}) {
  if (!state.serverUrl) throw new Error('Сначала укажи адрес сервера в настройках');
  const headers = authHeaders({ Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) });
  const response = await fetch(`${state.serverUrl}${path}`, { cache: 'no-store', ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
  return data;
}
async function migrateLocalIdentity(oldId, newId, username) {
  if (!db) { try { db = await idb.open(); } catch { return; } }
  const all = await idb.all('messages');
  for (const m of all) {
    if (m.clientId === oldId || (m.mine === true && (!m.clientId || m.clientId === oldId))) {
      m.clientId = newId; m.username = m.mine ? (state.profile.name || username) : m.username;
      await idb.put('messages', m);
    }
  }
  const rooms = getScoped('rooms', []);
  let changed = false;
  for (const room of rooms) {
    if (room.type === 'channel' && room.ownerId === oldId) {
      if (!room.ownerAccountId && /^u_[a-f0-9]{32}$/i.test(String(oldId || ''))) {
        // Legacy channel created under an account: pin it to that original account, not the new login.
        room.ownerAccountId = oldId;
        room.ownerUsername ||= username || '';
        changed = true;
      } else if (!room.ownerAccountId) {
        // A local guest-created channel is claimed by the account it is first linked to.
        room.ownerId = newId; room.ownerAccountId = newId; room.ownerUsername = username || room.ownerUsername || '';
        changed = true;
      }
    } else if (room.type !== 'channel' && room.ownerId === oldId) {
      room.ownerId = newId; changed = true;
    }
    if (Array.isArray(room.members) && room.members.includes(oldId)) { room.members = [...new Set(room.members.map(id => id === oldId ? newId : id))]; changed = true; }
  }
  if (changed) { state.rooms = rooms; setScoped('rooms', rooms); }
  const contacts = getScoped('contacts', []);
  for (const item of contacts) if (item.ownerId === oldId) item.ownerId = newId;
  state.contacts = contacts; setScoped('contacts', contacts);
}
async function applyAccountSession(account, token, migrate = true) {
  const oldId = state.clientId;
  state.account = { id: account.id, username: account.username, createdAt: account.createdAt || '' };
  state.accountId = account.id; state.clientId = account.id; state.authToken = token || state.authToken;
  if (state.authToken) localStorage.setItem(STORE.authToken, state.authToken);
  localStorage.setItem(STORE.accountId, account.id); set(STORE.account, state.account);
  if (!state.testMode) localStorage.setItem(STORE.clientId, state.clientId); localStorage.setItem(STORE.deviceId, state.deviceId);
  if (!state.profile.handle || state.profile.handle === 'guest' || state.profile.handle === 'tester') state.profile.handle = account.username;
  set(STORE.profile, state.profile);
  if (migrate && oldId !== account.id) await migrateLocalIdentity(oldId, account.id, account.username);
  renderProfile(); renderContacts();
}
async function restoreAccountSession() {
  if (!state.accountId) return;
  state.clientId = state.accountId;
  if (!state.authToken || !state.serverUrl) { state.account ||= { id: state.accountId, username: state.profile.handle || 'unknown' }; return; }
  try {
    const data = await accountApi('/api/auth/me', { headers: { Authorization: `Bearer ${state.authToken}` } });
    const old = state.clientId; await applyAccountSession(data.account, state.authToken, false);
  } catch (error) {
    if (/authentication_required|HTTP 401/.test(error.message)) { localStorage.removeItem(STORE.authToken); state.authToken = ''; }
    // Network failure leaves the account ID and local data usable; presence stays offline.
  }
}
async function submitAccountAuth(mode) {
  const username = $('accountUsernameInput').value.trim().replace(/^@+/, '').toLowerCase();
  const password = $('accountPasswordInput').value;
  if (!state.serverUrl) { toast('Сначала сохрани адрес сервера в настройках', 3200); openSettings('server'); return; }
  if (!username || !password) { toast('Введи username и пароль'); return; }
  if (mode === 'register' && password.length < 10) { toast('Для нового аккаунта нужен пароль не короче 10 символов'); return; }
  const button = $(mode === 'register' ? 'registerAccountBtn' : 'loginAccountBtn');
  if (button) button.disabled = true;
  try {
    const data = await accountApi(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ username, password, deviceCode: state.deviceId, deviceLabel: navigator.userAgent }) });
    await applyAccountSession(data.account, data.token, true);
    state.testMode = false;
    localStorage.removeItem('pgmz.auth.testMode');
    $('accountPasswordInput').value = '';
    $('accountUsernameInput').value = data.account.username;
    state.profile.handle = data.account.username; if (mode === 'register' && (!state.profile.name || state.profile.name === 'Гость')) state.profile.name = data.account.username; set(STORE.profile, state.profile); renderProfile();
    closeDialog('profileDialog');
    await loadRooms(); await loadContacts(); restartPolling(); startCallPolling();
    toast(mode === 'register' ? 'Аккаунт создан. Настрой имя и фото профиля.' : 'Вход выполнен. Подключаю P2P-участников…', 3200);
    if (mode === 'register') openProfile();
  } catch (error) { toast(`Не удалось ${mode === 'register' ? 'создать аккаунт' : 'войти'}: ${error.message}`, 4200); }
  finally { if (button) button.disabled = false; renderProfile(); }
}
function setAuthGateStatus(message, error = false) {
  const node = $('authGateStatus');
  if (!node) return;
  node.textContent = message;
  node.classList.toggle('is-error', !!error);
  node.classList.toggle('is-success', !error && !!message);
}
function showAuthGate() {
  const gate = $('authGate');
  if (!gate) return;
  if ($('authGateServer') && !$('authGateServer').value) $('authGateServer').value = state.serverUrl || '';
  gate.classList.remove('hidden');
  document.body.classList.add('auth-gate-open');
}
function dismissAuthGate() {
  $('authGate')?.classList.add('hidden');
  document.body.classList.remove('auth-gate-open');
}
async function setServerFromAuthGate() {
  const url = normalizeServerUrl($('authGateServer')?.value || state.serverUrl);
  if (url !== state.serverUrl) await changeServerContext(url);
  else {
    state.serverUrl = url;
    localStorage.setItem(STORE.server, url);
    if ($('serverUrlInput')) $('serverUrlInput').value = url;
    rememberServer(url);
  }
  return url;
}
async function submitAuthGate(mode) {
  const username = $('authGateUsername').value.trim().replace(/^@+/, '').toLowerCase();
  const password = $('authGatePassword').value;
  let button = $(mode === 'register' ? 'authGateRegisterBtn' : 'authGateLoginBtn');
  try {
    await setServerFromAuthGate();
    if (!username || !password) throw new Error('Введи username и пароль.');
    if (mode === 'register' && !/^[a-z][a-z0-9_]{4,31}$/.test(username)) throw new Error('Username: 5–32 символа, латинские буквы, цифры и _, первая буква — латинская.');
    if (mode === 'register' && password.length < 10) throw new Error('Пароль для нового аккаунта должен быть не короче 10 символов.');
    if (button) button.disabled = true;
    setAuthGateStatus(mode === 'register' ? 'Создаю аккаунт на сервере…' : 'Проверяю данные…');
    const data = await accountApi(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify({ username, password, deviceCode: state.deviceId, deviceLabel: navigator.userAgent }) });
    await applyAccountSession(data.account, data.token, true);
    state.testMode = false;
    localStorage.removeItem('pgmz.auth.testMode');
    $('authGatePassword').value = '';
    $('accountPasswordInput').value = '';
    $('accountUsernameInput').value = data.account.username;
    state.profile.handle = data.account.username; if (mode === 'register' && (!state.profile.name || state.profile.name === 'Гость')) state.profile.name = data.account.username;
    set(STORE.profile, state.profile);
    renderProfile();
    dismissAuthGate();
    await loadRooms(); await loadContacts(); restartPolling(); startCallPolling();
    setAuthGateStatus('');
    toast(mode === 'register' ? 'Аккаунт создан. Настрой имя и фото профиля.' : 'Вход выполнен. Подключаю P2P-участников…', 3200);
    if (mode === 'register') openProfile();
  } catch (error) {
    setAuthGateStatus(error.message || 'Не удалось выполнить вход.', true);
  } finally { if (button) button.disabled = false; }
}
function sandboxDefaultRooms() {
  return [
    { id: 'global', name: 'Демо-группа', type: 'group', ownerId: state.clientId, members: [state.clientId, 'sandbox-demo-friend'], description: 'Локальная тестовая группа', createdAt: new Date().toISOString() },
    { id: 'sandbox-channel-news', name: 'Объявления PgmzChat', username: 'pgmz_updates', type: 'channel', ownerId: state.clientId, members: [], description: 'Демо-канал для проверки поиска и публикаций', createdAt: new Date().toISOString() }
  ];
}
function sandboxDefaultContacts() {
  return [{ id: 'sandbox-contact-demo-friend', ownerId: state.clientId, peerId: 'sandbox-demo-friend', username: 'demo_friend', name: 'Демо-собеседник', avatar: '', createdAt: new Date().toISOString() }];
}
async function ensureSandboxData() {
  if (!SANDBOX_AVAILABLE || !isSandboxActive()) return;
  state.testMode = true; state.serverUrl = ''; state.authToken = ''; state.accountId = ''; state.account = null;
  state.clientId = localStorage.getItem('pgmz.sandbox.clientId') || `sandbox_${randomId()}`;
  localStorage.setItem('pgmz.sandbox.clientId', state.clientId);
  state.profile = get(`${STORE.profile}.sandbox`, { name: 'Тестовый пользователь', handle: 'tester', avatar: '' });
  state.rooms = getScoped('rooms', sandboxDefaultRooms());
  if (!state.rooms.some(r => r.id === 'global')) state.rooms.unshift(sandboxDefaultRooms()[0]);
  if (!state.rooms.some(r => r.type === 'channel')) state.rooms.push(sandboxDefaultRooms()[1]);
  state.rooms = state.rooms.map(r => r.type === 'group' && r.id === 'global' ? { ...r, ownerId: state.clientId, name: r.name || 'Демо-группа' } : r);
  setScoped('rooms', state.rooms);
  state.contacts = getScoped('contacts', sandboxDefaultContacts());
  if (!state.contacts.some(c => c.username === 'demo_friend')) state.contacts.push(sandboxDefaultContacts()[0]);
  state.contacts = state.contacts.map(c => c.peerId === 'sandbox-demo-friend' ? { ...c, name: c.name || 'Демо-собеседник', username: 'demo_friend' } : c);
  setScoped('contacts', state.contacts);
  state.folders = getScoped('folders', []);
  state.selectedRoomId = getScopedString('selectedRoom', 'global');
  if (!state.rooms.some(r => r.id === state.selectedRoomId)) state.selectedRoomId = 'global';
  setScopedString('selectedRoom', state.selectedRoomId);
  const all = await idb.all('messages');
  const hasIntro = all.some(m => m.serverKey === '__sandbox__' && (m.roomId || 'global') === 'global');
  if (!hasIntro) {
    const now = Date.now();
    const intro = [
      { id: 'sandbox-intro-1', serverKey: '__sandbox__', roomId: 'global', clientId: 'sandbox-system', username: 'PgmzChat · песочница', text: 'Это локальная песочница. Сообщения, медиа и чаты не отправляются на сервер.', createdAt: new Date(now - 120000).toISOString(), mine: false, system: true, delivery: 'received', type: 'text', avatar: '' },
      { id: 'sandbox-intro-2', serverKey: '__sandbox__', roomId: 'global', clientId: 'sandbox-demo-friend', username: 'Демо-собеседник', text: 'Напиши что-нибудь — я отвечу автоматически, чтобы можно было проверить интерфейс сообщений.', createdAt: new Date(now - 60000).toISOString(), mine: false, delivery: 'received', type: 'text', avatar: '' }
    ];
    for (const m of intro) await idb.put('messages', m);
  }
  const sandboxMessages = (await idb.all('messages')).filter(m => (m.serverKey || '') === '__sandbox__' && !isLocallyHiddenMessage(m));
  state.messages = sandboxMessages.filter(m => (m.roomId || 'global') === state.selectedRoomId).sort((a,b) => Date.parse(a.createdAt)-Date.parse(b.createdAt));
  msgMap.clear(); for (const m of state.messages) msgMap.set(m.id, m);
  state.limit = PAGE; state.lastDay = '';
  document.body.classList.add('sandbox-mode');
  if ($('authGateServer')) $('authGateServer').value = '';
  if ($('serverUrlInput')) $('serverUrlInput').value = '';
  setServerStatus('Локальная песочница');
  renderProfile(); renderFolderTabs(); renderRoomList(); renderContacts(); renderAll();
  $('chatPage').querySelector('h1').textContent = activeRoom().name || 'Демо-группа';
  $('chatStatusText').textContent = 'Локальная песочница · без сети';
  setPage('chat');
}
async function enterTestMode() {
  if (!SANDBOX_AVAILABLE) { toast('Песочница доступна только в debug-сборке Android.'); return; }
  const button = $('authGateTestBtn'); if (button) button.disabled = true;
  try {
    localStorage.setItem(SANDBOX_FLAG, '1');
    state.testMode = true;
    await ensureSandboxData();
    dismissAuthGate();
    toast('Открыта локальная песочница. Ответы собеседника демонстрационные; сеть не используется.', 3800);
  } catch (error) {
    localStorage.removeItem(SANDBOX_FLAG); state.testMode = false;
    setAuthGateStatus(error.message || 'Не удалось открыть локальную песочницу.', true);
  } finally { if (button) button.disabled = false; }
}
function scheduleSandboxReply(sent) {
  if (!state.testMode || !sent || activeRoom().type === 'channel') return;
  const roomId = sent.roomId || 'global';
  const replies = sent.type === 'image' ? ['Фото отображается в локальном демо-чате.','Изображение обработано песочницей.'] : sent.type === 'voice' ? ['Голосовое сообщение добавлено локально.','Проверка голосового вложения в песочнице завершена.'] : sent.type === 'circle' ? ['Видеокружок добавлен локально.','Песочница получила демо-вложение.'] : ['Сообщение принято локальным собеседником.','Проверка пузыря, времени и статуса прошла.','Всё работает в демо-режиме — это не реальная доставка.'];
  window.setTimeout(async () => {
    if (!isSandboxActive()) return;
    const reply = { id: randomId(), serverKey: '__sandbox__', roomId, clientId: 'sandbox-demo-friend', username: roomId === 'global' ? 'Демо-собеседник' : 'Локальный собеседник', avatar: '', text: replies[Math.floor(Math.random()*replies.length)], createdAt: new Date().toISOString(), mine: false, delivery: 'received', type: 'text', simulated: true };
    await idb.put('messages', reply);
    if (state.testMode && state.selectedRoomId === roomId) { state.messages.push(reply); msgMap.set(reply.id, reply); appendRow(reply, true); toBottom(); }
  }, 650);
}

async function refreshActiveSessions() {
  const box = $('activeSessionsList'); if (!box) return;
  if (!state.authToken || !state.serverUrl) { box.textContent = 'Войди в аккаунт и подключи сервер.'; return; }
  box.replaceChildren(); const loading = document.createElement('p'); loading.className = 'form-caption'; loading.textContent = 'Загружаю сессии…'; box.append(loading);
  try {
    const data = await accountApi('/api/auth/sessions'); box.replaceChildren();
    if (!Array.isArray(data.sessions) || !data.sessions.length) { box.textContent = 'Активных сессий нет.'; return; }
    for (const item of data.sessions) {
      const row = document.createElement('div'); row.className = 'active-session-row';
      const copy = document.createElement('div'); copy.className = 'active-session-copy';
      const title = document.createElement('strong'); title.textContent = item.deviceLabel || 'Устройство';
      const detail = document.createElement('small');
      const date = value => { const n = Date.parse(value || ''); return Number.isFinite(n) ? new Date(n).toLocaleString() : 'неизвестно'; };
      detail.textContent = `${item.current ? 'Это устройство · текущая сессия' : 'Другое устройство'} · вход: ${date(item.createdAt)} · активность: ${date(item.lastSeen)}`;
      copy.append(title, detail); row.append(copy);
      if (!item.current) { const revoke = document.createElement('button'); revoke.type = 'button'; revoke.className = 'danger-button'; revoke.textContent = 'Завершить'; revoke.onclick = async () => { revoke.disabled = true; try { await accountApi(`/api/auth/sessions/${encodeURIComponent(item.id)}`, { method: 'DELETE' }); toast('Сессия завершена'); await refreshActiveSessions(); } catch (error) { toast(`Не удалось завершить сессию: ${error.message}`, 3500); revoke.disabled = false; } }; row.append(revoke); }
      box.append(row);
    }
  } catch (error) { box.replaceChildren(); const p = document.createElement('p'); p.className = 'form-caption is-error'; p.textContent = `Не удалось загрузить сессии: ${error.message}`; box.append(p); }
}

async function logoutAccount() {
  try { if (state.authToken && state.serverUrl) await accountApi('/api/auth/logout', { method: 'POST', body: '{}' }); } catch {}
  stopMesh(); state.authToken = ''; state.accountId = ''; state.account = null; state.clientId = state.deviceId;
  localStorage.removeItem(STORE.authToken); localStorage.removeItem(STORE.accountId); localStorage.removeItem(STORE.account);
  localStorage.setItem(STORE.clientId, state.clientId); state.profile.handle = 'guest'; set(STORE.profile, state.profile);
  state.testMode = false; localStorage.removeItem('pgmz.auth.testMode');
  renderProfile(); renderContacts(); restartPolling(); showAuthGate(); setAuthGateStatus('Выход выполнен. Локальная история сохранена.'); toast('Вышел из аккаунта. Локальная история сохранена.');
}
function sharedRoomForPeer(peer) {
  const localIds = new Set(state.rooms.map(room => room.id));
  return (peer.roomIds || []).find(id => localIds.has(id)) || '';
}
function roomIdsForPresence() {
  const ids = new Set(['global']);
  for (const room of state.rooms) if (room?.id) ids.add(String(room.id));
  return [...ids].slice(0, 200);
}
function signalDeviceHeaders() { return authHeaders({ 'Content-Type': 'application/json', Accept: 'application/json' }); }
async function sendMeshSignal(deviceId, signal) {
  if (!state.serverUrl || !state.authToken) throw new Error('Нужен вход в аккаунт для P2P-сигнализации');
  const response = await fetch(`${state.serverUrl}/api/mesh/signals`, { method: 'POST', headers: signalDeviceHeaders(), body: JSON.stringify({ fromId: state.deviceId, toId: deviceId, callId: 'mesh', signal }) });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  return payload;
}
function rememberMeshEvent(id) {
  if (!id || state.meshSeenEvents.has(id)) return false;
  state.meshSeenEvents.add(id);
  if (state.meshSeenEvents.size > 12_000) state.meshSeenEvents = new Set([...state.meshSeenEvents].slice(-8_000));
  return true;
}
function meshDevicePeer(deviceId) { return state.meshPeers.get(deviceId); }
function registerMeshPeer(info) {
  let peer = state.meshPeers.get(info.deviceId);
  if (!peer) { peer = { deviceId: info.deviceId, accountId: info.accountId, username: info.username || 'Пользователь', roomIds: new Set(info.roomIds || []), pc: null, dc: null, pendingCandidates: [], rxTransfers: new Map(), receiveChain: Promise.resolve(), initiator: false, connected: false }; state.meshPeers.set(info.deviceId, peer); }
  peer.accountId = info.accountId || peer.accountId; peer.username = info.username || peer.username;
  peer.roomIds = new Set(info.roomIds || [...peer.roomIds]);
  return peer;
}
function selectMeshNeighbors(peers) {
  const all = [...new Map([...peers, { deviceId: state.deviceId, accountId: state.clientId, username: state.account?.username || state.profile.handle, roomIds: roomIdsForPresence() }].map(p => [p.deviceId, p])).values()].sort((a,b)=>a.deviceId.localeCompare(b.deviceId));
  const me = all.findIndex(p => p.deviceId === state.deviceId); if (me < 0 || all.length <= MESH_MAX_NEIGHBORS + 1) return peers;
  const keep = new Set(); const eachSide = Math.floor(MESH_MAX_NEIGHBORS / 2);
  for (let offset=1; offset<=eachSide; offset++) { keep.add(all[(me+offset)%all.length].deviceId); keep.add(all[(me-offset+all.length)%all.length].deviceId); }
  return peers.filter(p => keep.has(p.deviceId));
}
async function announcePresence() {
  if (state.meshBusy || !state.serverUrl || !state.authToken || !state.accountId) return;
  state.meshBusy = true;
  try {
    const data = await accountApi('/api/presence', { method: 'POST', body: JSON.stringify({ deviceId: state.deviceId, roomIds: roomIdsForPresence() }) });
    state.onlinePeers = Array.isArray(data.peers) ? data.peers : [];
    const neighbors = selectMeshNeighbors(state.onlinePeers);
    const wanted = new Set(neighbors.map(peer=>peer.deviceId));
    for (const peerInfo of neighbors) {
      const peer = registerMeshPeer(peerInfo);
      if (peer.dc?.readyState==='open') void replayMessageOutbox(peer);
      if (!peer.pc && state.deviceId.localeCompare(peer.deviceId) < 0) void createMeshConnection(peer, true).catch(error=>console.debug('mesh offer failed', error));
    }
    for (const [deviceId, peer] of state.meshPeers) {
      if (!wanted.has(deviceId) && !peer.connected) { try { peer.pc?.close(); } catch {} state.meshPeers.delete(deviceId); }
    }
    updateMeshUi();
  } catch (error) {
    if (/authentication_required|HTTP 401/.test(error.message)) { state.authToken = ''; localStorage.removeItem(STORE.authToken); renderProfile(); }
    console.debug('P2P presence unavailable', error.message);
  } finally { state.meshBusy = false; }
}
function updateMeshUi() {
  const count = [...state.meshPeers.values()].filter(p=>p.dc?.readyState==='open').length;
  const text = $('sideStatusText');
  if (text) text.textContent = !state.account ? 'Локальный режим' : !state.authToken ? 'Войдите для P2P' : `${count} P2P-соединений`;
  const status = $('chatStatusText');
  if (status) status.textContent = !state.account ? 'Сообщения хранятся локально' : count ? `P2P · ${count} подключено` : 'Ожидаем участников P2P';
}
async function startMesh() {
  if (!state.serverUrl || !state.authToken || !state.accountId) { updateMeshUi(); return; }
  clearInterval(state.meshTimer); state.meshTimer = null;
  await announcePresence();
  state.meshTimer = setInterval(() => { if (state.authToken) void announcePresence(); }, 7000);
  startCallPolling();
}
function stopMesh() {
  clearInterval(state.meshTimer); state.meshTimer = null; state.onlinePeers = [];
  for (const peer of state.meshPeers.values()) { try { peer.dc?.close(); peer.pc?.close(); } catch {} }
  state.meshPeers.clear(); updateMeshUi();
}
function makeMeshPc(peer, initiator) {
  const pc = new RTCPeerConnection({ iceServers: MESH_STUN }); peer.pc = pc; peer.initiator = initiator; peer.pendingCandidates ||= [];
  pc.onicecandidate = event => { if (event.candidate) sendMeshSignal(peer.deviceId, { type: 'mesh-candidate', candidate: event.candidate.toJSON(), roomId: peer.handshakeRoom || sharedRoomForPeer({roomIds:[...peer.roomIds]}) || 'global' }).catch(()=>{}); };
  pc.onconnectionstatechange = () => { peer.connected = pc.connectionState === 'connected'; if (['failed','closed'].includes(pc.connectionState)) { peer.connected=false; try { peer.dc?.close(); } catch {} peer.dc=null; if (peer.pc===pc) peer.pc=null; } updateMeshUi(); };
  pc.ondatachannel = event => bindMeshChannel(peer, event.channel);
  if (initiator) bindMeshChannel(peer, pc.createDataChannel('pgmzchat-v1', { ordered: true }));
  return pc;
}
async function createMeshConnection(peer, initiator) {
  if (peer.pc) return peer;
  const pc = makeMeshPc(peer, initiator);
  if (initiator) {
    const roomId = sharedRoomForPeer({ roomIds: [...peer.roomIds] }) || 'global';
    await pc.setLocalDescription(await pc.createOffer());
    await sendMeshSignal(peer.deviceId, { type: 'mesh-offer', description: pc.localDescription.toJSON(), roomId });
  }
  return peer;
}
async function handleMeshSignal(signal, payload) {
  const deviceId = String(signal?.fromId || '');
  const accountId = String(signal?.fromAccountId || '');
  const roomId = String(payload?.roomId || 'global');
  if (!deviceId || deviceId === state.deviceId || !accountId) return;
  const knownPeer = state.meshPeers.get(deviceId);
  const peer = registerMeshPeer({ deviceId, accountId, username: signal.username || knownPeer?.username || accountId, roomIds: [...new Set([...(knownPeer?.roomIds || []), roomId])] });
  peer.handshakeRoom = roomId;
  try {
    if (payload.type === 'mesh-offer') {
      // Deterministic tie-break: the lexically lower device ID is the offerer.
      // Ignore glare from an unexpected offer; the lower-ID side will initiate.
      if (state.deviceId.localeCompare(deviceId) < 0) return;
      if (peer.pc && peer.pc.signalingState !== 'stable') {
        try { peer.pc.close(); } catch {}
        peer.pc = null; peer.dc = null; peer.connected = false;
      }
      if (!peer.pc) makeMeshPc(peer, false);
      await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.description));
      for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      await sendMeshSignal(deviceId, { type: 'mesh-answer', description: peer.pc.localDescription.toJSON(), roomId });
      return;
    }
    if (payload.type === 'mesh-answer') {
      if (!peer.pc || peer.pc.signalingState !== 'have-local-offer') return;
      await peer.pc.setRemoteDescription(new RTCSessionDescription(payload.description));
      for (const candidate of peer.pendingCandidates.splice(0)) await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
      return;
    }
    if (payload.type === 'mesh-candidate' && payload.candidate) {
      if (peer.pc?.remoteDescription) await peer.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
      else if (peer.pendingCandidates.length < 256) peer.pendingCandidates.push(payload.candidate);
    }
  } catch (error) {
    console.debug('mesh negotiation failed', error);
    try { peer.dc?.close(); peer.pc?.close(); } catch {}
    peer.dc = null; peer.pc = null; peer.connected = false; updateMeshUi();
  }
}
function bindMeshChannel(peer, channel) {
  peer.dc = channel; channel.binaryType = 'arraybuffer'; channel.bufferedAmountLowThreshold = 256 * 1024;
  channel.onopen = () => { peer.connected=true; updateMeshUi(); for (const roomId of peer.roomIds) void sendMeshInventory(peer, roomId); void replayMessageOutbox(peer); void replayMeshOutbox(peer); };
  channel.onclose = () => { peer.connected=false; updateMeshUi(); };
  channel.onerror = () => { peer.connected=false; updateMeshUi(); };
  channel.onmessage = event => { peer.receiveChain = peer.receiveChain.then(async()=>{ const envelope=await decodeMeshData(peer,event.data); if(envelope) await handleMeshEnvelope(peer,envelope); }).catch(error=>console.debug('mesh packet error',error)); };
}
function dataToBytes(value) { return new TextEncoder().encode(JSON.stringify(value)); }
async function sendPeerEnvelope(peer, envelope) {
  const dc=peer?.dc;if(!dc||dc.readyState!=='open')return false;
  const bytes=dataToBytes(envelope);if(bytes.byteLength>MESH_MAX_PAYLOAD)throw new Error('Сообщение превышает P2P-лимит 16 МиБ');
  const transferId=(globalThis.crypto?.randomUUID?.()||randomId()).replace(/[^A-Za-z0-9-]/g,'').padEnd(36,'0').slice(0,36);
  const chunks=Math.ceil(bytes.length/MESH_CHUNK_BYTES);
  for(let index=0;index<chunks;index++){
    if(dc.readyState!=='open')return false;
    let guard=0;while(dc.bufferedAmount>768*1024&&guard++<400){await meshSleep(20);if(dc.readyState!=='open')return false;}
    if(guard>=400)throw new Error('P2P-канал перегружен');
    const header=`PZ1|${transferId}|${String(index).padStart(6,'0')}|${String(chunks).padStart(6,'0')}|`;
    const frame=new Uint8Array(MESH_HEADER_BYTES+Math.min(MESH_CHUNK_BYTES,bytes.length-index*MESH_CHUNK_BYTES));
    frame.set(new TextEncoder().encode(header),0);frame.set(bytes.subarray(index*MESH_CHUNK_BYTES,Math.min(bytes.length,(index+1)*MESH_CHUNK_BYTES)),MESH_HEADER_BYTES);dc.send(frame.buffer);
  }
  return true;
}
async function decodeMeshData(peer, raw) {
  if(typeof raw==='string') { if(raw.length>MESH_MAX_PAYLOAD)return null;try{return JSON.parse(raw);}catch{return null;} }
  let bytes;
  if(raw instanceof ArrayBuffer)bytes=new Uint8Array(raw);else if(raw instanceof Blob)bytes=new Uint8Array(await raw.arrayBuffer());else return null;
  if(bytes.length<MESH_HEADER_BYTES)return null;
  const header=new TextDecoder().decode(bytes.subarray(0,MESH_HEADER_BYTES));
  const match=header.match(/^PZ1\|([A-Za-z0-9-]{36})\|(\d{6})\|(\d{6})\|$/);if(!match)return null;
  const [,id,indexText,countText]=match,index=Number(indexText),count=Number(countText);
  if(!Number.isSafeInteger(count)||count<1||count>1100||index<0||index>=count)return null;
  let transfer=peer.rxTransfers.get(id);
  if(!transfer){if(peer.rxTransfers.size>=MESH_MAX_TRANSFERS_PER_PEER)return null;transfer={count,chunks:new Array(count),received:0,bytes:0,createdAt:Date.now()};peer.rxTransfers.set(id,transfer);}
  if(transfer.count!==count||transfer.chunks[index])return null;
  const payload=bytes.slice(MESH_HEADER_BYTES);transfer.chunks[index]=payload;transfer.received++;transfer.bytes+=payload.length;
  if(transfer.bytes>MESH_MAX_PAYLOAD){peer.rxTransfers.delete(id);return null;}
  if(transfer.received!==count)return null;
  peer.rxTransfers.delete(id);
  const joined=new Uint8Array(transfer.bytes);let offset=0;for(const chunk of transfer.chunks){joined.set(chunk,offset);offset+=chunk.length;}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(joined));}catch{return null;}
}
function validPeerMessage(m, roomId) { return !!m&&typeof m.id==='string'&&m.id.length<=200&&(m.roomId||'global')===roomId&&String(m.text||'').length<=8000&&(!m.mediaData||m.mediaData.length<=12_000_000)&&(!m.imageData||m.imageData.length<=12_000_000)&&(!m.avatar||(typeof m.avatar==='string'&&m.avatar.startsWith('data:image/')&&m.avatar.length<=180_000))&&(!m.posterData||(typeof m.posterData==='string'&&m.posterData.startsWith('data:image/')&&m.posterData.length<=180_000)); }
function peerMessagePayload(m, roomId=m.roomId||'global') {
  const payload={id:String(m.id),roomId,clientId:String(m.clientId||state.clientId),username:String(m.username||state.profile.name||'Пользователь').slice(0,60),avatar:typeof m.avatar==='string'&&m.avatar.startsWith('data:image/')&&m.avatar.length<=180_000?m.avatar:'',text:String(m.text||'').slice(0,8000),type:['text','image','sticker','voice','circle','video','file'].includes(m.type)?m.type:'text',mediaMime:String(m.mediaMime||''),duration:cleanDuration(m.duration,m.type),waveform:Array.isArray(m.waveform)?m.waveform.slice(0,64):[],createdAt:m.createdAt||new Date().toISOString(),updatedAt:m.updatedAt||m.createdAt||new Date().toISOString(),replyTo:m.replyTo||null,forwarded:!!m.forwarded,forwardedFrom:String(m.forwardedFrom||''),reactions:m.reactions&&typeof m.reactions==='object'?m.reactions:{},pinned:!!m.pinned,pinnedBy:String(m.pinnedBy||''),pinnedAt:m.pinnedAt||null,readBy:Array.isArray(m.readBy)?m.readBy:[],edited:!!m.edited};
  if(m.mediaData&&m.mediaData.length<=12_000_000)payload.mediaData=m.mediaData;
  if(m.imageData&&m.imageData.length<=12_000_000)payload.imageData=m.imageData;
  if(m.posterData&&typeof m.posterData==='string'&&m.posterData.startsWith('data:image/')&&m.posterData.length<=180_000)payload.posterData=m.posterData;
  return payload;
}
async function messagesForRoom(roomId) {
  const all=await idb.all('messages');const byId=new Map(all.filter(m=>(m.roomId||'global')===roomId&&(m.serverKey||currentServerKey())===currentServerKey()).map(m=>[m.id,m]));
  for(const m of state.messages)if((m.roomId||'global')===roomId)byId.set(m.id,m);
  for(const queued of await idb.all('outbox'))if(queued.roomId===roomId&&queued.payload?.id)byId.set(queued.payload.id,{...queued.payload,roomId,serverKey:'__p2p__'});
  return [...byId.values()].sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
}
async function sendMeshInventory(peer, roomId) {
  if(!peer?.dc||peer.dc.readyState!=='open')return;
  const messages=(await messagesForRoom(roomId)).slice(-800);
  const ids=new Set(messages.map(m=>m.id));
  for(const key of hiddenLocalMessageSet()){const index=key.lastIndexOf('::');if(index>=0)ids.add(key.slice(index+2));}
  await sendPeerEnvelope(peer,{v:1,type:'mesh-inventory',eventId:randomId(),roomId,fromDeviceId:state.deviceId,fromAccountId:state.clientId,data:{ids:[...ids].slice(-1200)}}).catch(()=>{});
}
async function replayMeshOutbox(peer) {
  if(!peer?.dc||peer.dc.readyState!=='open')return;
  const all=await idb.all('events');for(const event of all.filter(e=>peer.roomIds.has(e.roomId)&&Date.now()-Date.parse(e.createdAt||0)<30*24*60*60*1000).slice(-300)){
    await sendPeerEnvelope(peer,{...event,fromDeviceId:state.deviceId,fromAccountId:state.clientId,hops:4}).catch(()=>{});
  }
}
async function replayMessageOutbox(peer) {
  if (!peer?.dc || peer.dc.readyState !== 'open') return;
  const now=Date.now();
  const queue = (await idb.all('outbox')).filter(item => peer.roomIds.has(item.roomId) && (!item.lastAttemptAt || now-Number(item.lastAttemptAt)>45_000)).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt)).slice(0,100);
  for (const item of queue) {
    if (peer.dc.readyState !== 'open') break;
    const envelope={v:1,type:'message',eventId:item.id,roomId:item.roomId,fromDeviceId:state.deviceId,fromAccountId:state.clientId,hops:8,createdAt:item.createdAt||new Date().toISOString(),data:item.payload};
    const sent=await sendPeerEnvelope(peer,envelope).catch(()=>false);
    if (sent) { item.lastAttemptAt=Date.now(); item.attempts=(Number(item.attempts)||0)+1; await idb.put('outbox',item); updateMessageStatus(item.id,'sending'); }
  }
}
async function saveMeshOutbox(envelope) {
  if(['message','mesh-inventory','mesh-request','mesh-ack'].includes(envelope.type))return;
  await idb.put('events',{id:envelope.eventId, eventId:envelope.eventId, type:envelope.type, roomId:envelope.roomId, data:envelope.data, hops:envelope.hops, createdAt:envelope.createdAt || new Date().toISOString(), serverKey:currentServerKey()});
  const events=(await idb.all('events')).filter(e=>(e.serverKey||currentServerKey())===currentServerKey()).sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
  for(const e of events.slice(0,Math.max(0,events.length-5000)))await idb.del('events',e.id);
}
async function broadcastMeshEvent(roomId, type, data, options={}) {
  if(!state.authToken||!state.accountId||!state.serverUrl)return 0;
  const eventId=options.eventId||((type==='message'&&data?.id)?String(data.id):randomId());
  const envelope={v:1,type,eventId,roomId:roomId||'global',fromDeviceId:state.deviceId,fromAccountId:state.clientId,hops:Number.isFinite(options.hops)?options.hops:5,createdAt:new Date().toISOString(),data};
  rememberMeshEvent(eventId);await saveMeshOutbox(envelope);
  let sent=0;
  for(const peer of state.meshPeers.values()){
    if(peer.dc?.readyState!=='open'||!peer.roomIds.has(envelope.roomId))continue;
    if(await sendPeerEnvelope(peer,envelope).catch(()=>false))sent++;
  }
  return sent;
}
async function relayMeshEnvelope(envelope, excludeDeviceId) {
  if((Number(envelope.hops)||0)<=0)return;
  const forwarded={...envelope,hops:(Number(envelope.hops)||0)-1};
  for(const peer of state.meshPeers.values()){
    if(peer.deviceId===excludeDeviceId||peer.dc?.readyState!=='open'||!peer.roomIds.has(envelope.roomId))continue;
    await sendPeerEnvelope(peer,forwarded).catch(()=>{});
  }
}
function syncContactProfileFromPeer(peer, incoming, roomId) {
  const peerId = String(incoming.clientId || peer?.accountId || '');
  if (!peerId || peerId === state.clientId) return;
  let changed = false;
  state.contacts = state.contacts.map(contact => {
    if (String(contact.peerId || '') !== peerId) return contact;
    const next = { ...contact };
    if (incoming.username && incoming.username !== next.name) { next.name = incoming.username; changed = true; }
    if (!next.username && peer?.username) { next.username = peer.username; changed = true; }
    if (incoming.avatar && incoming.avatar !== next.avatar) { next.avatar = incoming.avatar; changed = true; }
    return next;
  });
  if (changed) { setScoped('contacts', state.contacts); renderContacts(); }
  const direct = state.rooms.find(room => room.id === roomId && room.type === 'direct');
  if (direct) {
    let roomChanged = false;
    if (incoming.username && direct.name !== incoming.username) { direct.name = incoming.username; roomChanged = true; }
    if (!direct.username && peer?.username) { direct.username = peer.username; roomChanged = true; }
    if (roomChanged) { setScoped('rooms', state.rooms); renderRoomList(); if (state.selectedRoomId === roomId) $('chatPage').querySelector('h1').textContent = direct.name; }
  }
}
async function handlePeerMessage(peer, envelope) {
  const remote=envelope.data,roomId=envelope.roomId;
  if(!validPeerMessage(remote,roomId))return;
  const incoming={...peerMessagePayload(remote,roomId),serverKey:currentServerKey(),clientId:String(remote.clientId||envelope.fromAccountId||peer.accountId),username:String(remote.username||peer.username||'Пользователь').slice(0,60),roomId,mine:String(remote.clientId||'')===state.clientId,delivery:'received',receivedViaP2P:true};
  syncContactProfileFromPeer(peer, incoming, roomId);
  if(isLocallyHiddenMessage(incoming))return;
  const all=await idb.all('messages');const existing=all.find(m=>m.id===incoming.id&&(m.roomId||'global')===roomId&&(m.serverKey||currentServerKey())===currentServerKey());
  if(existing){
    if(Date.parse(incoming.updatedAt||'')>Date.parse(existing.updatedAt||'')){
      const keepMedia=existing.mediaData||existing.imageData;Object.assign(existing,incoming);if(!incoming.mediaData&&!incoming.imageData&&keepMedia){existing.mediaData=existing.mediaData||keepMedia;}
      await saveMsg(existing);const live=state.messages.find(m=>m.id===existing.id&&m.roomId===roomId);if(live){Object.assign(live,existing);if(state.selectedRoomId===roomId){const row=rowEl(live.id);if(row)row.replaceWith(createRow(live));}}
    }
    return;
  }
  if(getLocalChatPref(roomId).keepHistory===false&& !state.rooms.some(r=>r.id===roomId))return;
  await saveMsg(incoming);
  if(state.selectedRoomId===roomId){state.messages.push(incoming);state.messages.sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));msgMap.set(incoming.id,incoming);appendRow(incoming,true);toBottom();}
  if(document.visibilityState==='hidden'&&!incoming.mine)void notifyIncoming(incoming);
}
async function handleMeshEnvelope(peer,envelope) {
  if(!envelope||envelope.v!==1||typeof envelope.type!=='string'||typeof envelope.eventId!=='string')return;
  const roomId=String(envelope.roomId||'global');
  if(!peer.roomIds.has(roomId))return;
  if(envelope.type==='message-ack'){
    const targetDeviceId=String(envelope.data?.targetDeviceId||'');
    if(targetDeviceId===state.deviceId){
      const messageId=String(envelope.data?.messageId||'');
      if(messageId){await idb.del('outbox',messageId);updateMessageStatus(messageId,'sent');void replayMessageOutbox(peer);}
      return;
    }
    if((Number(envelope.hops)||0)>0){
      const forwarded={...envelope,hops:(Number(envelope.hops)||0)-1};
      for(const next of state.meshPeers.values()){if(next.deviceId!==peer.deviceId&&next.dc?.readyState==='open'&&next.roomIds.has(roomId))await sendPeerEnvelope(next,forwarded).catch(()=>{});}
    }
    return;
  }
  if(['mesh-inventory','mesh-request','mesh-ack'].includes(envelope.type)){
    if(envelope.type==='mesh-inventory'){
      const remoteIds=new Set((Array.isArray(envelope.data?.ids)?envelope.data.ids:[]).filter(x=>typeof x==='string').slice(-1200));
      const local=await messagesForRoom(roomId),known=new Set(local.map(m=>m.id));
      for(const key of hiddenLocalMessageSet()){const idx=key.lastIndexOf('::');if(idx>=0)known.add(key.slice(idx+2));}
      const missing=[...remoteIds].filter(id=>!known.has(id));
      for(let start=0;start<missing.length;start+=250)await sendPeerEnvelope(peer,{v:1,type:'mesh-request',eventId:randomId(),roomId,fromDeviceId:state.deviceId,fromAccountId:state.clientId,data:{ids:missing.slice(start,start+250)}}).catch(()=>{});
    } else if(envelope.type==='mesh-request'){
      const ids=new Set((Array.isArray(envelope.data?.ids)?envelope.data.ids:[]).filter(x=>typeof x==='string').slice(0,250));
      const local=await messagesForRoom(roomId);
      for(const message of local.filter(m=>ids.has(m.id)&&!isLocallyHiddenMessage({...m,serverKey:currentServerKey()})))await sendPeerEnvelope(peer,{v:1,type:'message',eventId:message.id,roomId,fromDeviceId:state.deviceId,fromAccountId:state.clientId,hops:4,createdAt:new Date().toISOString(),data:peerMessagePayload(message,roomId)}).catch(()=>{});
    }
    return;
  }
  const freshEvent=rememberMeshEvent(envelope.eventId);
  if(!freshEvent){
    // A previous ACK can be lost while the sender still owns this message in its
    // persistent outbox. Re-ACK duplicate message events without reprocessing them.
    if(envelope.type==='message'&&envelope.data?.id&&getLocalChatPref(roomId).keepHistory!==false){
      await sendPeerEnvelope(peer,{v:1,type:'message-ack',eventId:randomId(),roomId,fromDeviceId:state.deviceId,fromAccountId:state.clientId,hops:8,createdAt:new Date().toISOString(),data:{messageId:String(envelope.data.id),targetDeviceId:String(envelope.fromDeviceId||''),acceptedBy:state.deviceId}}).catch(()=>{});
    }
    return;
  }
  if(envelope.type==='message'){
    await handlePeerMessage(peer,envelope);
    const receivedMessage=envelope.data;
    if(receivedMessage?.id&&getLocalChatPref(roomId).keepHistory!==false){
      await sendPeerEnvelope(peer,{v:1,type:'message-ack',eventId:randomId(),roomId,fromDeviceId:state.deviceId,fromAccountId:state.clientId,hops:8,createdAt:new Date().toISOString(),data:{messageId:String(receivedMessage.id),targetDeviceId:String(envelope.fromDeviceId||''),acceptedBy:state.deviceId}}).catch(()=>{});
    }
  }
  else if(envelope.type==='reaction'){
    const m=msgMap.get(envelope.data?.messageId)|| (await idb.all('messages')).find(x=>x.id===envelope.data?.messageId&&(x.roomId||'global')===roomId);
    if(m){const changedAt=String(envelope.data.updatedAt||envelope.createdAt||new Date().toISOString());if(Date.parse(changedAt)>=Date.parse(m.reactionsUpdatedAt||'1970-01-01T00:00:00Z')){m.reactions=m.reactions&&typeof m.reactions==='object'?m.reactions:{};const actor=String(envelope.data.actorId||envelope.fromAccountId||peer.accountId);for(const key of Object.keys(m.reactions)){m.reactions[key]=(Array.isArray(m.reactions[key])?m.reactions[key]:[]).filter(id=>id!==actor);if(!m.reactions[key].length)delete m.reactions[key];}if(envelope.data.active&&envelope.data.emoji)m.reactions[envelope.data.emoji]=[...(m.reactions[envelope.data.emoji]||[]),actor];m.reactionsUpdatedAt=changedAt;m.updatedAt=changedAt;await saveMsg(m);const live=state.messages.find(x=>x.id===m.id);if(live){Object.assign(live,m);const row=rowEl(live.id);if(row)row.replaceWith(createRow(live));}}}
  } else if(envelope.type==='pin'){
    const m=msgMap.get(envelope.data?.messageId)||(await idb.all('messages')).find(x=>x.id===envelope.data?.messageId&&(x.roomId||'global')===roomId);
    if(m&&Date.parse(envelope.data.updatedAt||'')>=Date.parse(m.pinnedUpdatedAt||'1970-01-01T00:00:00Z')){m.pinned=!!envelope.data.pinned;m.pinnedBy=m.pinned?String(envelope.data.actorId||envelope.fromAccountId||''):'';m.pinnedAt=m.pinned?(envelope.data.updatedAt||new Date().toISOString()):null;m.pinnedUpdatedAt=envelope.data.updatedAt||new Date().toISOString();m.updatedAt=m.pinnedUpdatedAt;await saveMsg(m);const live=state.messages.find(x=>x.id===m.id);if(live){Object.assign(live,m);const row=rowEl(live.id);if(row)row.replaceWith(createRow(live));}}
  } else if(envelope.type==='read'){
    const m=msgMap.get(envelope.data?.messageId)||(await idb.all('messages')).find(x=>x.id===envelope.data?.messageId&&(x.roomId||'global')===roomId);
    if(m){m.readBy=[...new Set([...(m.readBy||[]),String(envelope.data.readerId||envelope.fromAccountId||peer.accountId)])].slice(-200);m.updatedAt=envelope.createdAt||new Date().toISOString();await saveMsg(m);const live=state.messages.find(x=>x.id===m.id);if(live){Object.assign(live,m);refreshMeta(live);}}
  } else if(envelope.type==='edit'){
    const m=msgMap.get(envelope.data?.messageId)||(await idb.all('messages')).find(x=>x.id===envelope.data?.messageId&&(x.roomId||'global')===roomId);
    if(m&&String(envelope.data.actorId||envelope.fromAccountId||'')===String(m.clientId||'')&&Date.parse(envelope.data.updatedAt||'')>Date.parse(m.updatedAt||'')){m.text=String(envelope.data.text||'').slice(0,8000);m.edited=true;m.updatedAt=envelope.data.updatedAt;await saveMsg(m);const live=state.messages.find(x=>x.id===m.id);if(live){Object.assign(live,m);const row=rowEl(live.id);if(row)row.replaceWith(createRow(live));}}
  } else if(envelope.type==='room-invite'){
    const invite=envelope.data;if(invite?.targetAccountId===state.clientId&&invite.room&&typeof invite.room.id==='string'&&!state.rooms.some(r=>r.id===invite.room.id)){
      const accept=await askConfirm('Приглашение в чат',`${invite.fromUsername||peer.username} приглашает тебя в «${invite.room.name||'чат'}». Метаданные чата переданы напрямую устройством участника.`, 'Присоединиться');
      if(accept){const room={...invite.room,ownerAccountId:invite.room.ownerAccountId||(/^u_[a-f0-9]{32}$/i.test(String(invite.room.ownerId||''))?invite.room.ownerId:''),ownerUsername:invite.room.ownerUsername||invite.fromUsername||peer.username||'',members:[...new Set([...(invite.room.members||[]),state.clientId])],joinedViaP2P:true};state.rooms=[room,...state.rooms];setScoped('rooms',state.rooms);renderFolderTabs();renderRoomList();await broadcastMeshEvent('global','room-join',{roomId:room.id,accountId:state.clientId,username:state.account?.username||state.profile.name});toast(`Добавлен чат «${room.name}»`);}
    }
  } else if(envelope.type==='room-join'){
    const r=state.rooms.find(x=>x.id===envelope.data?.roomId);if(r){r.members=[...new Set([...(r.members||[]),String(envelope.data.accountId||envelope.fromAccountId)])];setScoped('rooms',state.rooms);}
  } else if(envelope.type==='sticker-pack'){
    const pack=envelope.data;if(pack?.targetAccountId&&pack.targetAccountId!==state.clientId){}else if(Array.isArray(pack?.stickers)){
      for(const sticker of pack.stickers.slice(0,20)){if(typeof sticker.data!=='string'||!sticker.data.startsWith('data:image/')||sticker.data.length>950000)continue;const local={...sticker,packId:pack.id,packName:pack.name};if(!state.userStickers.some(x=>x.id===local.id)){state.userStickers.unshift(local);await idb.put('stickers',local);}}
      renderStickerPanel();
    }
  }
  await relayMeshEnvelope(envelope,peer.deviceId);
}
async function openPeerRoom(room) {
  const target=room.type==='direct'?(room.members||[]).find(id=>id!==state.clientId):'';
  if(target){const peer=state.onlinePeers.find(p=>p.accountId===target);if(peer)await sendMeshInvite(peer.accountId,room);}
}
async function sendMeshInvite(targetAccountId, room) {
  if(!state.accountId||!targetAccountId||!room)return;
  const payload={targetAccountId,room:{id:room.id,name:room.name,type:room.type,ownerId:room.ownerId,ownerAccountId:room.ownerAccountId||'',ownerUsername:room.ownerUsername||'',ownerDeviceId:room.ownerDeviceId||'',userCreated:room.userCreated!==false,description:room.description||'',username:room.username||'',createdAt:room.createdAt||new Date().toISOString(),members:[...new Set([...(room.members||[]),targetAccountId])]},fromUsername:state.account?.username||state.profile.name};
  const sent=await broadcastMeshEvent('global','room-invite',payload,{targetAccountId});
  if(sent)toast('Приглашение отправлено напрямую через P2P-сеть',2600);else toast('Приглашение сохранено локально. Для доставки адресат должен быть в сети и соединён через P2P.',3400);
}
async function inviteAccountToRoom(room, identityText) {
  let users=[];try{users=await searchAccount(identityText);}catch(e){toast(e.message);return;}
  if(!users.length){toast('Аккаунт по username/ID не найден');return;}
  let target=users[0];if(users.length>1){const choice=prompt(users.map((u,i)=>`${i+1}. @${u.username} · ${u.id}`).join('\\n')+'\\nНомер пользователя:','1');if(choice===null)return;if(!/^\\d+$/.test(choice)||!users[Number(choice)-1])return;target=users[Number(choice)-1];}
  room.members=[...new Set([...(room.members||[state.clientId]),target.id])];setScoped('rooms',state.rooms);await sendMeshInvite(target.id,room);
}
function cleanupPeerTransfers(peer) {
  const now=Date.now();for(const [id,t] of peer.rxTransfers||[])if(now-t.createdAt>60_000)peer.rxTransfers.delete(id);
}

async function signalCall(toId, callId, signal) {
  if (!state.serverUrl || !state.authToken) throw new Error('Для связи нужно войти в аккаунт и настроить сервер сигнализации');
  const response = await fetch(`${state.serverUrl}/api/calls/signals`, {
    method: 'POST', headers: signalDeviceHeaders(),
    body: JSON.stringify({ fromId: state.deviceId, toId, callId, signal })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || data.error || `HTTP ${response.status}`);
  return data;
}

const HISTORY_CHUNK_CHARS=12000, HISTORY_MAX_MESSAGES=500, HISTORY_MAX_TRANSFER_BYTES=100*1024*1024;
function directPeer(room){return room?.type==='direct'&&Array.isArray(room.members)?room.members.find(id=>id!==state.clientId)||'':'';}
function onlineDeviceForAccount(accountId){return state.onlinePeers.find(p=>p.accountId===accountId)?.deviceId||[...state.meshPeers.values()].find(p=>p.accountId===accountId&&p.dc?.readyState==='open')?.deviceId||'';}
function sendHistorySignal(t,payload){return signalCall(t.peerId,t.callId,{...payload,roomId:t.roomId});}
function makeHistoryPeer(){return new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});}
function disposeHistoryTransfer(t,notice=''){
  if(!t||t.disposed)return;t.disposed=true;if(t.timeoutId)clearTimeout(t.timeoutId);
  try{t.channel?.close();}catch{}try{t.pc?.close();}catch{}
  if(state.p2pTransfer===t)state.p2pTransfer=null;
  if(notice)toast(notice,3500);
}
function bindHistoryChannel(t,channel){
  t.channel=channel;channel.bufferedAmountLowThreshold=128*1024;
  channel.onopen=()=>{if(t.role==='sender')void sendPeerHistory(t);};
  channel.onmessage=e=>{t.receiveChain=(t.receiveChain||Promise.resolve()).then(()=>handleHistoryData(t,e.data)).catch(err=>disposeHistoryTransfer(t,`P2P передача прервана: ${err.message||'ошибка'}`));};
  channel.onerror=()=>disposeHistoryTransfer(t,'Ошибка P2P-канала');
  channel.onclose=()=>{if(state.p2pTransfer===t&&!t.completed)disposeHistoryTransfer(t,'P2P-соединение закрыто');};
}
async function createHistoryPeer(t,createChannel){
  t.pc=makeHistoryPeer();
  if(createChannel)bindHistoryChannel(t,t.pc.createDataChannel('pgmz-history',{ordered:true}));
  else t.pc.ondatachannel=e=>bindHistoryChannel(t,e.channel);
  t.pc.onicecandidate=e=>{if(e.candidate&&!t.disposed)sendHistorySignal(t,{type:'history-candidate',candidate:e.candidate.toJSON()}).catch(()=>{});};
  t.pc.onconnectionstatechange=()=>{if(['failed','closed'].includes(t.pc.connectionState)&&!t.completed)disposeHistoryTransfer(t,'P2P-соединение не удалось. Проверь сеть и повтори попытку.');};
}
async function requestPeerHistory(){
  const room=activeRoom(),peerAccountId=directPeer(room),peerId=onlineDeviceForAccount(peerAccountId),prefs=getLocalChatPref(room.id);
  if(room.type!=='direct'||!peerAccountId){toast('Получение истории доступно только в личном чате');return;}
  if(!peerId){toast('Собеседник сейчас не виден в P2P-сети. Откройте приложение на обоих устройствах и попробуйте ещё раз.',3500);return;}
  if(!state.serverUrl){toast('Сначала настрой сервер обмена сигналами');openSettings('server');return;}
  if(prefs.allowPeerDownload!==true){toast('Получение истории недоступно в этом чате.');return;}
  if(prefs.keepHistory===false){toast('Включи сохранение истории на этом устройстве, чтобы принять сообщения');return;}
  if(state.p2pTransfer||state.call){toast('Сначала заверши активный звонок или текущую P2P-передачу');return;}
  if(!window.RTCPeerConnection){toast('В этом WebView нет поддержки WebRTC DataChannel');return;}
  const t={role:'receiver',peerId,callId:randomId(),roomId:room.id,pc:null,channel:null,pendingCandidates:[],incomingById:new Map(),mediaChunks:new Map(),disposed:false,completed:false};state.p2pTransfer=t;t.timeoutId=setTimeout(()=>disposeHistoryTransfer(t,'P2P-запрос истёк по времени. Проверь, что второе устройство в сети.'),5*60*1000);startCallPolling();
  try{await sendHistorySignal(t,{type:'history-request'});toast('Запрос отправлен. Собеседник должен разрешить передачу истории.',4500);}
  catch(e){disposeHistoryTransfer(t,`Не удалось запросить историю: ${e.message}`);}
}
async function rejectPendingHistoryRequest(reason='declined'){
  const pending=state.pendingHistoryRequest;state.pendingHistoryRequest=null;
  const dialog=$('p2pIncomingDialog');if(dialog?.open)dialog.close();
  if(pending)await signalCall(pending.signal.fromId,pending.signal.callId,{type:'history-refused',roomId:pending.payload.roomId,reason}).catch(()=>{});
}
async function acceptPeerHistoryRequest(signal, payload){
  const room=state.rooms.find(r=>r.id===payload.roomId&&r.type==='direct'&&Array.isArray(r.members)&&r.members.includes(state.clientId)&&r.members.includes(signal.fromAccountId||''));
  if(!room){await signalCall(signal.fromId,signal.callId,{type:'history-refused',roomId:payload.roomId,reason:'chat_not_found'}).catch(()=>{});return;}
  const prefs=getLocalChatPref(room.id);
  if(prefs.allowPeerSeed!==true||prefs.keepHistory===false){await signalCall(signal.fromId,signal.callId,{type:'history-refused',roomId:room.id,reason:'sharing_disabled'}).catch(()=>{});return;}
  if(state.p2pTransfer||state.call||state.pendingHistoryRequest){await signalCall(signal.fromId,signal.callId,{type:'history-refused',roomId:room.id,reason:'busy'}).catch(()=>{});return;}
  state.pendingHistoryRequest={signal,payload,roomId:room.id};
  $('p2pIncomingFrom').textContent=signal.fromAccountId||signal.fromId;
  $('p2pIncomingRoom').textContent=room.name||'Личный чат';
  $('p2pIncomingDialog').showModal();
}
async function approvePendingHistoryRequest(){
  const pending=state.pendingHistoryRequest;if(!pending)return;
  state.pendingHistoryRequest=null;const dialog=$('p2pIncomingDialog');if(dialog?.open)dialog.close();
  const {signal,payload}=pending,room=state.rooms.find(r=>r.id===pending.roomId),prefs=getLocalChatPref(pending.roomId);
  if(!room||prefs.allowPeerSeed!==true||prefs.keepHistory===false||state.p2pTransfer||state.call){await signalCall(signal.fromId,signal.callId,{type:'history-refused',roomId:pending.roomId,reason:'permission_changed'}).catch(()=>{});toast('Передача не началась: настройки изменились.');return;}
  const t={role:'sender',peerId:signal.fromId,callId:signal.callId,roomId:room.id,pc:null,channel:null,pendingCandidates:[],disposed:false,completed:false};state.p2pTransfer=t;t.timeoutId=setTimeout(()=>disposeHistoryTransfer(t,'P2P-передача прервана по тайм-ауту.'),5*60*1000);
  try{await createHistoryPeer(t,true);await t.pc.setLocalDescription(await t.pc.createOffer());await sendHistorySignal(t,{type:'history-offer',description:t.pc.localDescription.toJSON()});toast('Подключаюсь для передачи истории…',3000);}
  catch(e){disposeHistoryTransfer(t,`Не удалось начать передачу: ${e.message}`);}
}
async function sendPeerHistory(t){
  if(t.sent||t.disposed||!t.channel||t.channel.readyState!=='open')return;t.sent=true;
  const prefs=getLocalChatPref(t.roomId);if(prefs.allowPeerSeed!==true||prefs.keepHistory===false)throw new Error('Раздача истории отключена');
  const all=await idb.all('messages');
  const msgs=all.filter(m=>(m.roomId||'global')===t.roomId&&(m.serverKey||currentServerKey())===currentServerKey()&&!isLocallyHiddenMessage(m)).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)).slice(-HISTORY_MAX_MESSAGES);
  const channel=t.channel;
  const send=async value=>{if(t.disposed||channel.readyState!=='open')throw new Error('Канал закрыт');while(channel.bufferedAmount>512*1024){await new Promise(resolve=>{let done=false;const finish=()=>{if(done)return;done=true;clearTimeout(timer);channel.removeEventListener?.('bufferedamountlow',finish);resolve();};channel.addEventListener?.('bufferedamountlow',finish,{once:true});const timer=setTimeout(finish,80);});if(t.disposed||channel.readyState!=='open')throw new Error('Канал закрыт');}channel.send(JSON.stringify(value));};
  await send({type:'history-start',total:msgs.length,roomId:t.roomId});
  let mediaCount=0, mediaBytes=0;
  for(let index=0;index<msgs.length;index++){
    const currentPrefs=getLocalChatPref(t.roomId);if(currentPrefs.allowPeerSeed!==true||currentPrefs.keepHistory===false)throw new Error('Разрешение на отдачу истории выключено');
    const m=msgs[index],metadata={id:String(m.id),roomId:t.roomId,clientId:String(m.clientId||''),username:String(m.username||'Собеседник').slice(0,60),text:String(m.text||'').slice(0,8000),type:String(m.type||'text'),mediaUrl:String(m.mediaUrl||''),mediaMime:String(m.mediaMime||''),posterData:typeof m.posterData==='string'&&m.posterData.length<=180_000?m.posterData:'',duration:cleanDuration(m.duration,m.type),waveform:Array.isArray(m.waveform)?m.waveform.slice(0,64):[],createdAt:m.createdAt||new Date().toISOString(),updatedAt:m.updatedAt||m.createdAt||new Date().toISOString(),replyTo:m.replyTo||null,forwarded:!!m.forwarded,forwardedFrom:String(m.forwardedFrom||''),reactions:m.reactions&&typeof m.reactions==='object'?m.reactions:{},pinned:!!m.pinned,pinnedBy:String(m.pinnedBy||''),pinnedAt:m.pinnedAt||null,readBy:Array.isArray(m.readBy)?m.readBy:[],authorIsSource:!!m.mine};
    await send({type:'history-message',index,message:metadata});
    const rawLocalMedia=(prefs.cacheMedia===true||prefs.allowPeerSeed===true)?(m.imageData||m.mediaData||''):'';
    const fallbackMime = m.type === 'circle' || m.type === 'video' ? 'video/webm' : m.type === 'voice' ? 'audio/webm' : 'application/octet-stream';
    const localMedia = normalizeMediaDataUrl(rawLocalMedia, canonicalMediaMime(m.mediaMime, fallbackMime));
    const comma=localMedia.indexOf(',');
    if(comma>0&&localMedia.startsWith('data:')){
      const prefix=localMedia.slice(0,comma+1),base64=localMedia.slice(comma+1),decodedBytes=Math.floor(base64.length*3/4);
      if(base64&&decodedBytes<=8*1024*1024&&mediaBytes+decodedBytes<=HISTORY_MAX_TRANSFER_BYTES){mediaBytes+=decodedBytes;const field=m.imageData?'imageData':'mediaData',chunks=Math.ceil(base64.length/HISTORY_CHUNK_CHARS);await send({type:'history-media-start',id:metadata.id,field,prefix,chunks});for(let part=0;part<chunks;part++)await send({type:'history-media-chunk',id:metadata.id,field,part,data:base64.slice(part*HISTORY_CHUNK_CHARS,(part+1)*HISTORY_CHUNK_CHARS)});await send({type:'history-media-end',id:metadata.id,field});mediaCount++;}
    }
  }
  await send({type:'history-finish',total:msgs.length,mediaCount});
}
async function handleHistoryData(t,raw){
  if(t.disposed)return;
  let data;try{data=JSON.parse(String(raw));}catch{return;}if(!data||typeof data.type!=='string')return;
  if(t.role==='receiver'&&data.type!=='history-ack'&&data.type!=='unused'){const prefs=getLocalChatPref(t.roomId);if(prefs.allowPeerDownload!==true||prefs.keepHistory===false){disposeHistoryTransfer(t,'Получение истории выключено; передача остановлена.');return;}}
  if(t.role==='sender'&&data.type==='history-ack'){t.completed=true;disposeHistoryTransfer(t,`История передана: ${Math.max(0,Number(data.count)||0)} сообщений.`);return;}
  if(t.role!=='receiver')return;
  if(data.type==='history-start'){if(data.roomId!==t.roomId)return;t.expected=Math.max(0,Math.min(HISTORY_MAX_MESSAGES,Number(data.total)||0));t.received=0;return;}
  if(data.type==='history-message'){
    if(data.message?.roomId!==t.roomId||typeof data.message.id!=='string'||! /^[A-Za-z0-9_.:-]{1,200}$/.test(data.message.id))return;
    const x=data.message,clean={id:x.id,serverKey:currentServerKey(),roomId:t.roomId,clientId:String(x.clientId||''),username:String(x.username||'Собеседник').slice(0,60),text:String(x.text||'').slice(0,8000),type:['text','image','voice','circle','video','file','sticker'].includes(x.type)?x.type:'text',mediaUrl:String(x.mediaUrl||''),mediaMime:String(x.mediaMime||''),posterData:typeof x.posterData==='string'&&x.posterData.startsWith('data:image/')&&x.posterData.length<=180_000?x.posterData:'',duration:cleanDuration(x.duration,x.type),waveform:Array.isArray(x.waveform)?x.waveform.slice(0,64).map(v=>Math.max(0,Math.min(1,Number(v)||0))):[],createdAt:x.createdAt||new Date().toISOString(),updatedAt:x.updatedAt||x.createdAt||new Date().toISOString(),replyTo:x.replyTo||null,forwarded:!!x.forwarded,forwardedFrom:String(x.forwardedFrom||''),reactions:x.reactions&&typeof x.reactions==='object'?x.reactions:{},pinned:!!x.pinned,pinnedBy:String(x.pinnedBy||''),pinnedAt:x.pinnedAt||null,readBy:Array.isArray(x.readBy)?x.readBy:[],mine:x.authorIsSource===undefined?String(x.clientId||'')===state.clientId:!x.authorIsSource,delivery:'received',historyRestoredFromPeer:true};
    unhideLocalMessage(clean);t.incomingById.set(clean.id,clean);const all=await idb.all('messages'),existing=all.find(m=>m.id===clean.id&&(m.roomId||'global')===t.roomId&&(m.serverKey||currentServerKey())===currentServerKey());if(!existing){await saveMsg(clean);if(!state.messages.some(m=>m.id===clean.id)){state.messages.push(clean);msgMap.set(clean.id,clean);if(state.selectedRoomId===t.roomId)appendRow(clean,true);}}else {const inMemory=state.messages.find(m=>m.id===clean.id&&(m.roomId||'global')===t.roomId);t.incomingById.set(clean.id,inMemory||existing);}t.received=(t.received||0)+1;return;
  }
  if(data.type==='history-media-start'){
    const localPrefs=getLocalChatPref(t.roomId);if(localPrefs.allowPeerDownload!==true||localPrefs.keepHistory===false)return;
    const m=t.incomingById.get(data.id);if(!m||!['mediaData','imageData'].includes(data.field)||!/^data:(image|audio|video)\/[a-z0-9.+-]+(?:;[^,]*)?;base64,$/i.test(String(data.prefix||''))||!Number.isSafeInteger(data.chunks)||data.chunks<1||data.chunks>1000)return;
    t.mediaChunks.set(`${data.id}:${data.field}`,{field:data.field,prefix:data.prefix,chunks:Array(data.chunks),expected:data.chunks,parts:0});return;
  }
  if(data.type==='history-media-chunk'){
    const item=t.mediaChunks.get(`${data.id}:${data.field}`);if(!item||!Number.isSafeInteger(data.part)||data.part<0||data.part>=item.expected||typeof data.data!=='string'||data.data.length>HISTORY_CHUNK_CHARS)return;
    if(!item.chunks[data.part]){item.chunks[data.part]=data.data;item.parts++;}return;
  }
  if(data.type==='history-media-end'){
    const key=`${data.id}:${data.field}`,item=t.mediaChunks.get(key),m=t.incomingById.get(data.id);if(!item||!m||item.parts!==item.expected)return;
    const base64=item.chunks.join('');if(Math.floor(base64.length*3/4)<=8*1024*1024){m[item.field]=item.prefix+base64;await saveMsg(m);if(state.selectedRoomId===t.roomId){const row=rowEl(m.id);if(row)row.replaceWith(createRow(m));}}
    t.mediaChunks.delete(key);return;
  }
  if(data.type==='history-finish'){
    t.completed=true;const n=t.received||0;if(state.selectedRoomId===t.roomId)renderAll();try{if(t.channel?.readyState==='open')t.channel.send(JSON.stringify({type:'history-ack',count:n}));}catch{}setTimeout(()=>disposeHistoryTransfer(t,`История получена: ${n} сообщений. Сохранено на этом телефоне.`),350);return;
  }
}
async function handleHistorySignal(signal,payload){
  const t=state.p2pTransfer;
  if(payload.type==='history-request'){await acceptPeerHistoryRequest(signal,payload);return;}
  if(!t||t.callId!==signal.callId||t.peerId!==signal.fromId||t.roomId!==payload.roomId)return;
  if(payload.type==='history-refused'){disposeHistoryTransfer(t,`Собеседник не разрешил передачу истории (${payload.reason||'отказ'}).`);return;}
  try{
    if(payload.type==='history-offer'&&t.role==='receiver'){
      await createHistoryPeer(t,false);await t.pc.setRemoteDescription(new RTCSessionDescription(payload.description));const answer=await t.pc.createAnswer();await t.pc.setLocalDescription(answer);await sendHistorySignal(t,{type:'history-answer',description:t.pc.localDescription.toJSON()});
      for(const c of t.pendingCandidates.splice(0))await t.pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});return;
    }
    if(payload.type==='history-answer'&&t.role==='sender'){
      await t.pc.setRemoteDescription(new RTCSessionDescription(payload.description));for(const c of t.pendingCandidates.splice(0))await t.pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});return;
    }
    if(payload.type==='history-candidate'&&payload.candidate){if(t.pc?.remoteDescription)await t.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(()=>{});else t.pendingCandidates.push(payload.candidate);}
  }catch(e){disposeHistoryTransfer(t,`Ошибка согласования P2P: ${e.message}`);}
}
function showCallDialog(call,incoming=false){$('callTitle').textContent=call.isVideo?'Видеозвонок':'Аудиозвонок';$('callStatus').textContent=incoming?`Входящий вызов от ${call.peerId}`:`Вызов ID ${call.peerId}…`;$('callAcceptBtn').classList.toggle('hidden',!incoming);$('callRejectBtn').classList.toggle('hidden',!incoming);$('callEndBtn').classList.toggle('hidden',incoming);$('callAudioAvatar').classList.toggle('hidden',call.isVideo);if(!$('callDialog').open)$('callDialog').showModal();}
async function startCall(isVideo){if(state.recorder||state.recordingStarting){toast('Сначала заверши запись');return;}if(!state.serverUrl){toast('Для звонков сначала настрой сервер и HTTPS',3500);openSettings('server');return;}const room=activeRoom();const directAccount=room.type==='direct'?(room.members||[]).find(id=>id!==state.clientId):'';const enteredAccount=directAccount||prompt('ID аккаунта собеседника:');if(!enteredAccount?.trim())return;const accountId=enteredAccount.trim();if(accountId===state.clientId){toast('Нельзя позвонить самому себе');return;}const peerId=onlineDeviceForAccount(accountId);if(!peerId){toast('Собеседник не в сети. Звонок можно начать, когда его устройство подключится.',3500);return;}if(state.call){toast('Звонок уже активен');return;}const call={peerId,peerAccountId:accountId,callId:randomId(),isVideo,incoming:false,pc:null,stream:null,pendingCandidates:[],offer:null};state.call=call;state.callSignalCursor=Date.now()-1000;showCallDialog(call,false);$('callStatus').textContent='Запрашиваю доступ к микрофону и камере…';
  try{await setupCallPeer(call);const offer=await call.pc.createOffer();await call.pc.setLocalDescription(offer);await signalCall(call.peerId,call.callId,{type:'offer',description:call.pc.localDescription.toJSON(),isVideo});$('callStatus').textContent='Вызов идёт… ожидаю ответ';}catch(e){toast(`Не удалось начать звонок: ${e.message}`,3500);await endCall(false);}startCallPolling();}
async function setupCallPeer(call){try{call.nativeAudioSession=window.PgmzNative?.beginMediaCapture?.()===true;}catch{}const constraints={audio:true,video:call.isVideo?{facingMode:'user',width:{ideal:640},height:{ideal:480}}:false};call.stream=await navigator.mediaDevices.getUserMedia(constraints);$('callLocalVideo').srcObject=call.stream;$('callLocalVideo').classList.toggle('hidden',!call.isVideo);call.pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.l.google.com:19302'}]});for(const track of call.stream.getTracks())call.pc.addTrack(track,call.stream);call.pc.onicecandidate=e=>{if(e.candidate&&state.call===call)signalCall(call.peerId,call.callId,{type:'candidate',candidate:e.candidate.toJSON()}).catch(()=>{});};call.pc.ontrack=e=>{const remote=$('callRemoteVideo');remote.srcObject=e.streams[0];remote.classList.toggle('hidden',!call.isVideo);$('callAudioAvatar').classList.toggle('hidden',call.isVideo);};call.pc.onconnectionstatechange=()=>{if(state.call!==call)return;if(call.pc.connectionState==='connected')$('callStatus').textContent='Соединение установлено';if(['failed','disconnected'].includes(call.pc.connectionState))$('callStatus').textContent='Соединение прервано или не удалось';if(call.pc.connectionState==='closed')closeCallDialog();};}
async function acceptCall(){const call=state.call;if(!call?.incoming||!call.offer)return;try{$('callStatus').textContent='Подключаюсь…';await setupCallPeer(call);await call.pc.setRemoteDescription(new RTCSessionDescription(call.offer));for(const c of call.pendingCandidates)await call.pc.addIceCandidate(new RTCIceCandidate(c)).catch(()=>{});call.pendingCandidates=[];const answer=await call.pc.createAnswer();await call.pc.setLocalDescription(answer);await signalCall(call.peerId,call.callId,{type:'answer',description:call.pc.localDescription.toJSON()});call.incoming=false;$('callAcceptBtn').classList.add('hidden');$('callRejectBtn').classList.add('hidden');$('callEndBtn').classList.remove('hidden');$('callStatus').textContent='Соединяю…';}catch(e){toast(`Не удалось ответить: ${e.message}`,3500);await endCall(true);}}
async function handleCallSignal(signal) {
  if (!signal || signal.fromId === state.deviceId) return;
  const payload = signal.signal;
  if (typeof payload?.type === 'string' && payload.type.startsWith('mesh-')) { await handleMeshSignal(signal, payload); return; }
  if (typeof payload?.type === 'string' && payload.type.startsWith('history-')) { await handleHistorySignal(signal, payload); return; }
  let call = state.call;
  if (payload?.type === 'offer' && !call) {
    call = { peerId: signal.fromId, peerAccountId: signal.fromAccountId, callId: signal.callId, isVideo: !!payload.isVideo, incoming: true, pc: null, stream: null, pendingCandidates: [], offer: payload.description };
    state.call = call; showCallDialog(call, true); return;
  }
  if (!call || call.callId !== signal.callId || call.peerId !== signal.fromId) return;
  if (payload.type === 'answer' && call.pc) {
    await call.pc.setRemoteDescription(new RTCSessionDescription(payload.description));
    for (const candidate of call.pendingCandidates) await call.pc.addIceCandidate(new RTCIceCandidate(candidate)).catch(() => {});
    call.pendingCandidates = []; $('callStatus').textContent = 'Соединяю…';
  } else if (payload.type === 'candidate' && payload.candidate) {
    if (call.pc?.remoteDescription) await call.pc.addIceCandidate(new RTCIceCandidate(payload.candidate)).catch(() => {});
    else call.pendingCandidates.push(payload.candidate);
  } else if (['hangup', 'reject'].includes(payload.type)) {
    toast(payload.type === 'reject' ? 'Собеседник отклонил вызов' : 'Вызов завершён', 2000); await endCall(false);
  }
}

function startCallPolling(){if(!state.serverUrl||state.callPollTimer)return;pollCallSignals();state.callPollTimer=setInterval(()=>{if(state.authToken)pollCallSignals();},1500);}
async function pollCallSignals() {
  if (state.callPollBusy || !state.serverUrl || !state.authToken) return;
  state.callPollBusy = true;
  const requestServer = state.serverUrl, requestEpoch = state.serverEpoch;
  try {
    const r = await fetch(`${requestServer}/api/calls/signals?deviceId=${encodeURIComponent(state.deviceId)}&after=${state.callSignalCursor}`, { cache: 'no-store', headers: authHeaders({ Accept: 'application/json' }) });
    if (!r.ok) return;
    if (requestServer !== state.serverUrl || requestEpoch !== state.serverEpoch) return;
    const d = await r.json();
    for (const sig of d.signals || []) {
      state.callSignalCursor = Math.max(state.callSignalCursor, Number(sig.createdAtMs) || Date.parse(sig.createdAt) || state.callSignalCursor);
      await handleCallSignal(sig);
    }
  } catch (error) { console.debug('P2P signalling poll failed', error); }
  finally { if (requestEpoch === state.serverEpoch) state.callPollBusy = false; }
}

async function endCall(sendHangup=true){const c=state.call;if(sendHangup&&c)signalCall(c.peerId,c.callId,{type:'hangup'}).catch(()=>{});if(c?.nativeAudioSession){try{window.PgmzNative?.endMediaCapture?.();}catch{}c.nativeAudioSession=false;}if(c?.pc){try{c.pc.close();}catch{}}for(const t of c?.stream?.getTracks?.()||[])t.stop();state.call=null;$('callRemoteVideo').srcObject=null;$('callLocalVideo').srcObject=null;closeCallDialog();}
function closeCallDialog(){$('callRemoteVideo').srcObject=null;$('callLocalVideo').srcObject=null;if($('callDialog').open)$('callDialog').close();}

// ---------- search ----------
function openSearch() { $('searchDialogInput').value = ''; $('searchResults').replaceChildren(); $('searchDialog').showModal(); void runSearch(); setTimeout(() => $('searchDialogInput').focus(), 50); }
let globalSearchRunId = 0;
function renderGlobalSearchResult(box, titleText, detailText, onClick, kind = '') {
  const b = document.createElement('button'); b.type = 'button'; b.className = 'global-search-result';
  const icon = document.createElement('span'); icon.className = 'global-search-result-icon'; icon.textContent = kind === 'channel' ? '◉' : '@';
  const copy = document.createElement('span'); copy.className = 'global-search-result-copy';
  const title = document.createElement('strong'); title.textContent = titleText; const detail = document.createElement('small'); detail.textContent = detailText;
  copy.append(title, detail); b.append(icon, copy); b.addEventListener('click', () => { $('searchInput').value = ''; void runGlobalSearch(); onClick(); }); box.append(b);
}
async function runGlobalSearch() {
  const runId = ++globalSearchRunId, input = $('searchInput'), box = $('globalSearchResults'); if (!input || !box) return;
  const raw = input.value.trim(), q = raw.toLocaleLowerCase('ru'); box.replaceChildren();
  const roomList = $('roomList');
  if (!q) { box.classList.add('hidden'); roomList.classList.remove('hidden'); return; }
  box.classList.remove('hidden'); roomList.classList.add('hidden');
  const needle = q.replace(/^@+/, '');
  const channels = state.rooms.filter(r => r.type === 'channel' && (`${r.name||''} ${r.username||''}`).toLocaleLowerCase('ru').includes(needle)).slice(0, 10);
  for (const channel of channels) renderGlobalSearchResult(box, channel.name || 'Канал', channel.username ? `Канал · @${channel.username}` : 'Локальный канал', () => { void switchRoom(channel); setPage('chat'); }, 'channel');
  if (q.startsWith('@')) {
    if (!/^[a-z0-9_]{3,32}$/.test(needle)) {
      const tip = document.createElement('p'); tip.className = 'global-search-note'; tip.textContent = 'Введи полный username после @ (3–32 символа).'; box.append(tip);
    } else if (state.testMode) {
      if (needle === 'demo_friend') {
        const demo = state.contacts.find(c => c.username === needle) || { peerId: 'sandbox-demo-friend', username: needle, name: 'Демо-собеседник' };
        renderGlobalSearchResult(box, '@demo_friend', 'Демо-профиль · только локально', () => { void openDirectContact(demo); }, 'user');
      } else { const note=document.createElement('p');note.className='global-search-note';note.textContent='В песочнице доступен только демонстрационный пользователь @demo_friend.';box.append(note); }
    } else if (!state.authToken || !state.serverUrl) {
      const note=document.createElement('p');note.className='global-search-note';note.textContent='Для поиска аккаунтов нужен вход и подключённый сервер. Локальные каналы ищутся без сервера.';box.append(note);
    } else {
      const loading=document.createElement('p');loading.className='global-search-note';loading.textContent=`Ищу точное совпадение @${needle}…`;box.append(loading);
      try {
        const users = await searchAccount(needle); if (runId !== globalSearchRunId) return;
        box.replaceChildren();
        // Re-render channel results after the asynchronous lookup.
        for (const channel of channels) renderGlobalSearchResult(box, channel.name || 'Канал', channel.username ? `Канал · @${channel.username}` : 'Локальный канал', () => { void switchRoom(channel); setPage('chat'); }, 'channel');
        if (!users.length) { const note=document.createElement('p');note.className='global-search-note';note.textContent=`Точный username @${needle} не найден.`;box.append(note); }
        for (const user of users) renderGlobalSearchResult(box, `@${user.username}`, 'Пользователь · открыть личный чат', () => { void openDirectContact({ peerId:user.id, username:user.username, name:user.username, avatar:user.avatar || '' }); }, 'user');
      } catch (error) {
        if (runId !== globalSearchRunId) return;
        const note=document.createElement('p');note.className='global-search-note';note.textContent=`Поиск недоступен: ${error.message}`;box.append(note);
      }
    }
  } else {
    const note=document.createElement('p');note.className='global-search-note';note.textContent='По названию ищутся каналы. Для пользователя введи полный @username.';box.append(note);
  }
  if (!box.children.length) { const note=document.createElement('p');note.className='global-search-note';note.textContent='Каналов с таким названием не найдено.';box.append(note); }
}
let localSearchRunId=0;
async function runSearch() {
  const runId=++localSearchRunId,q=$('searchDialogInput').value.trim().toLocaleLowerCase('ru'),box=$('searchResults');box.replaceChildren();if(!q)return;
  const all=await idb.all('messages');if(runId!==localSearchRunId)return;
  // IndexedDB and the current in-memory session only; never call the server for search.
  const byId=new Map(all.filter(m=>(m.serverKey||currentServerKey())===currentServerKey()).map(m=>[m.id,m]));
  for(const m of state.messages)byId.set(m.id,m);
  const matches=[...byId.values()].filter(m=>(m.serverKey||currentServerKey())===currentServerKey()&&String(m.text||'').toLocaleLowerCase('ru').includes(q)).sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,100);
  if(runId!==localSearchRunId)return;
  if(!matches.length){const n=document.createElement('p');n.className='form-caption';n.textContent='Совпадений в локально сохранённой истории не найдено';box.append(n);return;}
  for(const m of matches){const b=document.createElement('button');b.type='button';b.className='search-result';const t=document.createElement('span');t.textContent=m.text||({image:'Изображение',video:'Видео',circle:'Видеокружок',voice:'Голосовое сообщение',sticker:'Стикер',file:'Файл'}[m.type]||'Сообщение');const s=document.createElement('small');const room=state.rooms.find(r=>r.id===(m.roomId||'global'));s.textContent=`${room?.name||'Чат'} · ${time(m.createdAt)} · ${dateKey(m.createdAt)}`;b.append(t,s);b.onclick=async()=>{closeDialog('searchDialog');const target=state.rooms.find(r=>r.id===(m.roomId||'global'));if(target&&target.id!==state.selectedRoomId)await switchRoom(target);if(!jumpTo(m.id))toast('Сообщение не сохранилось в локальной истории.');};box.append(b);}
}
function closeDialog(id) { const el = $(id); if (el?.open) el.close(); }
function openProfile() { renderProfile(); $('profileDialog').showModal(); }

// ---------- boot ----------
async function loadData() {
  try { db = await idb.open(); } catch { db = null; toast('Хранилище недоступно: история не сохранится', 4000); }
  const hiddenRaw=get(LOCAL_HIDDEN_MESSAGES_KEY,[]);if(Array.isArray(hiddenRaw))set(LOCAL_HIDDEN_MESSAGES_KEY,[...new Set(hiddenRaw.filter(v=>typeof v==='string').map(v=>{const i=v.lastIndexOf('::');if(i<0)return v;const scope=v.slice(0,i);return `${scope==='__sandbox__'?'__sandbox__':'__p2p__'}${v.slice(i)}`;}))].slice(-12000));
  const storedMessages=await idb.all('messages');for(const m of storedMessages){if(m.serverKey!=='__p2p__'&&m.serverKey!=='__sandbox__'){m.serverKey='__p2p__';await idb.put('messages',m);}}
  await runAutomaticCleanupIfDue();
  let msgs = storedMessages.filter(m => !isLocallyHiddenMessage(m) && (m.serverKey || '__p2p__') === currentServerKey());
  const old = state.testMode ? null : localStorage.getItem(STORE.oldMessages);
  if (old !== null) {
    try { const parsed = JSON.parse(old); if (Array.isArray(parsed)) { const keep = parsed.filter(m => m && typeof m.id === 'string' && !m.id.startsWith('hello-intro')); for (const m of keep) if (!msgs.some(x => x.id === m.id)) { msgs.push(m); await saveMsg(m); } } } catch { }
    localStorage.removeItem(STORE.oldMessages); set(STORE.seeded, true);
  }
  if (!get(STORE.seeded, false)) { if (!msgs.length) { msgs = DEFAULT_MESSAGES().map(m=>({...m,roomId:'global',type:'text'})); for (const m of msgs) await saveMsg(m); } set(STORE.seeded, true); }
  for (const m of msgs) { if (!m.roomId) m.roomId = 'global'; if (!m.serverKey) { m.serverKey = currentServerKey(); await saveMsg(m); } }
  const selectedPrefs=getLocalChatPref(state.selectedRoomId);if($('keepHistoryToggle'))$('keepHistoryToggle').checked=selectedPrefs.keepHistory!==false;if($('cacheMediaToggle'))$('cacheMediaToggle').checked=selectedPrefs.cacheMedia===true;
  msgs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  state.messages = msgs.filter(m => (m.serverKey || currentServerKey()) === currentServerKey() && (m.roomId || 'global') === state.selectedRoomId); for (const m of state.messages) msgMap.set(m.id, m);
  state.userStickers = (await idb.all('stickers')).sort((a,b)=>b.createdAt-a.createdAt);
  state.rooms = getScoped('rooms', [{id:'global',name:'Общая группа',type:'group',ownerId:'system'}]);
  if(!state.rooms.some(r=>r.id==='global'))state.rooms.unshift({id:'global',name:'Общая группа',type:'group',ownerId:'system'});
  state.contacts = getScoped('contacts', []);
  state.folders = getScoped('folders', []);
  if (state.activeFolder.startsWith('custom:') && !state.folders.some(f => f.id === state.activeFolder.slice(7))) state.activeFolder='all';
}

async function refreshStorageManager() {
  const all=await idb.all('messages'),outbox=await idb.all('outbox'),events=await idb.all('events'),stickers=await idb.all('stickers');
  const bytes=new Blob([JSON.stringify({all,outbox,events,stickers})]).size;const mediaCount=all.filter(m=>m.mediaData||m.imageData).length;
  const summary=`${all.length} сообщений · ${stickers.length} стикеров · ${outbox.length} ожидают доставки · около ${(bytes/1024/1024).toFixed(2)} МБ всего · ${mediaCount} локальных медиа-копий`;
  const el=$('storageSummary');if(el)el.textContent=summary;const dlg=$('storageSummaryDialog');if(dlg)dlg.textContent=summary;
  const p=getLocalChatPref(state.selectedRoomId);if($('keepHistoryToggle'))$('keepHistoryToggle').checked=p.keepHistory!==false;if($('cacheMediaToggle'))$('cacheMediaToggle').checked=p.cacheMedia===true;
  if($('p2pDownloadToggle')){$('p2pDownloadToggle').checked=true;$('p2pDownloadToggle').disabled=true;}
  if($('p2pSeedToggle')){$('p2pSeedToggle').checked=true;$('p2pSeedToggle').disabled=true;}
  const room=activeRoom();const p2pAllowed=room.type==='direct'&&Array.isArray(room.members)&&room.members.includes(state.clientId);
  if($('requestPeerHistoryBtn'))$('requestPeerHistoryBtn').disabled=!p2pAllowed;
  if($('p2pHistoryNotice'))$('p2pHistoryNotice').textContent=p2pAllowed?'Оба разрешения всегда включены. Запрос истории доступен в личном чате; собеседник должен подтвердить передачу.':'Разрешения всегда включены, но запрос истории в этой версии доступен только в личном чате.';
  const cleanup=get(LOCAL_CLEANUP_KEY,{enabled:false,days:90,lastRun:0});if($('autoCleanupToggle'))$('autoCleanupToggle').checked=cleanup.enabled===true;if($('autoCleanupDays'))$('autoCleanupDays').value=String([30,90,180,365].includes(Number(cleanup.days))?Number(cleanup.days):90);
}
async function cleanLocalHistory() {
  const from=$('cleanupFrom').value?new Date($('cleanupFrom').value+'T00:00:00').getTime():-Infinity;
  const to=$('cleanupTo').value?new Date($('cleanupTo').value+'T23:59:59.999').getTime():Infinity;
  if(from>to){toast('Начальная дата позже конечной');return;}
  const roomOnly=$('cleanupCurrentRoom').checked,all=await idb.all('messages');
  const doomed=all.filter(m=>{const t=Date.parse(m.createdAt||'');return Number.isFinite(t)&&t>=from&&t<=to&&(!roomOnly||(m.roomId||'global')===state.selectedRoomId)&&(m.serverKey||currentServerKey())===currentServerKey();});
  if(!doomed.length){toast('Подходящих локальных сообщений нет');return;}
  if(!await askConfirm('Удалить локальную историю?',`Будет удалено ${doomed.length} сообщений только с этого устройства. У других участников они останутся.`,'Удалить локально'))return;
  hideLocalMessages(doomed);for(const m of doomed){await idb.del('messages',m.id);await idb.del('outbox',m.id);}state.messages=state.messages.filter(m=>!doomed.some(d=>d.id===m.id));for(const m of doomed)msgMap.delete(m.id);
  renderAll();await refreshStorageManager();toast(`Локально удалено: ${doomed.length}`);
}
async function saveLocalChatPrefs() {
  const was=getLocalChatPref(state.selectedRoomId),keepHistory=$('keepHistoryToggle').checked,cacheMedia=$('cacheMediaToggle').checked;
  const prefs=LOCAL_CHAT_PREFS();prefs[localPrefKey(state.selectedRoomId)]={...was,keepHistory,cacheMedia,updatedAt:new Date().toISOString()};localStorage.setItem(LOCAL_CHAT_PREFS_KEY,JSON.stringify(prefs));
  const all=await idb.all('messages');
  if(!keepHistory){const doomed=all.filter(m=>(m.roomId||'global')===state.selectedRoomId&&(m.serverKey||currentServerKey())===currentServerKey());hideLocalMessages(doomed);for(const m of doomed)await idb.del('messages',m.id);}
  else if(was.keepHistory===false){toast('История будет сохраняться для новых сообщений; прежняя удалённая локальная история не восстанавливается.',3500);}
  if(!cacheMedia && keepHistory && !was.allowPeerSeed && !was.allowPeerDownload){for(const m of all.filter(m=>(m.roomId||'global')===state.selectedRoomId&&(m.serverKey||currentServerKey())===currentServerKey()&&(m.mediaData||m.imageData))){const saved={...m};delete saved.mediaData;delete saved.imageData;await idb.put('messages',saved);delete m.mediaData;delete m.imageData;}}
  if(cacheMedia && keepHistory){for(const m of state.messages.filter(m=>(m.roomId||'global')===state.selectedRoomId&&(m.mediaData||m.imageData)))await saveMsg(m);const candidates=state.messages.filter(m=>(m.roomId||'global')===state.selectedRoomId&&m.mediaUrl&&!m.mediaData&&!m.imageData);for(let i=0;i<candidates.length;i+=3)await Promise.all(candidates.slice(i,i+3).map(cacheRemoteMediaForMessage));}
  toast(!keepHistory?'История этого чата больше не сохраняется на устройстве':(!cacheMedia?'Локальный кэш медиа очищен; новые вложения не будут сохраняться офлайн':'Загрузка доступных вложений для офлайн-доступа завершена'));
}
function savePeerTransferPrefs() {
  const room=activeRoom();
  if(room.type!=='direct'||!Array.isArray(room.members)||!room.members.includes(state.clientId)){toast('Обмен историей доступен только в личном чате');return;}
  const was=getLocalChatPref(room.id),prefs=LOCAL_CHAT_PREFS();
  prefs[localPrefKey(room.id)]={...was,keepHistory:was.keepHistory!==false,cacheMedia:was.cacheMedia===true,allowPeerDownload:true,allowPeerSeed:true,updatedAt:new Date().toISOString()};
  localStorage.setItem(LOCAL_CHAT_PREFS_KEY,JSON.stringify(prefs));
  toast('Настройки P2P сохранены только на этом телефоне');
}

function saveAutoCleanupSettings() {
  const current=get(LOCAL_CLEANUP_KEY,{enabled:false,days:90,lastRun:0});set(LOCAL_CLEANUP_KEY,{enabled:$('autoCleanupToggle').checked,days:Number($('autoCleanupDays').value)||90,lastRun:current.lastRun||0});
  toast($('autoCleanupToggle').checked?`Автоочистка включена: хранить ${$('autoCleanupDays').value} дней`:'Автоочистка выключена');
}
async function runAutomaticCleanupIfDue() {
  const cfg=get(LOCAL_CLEANUP_KEY,{enabled:false,days:90,lastRun:0});if(!cfg.enabled)return;
  const now=Date.now();if(cfg.lastRun&&now-Number(cfg.lastRun)<20*60*60*1000)return;
  const days=[30,90,180,365].includes(Number(cfg.days))?Number(cfg.days):90,cutoff=now-days*24*60*60*1000,all=await idb.all('messages');let removed=0;const doomed=[];
  for(const m of all){const created=Date.parse(m.createdAt||'');if(Number.isFinite(created)&&created<cutoff){doomed.push(m);await idb.del('messages',m.id);await idb.del('outbox',m.id);removed++;}}hideLocalMessages(doomed);
  set(LOCAL_CLEANUP_KEY,{...cfg,days,lastRun:now});
  if(removed)console.info(`Local auto-cleanup removed ${removed} expired messages; server history unchanged.`);
}

async function init() {
  await loadData();
  await restoreAccountSession();
  renderProfile(); applySettings(); renderAll(); setupMessageGestures(); await loadRooms(); await loadContacts();
  $('chatPage').querySelector('h1').textContent=(state.rooms.find(r=>r.id===state.selectedRoomId)?.name||'Общая группа'); if (state.serverUrl && !state.testMode) { $('serverUrlInput').value = state.serverUrl; setServerStatus('Сервер аккаунтов/сигнализации'); if (state.authToken) { restartPolling(); startCallPolling(); } }
  const input = $('messageInput'), send = $('sendBtn');
  document.querySelectorAll('[data-page]').forEach(b => b.addEventListener('click', () => setPage(b.dataset.page)));
  $('settingsBtn').onclick = () => openSettings();
  $('profileSmallBtn').onclick = openProfile; $('profileBtn').onclick = openProfile;
  $('profileBtn').addEventListener('click', () => setTimeout(() => { if (state.authToken) void refreshActiveSessions(); }, 100));
  $('profileSmallBtn').addEventListener('click', () => setTimeout(() => { if (state.authToken) void refreshActiveSessions(); }, 100));
  if($('registerAccountBtn'))$('registerAccountBtn').onclick=()=>submitAccountAuth('register');
  if($('loginAccountBtn'))$('loginAccountBtn').onclick=()=>submitAccountAuth('login');
  if($('authGateRegisterBtn'))$('authGateRegisterBtn').onclick=()=>submitAuthGate('register');
  if($('authGateLoginBtn'))$('authGateLoginBtn').onclick=()=>submitAuthGate('login');
  if($('authGateTestBtn'))$('authGateTestBtn').onclick=enterTestMode;
  if($('authGateServer'))$('authGateServer').value=state.serverUrl||'';
  if($('logoutAccountBtn'))$('logoutAccountBtn').onclick=logoutAccount;
  if($('refreshSessionsBtn'))$('refreshSessionsBtn').onclick=refreshActiveSessions;
  if($('copyAccountIdBtn'))$('copyAccountIdBtn').onclick=()=>state.account?.id&&copyText(state.account.id);
  $('menuBtn').onclick = openSidebar; $('sidebarScrim').onclick = closeSidebar;
  $('themeQuickBtn').onclick = () => openSettings('themes'); $('glassThemeBtn').onclick = () => openSettings('themes'); $('serverShortcutBtn').onclick = () => openSettings('server');
  $('addChatFolderBtn').onclick = addChatFolder; $('saveChatFolderBtn').onclick = saveChatFolder; $('deleteChatFolderBtn').onclick = () => { const id=$('saveChatFolderBtn').dataset.folderId; if(!id)return; state.folders=state.folders.filter(f=>f.id!==id);setScoped('folders',state.folders);if(state.activeFolder===`custom:${id}`){state.activeFolder='all';setScopedString('activeFolder','all');}closeDialog('folderDialog');renderFolderTabs();renderRoomList();toast('Папка удалена');};
  $('chatFolders').addEventListener('click',e=>{const b=e.target.closest('[data-folder]');if(!b||b.classList.contains('custom-folder'))return;state.activeFolder=b.dataset.folder;setScopedString('activeFolder',state.activeFolder);renderFolderTabs();renderRoomList();});
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change',()=>{if(state.theme==='system')applySettings();});
  $('backToChatBtn').onclick = () => setPage('chat'); $('contactsTestBtn').onclick = () => setPage('chat'); $('savedBackBtn').onclick = () => setPage('chat');
  $('aboutBtn').onclick = openAbout; $('aboutOpenBtn').onclick = openAbout;
  if (state.testMode && SANDBOX_AVAILABLE) { await ensureSandboxData(); dismissAuthGate(); renderProfile(); renderAll(); renderRoomList(); }
  else if (state.authToken && state.accountId) dismissAuthGate();
  else showAuthGate();
  if ($('authGateTestBtn')) { $('authGateTestBtn').hidden = !SANDBOX_AVAILABLE; if (!SANDBOX_AVAILABLE) $('authGateTestBtn').removeAttribute('aria-label'); }
  if(state.serverUrl)startCallPolling();

  // Sending keeps the keyboard open: the button never takes focus from the textarea.
  send.addEventListener('pointerdown', e => e.preventDefault());
  send.addEventListener('click', sendMessage);
  send.addEventListener('touchstart', e => e.preventDefault(), {passive:false});
  input.addEventListener('input', autoHeight);
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); sendMessage(); } });
  input.addEventListener('focus', () => { toggleSticker(false); setTimeout(() => { if (state.stick) toBottom(); }, 280); });
  $('replyCancel').addEventListener('mousedown', e => e.preventDefault());
  $('replyCancel').onclick = () => { if (state.editingId) cancelEdit(); else { state.replyTo = null; $('replyBar').classList.add('hidden'); } };
  window.addEventListener('resize', () => { if (innerWidth > 680) closeSidebar(); if (state.stick) toBottom(); });

  $('stickerBtn').onclick = () => { toggleSticker(); };
  $('stickerInput').onchange = e => { const files=[...(e.target.files||[])]; e.target.value=''; const packName=state.pendingStickerPackName; state.pendingStickerPackName=''; if(packName)publishStickerPack(packName,files); else addUserStickers(files); };
  $('createStickerPackBtn').onclick = createStickerPack; $('refreshStickerPacksBtn').onclick = loadServerStickerPacks;
  bindRecordingButton();
  $('recordingSendBtn').onclick = stopRecording; $('recordingCancelBtn').onclick = cancelRecording;
  $('serverProfilesSelect').addEventListener('change', e => { if (!e.target.value) return; $('serverUrlInput').value = e.target.value; testServer(); });
  $('removeServerBtn').onclick = removeServerProfile;
  $('callBtn').onclick = () => startCall(false); $('videoCallBtn').onclick = () => startCall(true);
  $('callAcceptBtn').onclick = acceptCall; $('callRejectBtn').onclick = () => endCall(true); $('callEndBtn').onclick = () => endCall(true); $('callCloseBtn').onclick = () => endCall(true);
  $('createGroupBtn').onclick = () => createRoom('group'); $('createChannelBtn').onclick = () => createRoom('channel'); $('contactsAddBtn').onclick = addContact;
  if($('roomInviteBtn'))$('roomInviteBtn').onclick=()=>{
    const room=activeRoom();
    if(!state.authToken||!state.accountId){toast('Войди в аккаунт, чтобы приглашать по точному username');openProfile();return;}
    if(room.type==='channel'&&!isRoomOwner(room)){toast('Приглашать участников в этот канал может только владелец');return;}
    const identity=prompt('Точный username участника (например, alex_2026):');
    if(identity?.trim())void inviteAccountToRoom(room,identity.trim());
  };
  $('roomCreateTypeGroup').onclick = () => { roomCreatorType = 'group'; updateRoomCreatorPreview(); };
  $('roomCreateTypeChannel').onclick = () => { roomCreatorType = 'channel'; updateRoomCreatorPreview(); };
  $('roomCreateName').addEventListener('input', () => { if (!roomCreatorUsernameEdited) updateRoomCreatorPreview(); });
  $('roomCreateUsername').addEventListener('input', () => { roomCreatorUsernameEdited = true; const input = $('roomCreateUsername'); const cursor = input.selectionStart; input.value = input.value.replace(/^@+/, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32); $('roomUsernameExample').textContent = '@' + (input.value || 'community'); try { input.setSelectionRange(cursor, cursor); } catch {} });
  $('roomCreateForm').addEventListener('submit', e => { e.preventDefault(); createRoomFromDialog(); });
  $('roomCreateUsernameAutoBtn').onclick = () => { roomCreatorUsernameEdited = false; updateRoomCreatorPreview(); };
  $('attachBtn').onclick = () => $('fileInput').click();
  $('fileInput').onchange = e => { const f = e.target.files?.[0]; e.target.value = ''; addImage(f); };

  $('clearChatBtn').onclick = clearChat; $('saveServerBtn').onclick = saveServer; $('testServerBtn').onclick = testServer;
  $('cleanupLocalBtn').onclick = cleanLocalHistory; $('storageRefreshBtn').onclick = refreshStorageManager; $('storageRefreshDialogBtn').onclick = refreshStorageManager; $('keepHistoryToggle').onchange = saveLocalChatPrefs; $('cacheMediaToggle').onchange = saveLocalChatPrefs;
  const openStorageManager = async () => { await refreshStorageManager(); $('storageDialog').showModal(); }; $('chatStorageBtn').onclick = openStorageManager; $('storageManagerSettingsBtn').onclick = openStorageManager;
  $('serverUrlInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); testServer(); } });
  $('enhancedAnimationsToggle').onchange = e => { state.enhanced = e.target.checked; set(STORE.enhanced, state.enhanced); applySettings(); toast(state.enhanced ? 'Улучшенные анимации включены' : 'Улучшенные анимации выключены'); };
  $('reduceMotionToggle').onchange = e => { state.reduce = e.target.checked; set(STORE.reduce, state.reduce); applySettings(); };
  $('compactModeToggle').onchange = e => { state.compact = e.target.checked; set(STORE.compact, state.compact); applySettings(); };
  $('soundToggle').onchange = e => { state.sound = e.target.checked; set(STORE.sound, state.sound); if (state.sound) playSendSound(); };
  $('notificationsToggle').onchange = e => { void enableNotifications(e.target.checked); };
  $('autoCleanupToggle').onchange = saveAutoCleanupSettings; $('autoCleanupDays').onchange = saveAutoCleanupSettings; if($('p2pDownloadToggle'))$('p2pDownloadToggle').onchange=savePeerTransferPrefs;if($('p2pSeedToggle'))$('p2pSeedToggle').onchange=savePeerTransferPrefs;if($('requestPeerHistoryBtn'))$('requestPeerHistoryBtn').onclick=requestPeerHistory; if($('p2pIncomingAcceptBtn'))$('p2pIncomingAcceptBtn').onclick=approvePendingHistoryRequest;if($('p2pIncomingRejectBtn'))$('p2pIncomingRejectBtn').onclick=()=>{void rejectPendingHistoryRequest('declined');};if($('p2pIncomingDialog'))$('p2pIncomingDialog').addEventListener('close',()=>{if(state.pendingHistoryRequest)void rejectPendingHistoryRequest('dismissed');});
  $('pinnedMessagesBtn').onclick = openPinnedMessages;
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('/sw.js').catch(() => {});
  $('fontMinus').onclick = () => { state.fontSize = Math.max(12, state.fontSize - 1); set(STORE.fontSize, state.fontSize); applySettings(); };
  $('fontPlus').onclick = () => { state.fontSize = Math.min(21, state.fontSize + 1); set(STORE.fontSize, state.fontSize); applySettings(); };
  document.querySelectorAll('.theme-option[data-theme]').forEach(b => b.addEventListener('click', () => { state.theme = b.dataset.theme; set(STORE.theme, state.theme); applySettings(); toast(`Тема ${b.querySelector('strong').textContent} применена`); }));
  $('profileAvatarInput').addEventListener('change', async e => {
    const file = e.target.files?.[0]; e.target.value = ''; if (!file) return;
    try { state.profileAvatarDraft = await encodeProfileAvatar(file); setAvatarElement($('profileAvatarPreview'), state.profileAvatarDraft, $('profileNameInput').value || 'Пользователь'); }
    catch (error) { toast(error.message || 'Не удалось загрузить фото', 3200); }
  });
  $('profileAvatarRemoveBtn').onclick = () => { state.profileAvatarDraft = ''; setAvatarElement($('profileAvatarPreview'), '', $('profileNameInput').value || 'Пользователь'); };
  $('profileNameInput').addEventListener('input', () => setAvatarElement($('profileAvatarPreview'), state.profileAvatarDraft || '', $('profileNameInput').value || 'Пользователь'));
  $('exitTestModeBtn').onclick = () => { localStorage.removeItem(SANDBOX_FLAG); location.reload(); };
  $('saveProfileBtn').onclick = () => {
    const name = $('profileNameInput').value.trim().slice(0, 36) || 'Пользователь';
    const rawHandle = $('profileHandleInput').value.trim().replace(/^@+/, '').replace(/\s+/g, '').toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 32);
    const handle = state.account?.username || rawHandle || 'tester';
    if (!state.account && !/^[a-z0-9_]{3,32}$/.test(handle)) { toast('Username должен содержать 3–32 символа: латинские буквы, цифры или _'); return; }
    state.profile = { ...state.profile, name, handle, avatar: state.profileAvatarDraft || '' }; set(profileStorageKey(), state.profile); renderProfile(); closeDialog('profileDialog'); toast('Профиль сохранён');
  };
  $('searchBtn').onclick = openSearch; $('searchInput').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); void runGlobalSearch(); } });
  $('searchInput').addEventListener('input', () => { void runGlobalSearch(); });
  $('searchDialogInput').addEventListener('input', () => { void runSearch(); });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => closeDialog(b.dataset.close)));
  document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
  document.addEventListener('click', e => {
    const b = e.target.closest('button'); if (b && !b.disabled && !b.closest('#stickerGrid') && !b.closest('#msgMenu')) animateButton(b);
    if (!e.target.closest('#stickerPanel') && !e.target.closest('#stickerBtn')) toggleSticker(false);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.serverUrl) pollMessages();
    // Android can leave a WebView capture session held after the app is backgrounded.
    // Only clean up after a stream actually exists; permission dialogs happen before that.
    if (document.visibilityState === 'hidden' && state.recordingStream) {
      state.discardRecording = true;
      if (state.recorder && state.recorder.state !== 'inactive') { try { state.recorder.stop(); } catch { cleanupRecording(); } }
      else cleanupRecording();
    }
  });
  window.addEventListener('pagehide', () => {
    state.discardRecording = true;
    if (state.recorder && state.recorder.state !== 'inactive') { try { state.recorder.stop(); } catch {} }
    else cleanupRecording();
    if (state.call) endCall(false);
  });
}
init();
