#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
node --check "$ROOT/client/app.js"
node --check "$ROOT/server/server.mjs"
node --check "$ROOT/tests/server-smoke.mjs"
node --check "$ROOT/tests/media-duration-smoke.mjs"
node --check "$ROOT/tests/media-data-url-smoke.mjs"
node --check "$ROOT/tests/sandbox-profile-search-smoke.mjs"
node --check "$ROOT/tests/admin-panel-smoke.mjs"
node --check "$ROOT/client/media-utils.js"
node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" "$ROOT/client/package.json"
node -e "JSON.parse(require('node:fs').readFileSync(process.argv[1], 'utf8'))" "$ROOT/server/package.json"
bash -n "$ROOT/build-termux.sh"
node "$ROOT/tests/server-smoke.mjs"
node "$ROOT/tests/media-duration-smoke.mjs"
node "$ROOT/tests/media-data-url-smoke.mjs"
node "$ROOT/tests/sandbox-profile-search-smoke.mjs"
node "$ROOT/tests/admin-panel-smoke.mjs"
node - "$ROOT" <<'NODE'
const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const client = path.join(root, 'client');
const assets = path.join(root, 'android/app/src/main/assets/client');
function walk(dir) { return fs.readdirSync(dir, {withFileTypes:true}).flatMap(e => e.isDirectory() ? walk(path.join(dir,e.name)) : [path.join(dir,e.name)]); }
const files = walk(client);
for (const file of files) {
  const rel = path.relative(client, file), copy = path.join(assets, rel);
  if (!fs.existsSync(copy) || !fs.readFileSync(file).equals(fs.readFileSync(copy))) throw new Error(`Android asset mismatch: ${rel}`);
}
const html = fs.readFileSync(path.join(client, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(client, 'app.js'), 'utf8');
const server = fs.readFileSync(path.join(root, 'server/server.mjs'), 'utf8');
const manifest = fs.readFileSync(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
const mainActivity = fs.readFileSync(path.join(root, 'android/app/src/main/java/com/pgmzchat/app/MainActivity.java'), 'utf8');
const idList = [...html.matchAll(/\bid="([A-Za-z0-9_-]+)"/g)].map(m => m[1]);
const ids = new Set(idList);
if (ids.size !== idList.length) throw new Error('Duplicate HTML IDs detected');
for (const m of js.matchAll(/\$\(['"]([A-Za-z0-9_-]+)['"]\)/g)) if (!ids.has(m[1])) throw new Error(`Missing HTML id in app.js: ${m[1]}`);
for (const required of ['RTCPeerConnection','createDataChannel','broadcastMeshEvent','replayMessageOutbox','message-ack','requestPeerHistory','localSearchRunId','indexedDB.open']) if(!js.includes(required)) throw new Error(`P2P/local feature missing: ${required}`);
const searchFn = js.slice(js.indexOf('async function runSearch()'), js.indexOf('function closeDialog(id)'));
if (!searchFn.includes('idb.all(\'messages\')') || searchFn.includes('fetch(') || searchFn.includes('/api/')) throw new Error('Message search must remain local-only');
for(const forbidden of ['/api/messages','/api/rooms','/api/contacts','/api/media','/api/stickers']) {
  if(server.includes(`url.pathname === '${forbidden}'`) || server.includes(`url.pathname==='${forbidden}'`)) throw new Error(`Persistent chat API unexpectedly exposed: ${forbidden}`);
}
if(!server.includes("const ACCOUNTS_FILE = path.join(DATA_DIR, 'accounts.json')") || !server.includes('passwordHash: derivePassword(password, salt)')) throw new Error('Account-only persistence/password hash implementation missing');
if(server.includes("path.join(DATA_DIR, 'messages.json')") || fs.existsSync(path.join(root,'server/data/messages.json'))) throw new Error('Legacy persistent messages data file remains');
const build = fs.readFileSync(path.join(root,'build-termux.sh'),'utf8');
for(const required of ["versionCode='43' versionName='1.0_Beta6'",'PgmzChat-1.0_Beta6-debug.apk','apksigner','zipalign','dump badging','verify-source.sh']) if(!build.includes(required)) throw new Error(`Build validation missing: ${required}`);
const gradle=fs.readFileSync(path.join(root,'android/app/build.gradle'),'utf8');
if(!gradle.includes('versionCode 43')||!gradle.includes("versionName '1.0_Beta6'"))throw new Error('Android version does not match 1.0_Beta6');
if (!manifest.includes('android.permission.POST_NOTIFICATIONS') || !mainActivity.includes('showNotification')) throw new Error('Native notification bridge missing');
if(!js.includes('function forwardMessage')||!js.includes('async function toggleReaction')||!js.includes("'pin'")||!js.includes("'edit'"))throw new Error('Previously requested message actions missing');
if(html.includes('id="chatSettingsBtn"')||html.includes('id="chatMenuBtn"'))throw new Error('Duplicate chat-header settings/menu buttons remain');
const circleCapture=js.slice(js.indexOf('async function acquireRecordingStream(kind)'),js.indexOf('async function switchRecordingCamera()',js.indexOf('async function acquireRecordingStream(kind)')));
if(!circleCapture.includes('cameraConstraints')||!circleCapture.includes('canvas.captureStream(20)')||!circleCapture.includes('requestAnimationFrame(draw)')||!circleCapture.includes('new MediaStream([canvasTrack, ...audioStream.getAudioTracks()])'))throw new Error('Video-circle canvas capture / live camera switching path is missing');
if(!js.includes("kind === 'circle' && !stream.getVideoTracks().some(track => track.readyState === 'live')"))throw new Error('Video-circle live-track validation missing');
const switchFn=js.slice(js.indexOf('async function switchRecordingCamera()'),js.indexOf('function updateRecordingClock()'));
if(!switchFn.includes("facingMode: { exact: facing }")||!switchFn.includes('stopTracks(previous)')||!switchFn.includes('preview.srcObject = nextStream')||!switchFn.includes('state.recordingFacingMode = next'))throw new Error('Front/rear camera switching implementation missing');
if(!fs.readFileSync(path.join(client,'styles.css'),'utf8').includes('.recording-bar[data-kind=\"circle\"]{position:fixed'))throw new Error('Large centered circle recording preview styles missing');
if(!js.includes('normalizeMediaDataUrl(rawSrc')||!js.includes('blobToDataUrl(safeBlob, mediaMime)'))throw new Error('Media Data URL normalization is not connected to circle playback/recording');
if(!fs.existsSync(path.join(client,'media-utils.js'))||!js.includes("from './media-utils.js'"))throw new Error('Media normalization module missing');
const sw=fs.readFileSync(path.join(client,'sw.js'),'utf8');
if(!sw.includes('pgmzchat-client-1.0-beta6')||!sw.includes("'/media-utils.js'"))throw new Error('Service worker cache version/assets are stale');
if(!js.includes('data:image/')||!js.includes('sticker-pack'))throw new Error('Sticker pack P2P protocol missing');
console.log(`PASS: ${files.length} client files match Android assets`);
console.log(`PASS: ${idList.length} HTML IDs are unique and all static JavaScript IDs resolve`);
console.log('PASS: local-only message search and account-only server architecture');
console.log('PASS: P2P message outbox/ack, edits, reactions, pins, history controls and sticker packs');
if(!server.includes("url.pathname === '/api/auth/sessions'")||!server.includes('login_temporarily_locked'))throw new Error('Session manager or login throttling missing');
if(!html.includes('id="authGateTestBtn"')||!js.includes('async function enterTestMode()'))throw new Error('Debug sandbox mode is missing');
if(server.includes("url.pathname === '/api/auth/guest'"))throw new Error('Server guest authentication must not exist');
if(!js.includes('function encodeProfileAvatar')||!js.includes('async function runGlobalSearch()')||!js.includes("const currentServerKey = () => isSandboxActive() ? '__sandbox__' : '__p2p__';")||!js.includes('function syncContactProfileFromPeer')||!js.includes("avatar:typeof m.avatar===\'string\'"))throw new Error('Avatar/profile/split-search/sandbox isolation missing');
if(!js.includes('audioBitsPerSecond: 96000')||!js.includes('posterData'))throw new Error('Video-note audio quality/poster metadata improvement missing');
if(!js.includes('const MAX_OWNED_CHANNELS = 3')||!js.includes('function countOwnedChannels()')||!js.includes('function isRoomOwner(room)'))throw new Error('Channel ownership or three-channel limit missing');
if(!html.includes('id="p2pDownloadToggle" checked disabled')||!html.includes('id="p2pSeedToggle" checked disabled')||!js.includes('allowPeerDownload: true, allowPeerSeed: true'))throw new Error('Mandatory P2P history permissions missing');
console.log('PASS: debug-only sandbox, profile avatars, split search, fixed history permissions and channel ownership');
if(!server.includes('await import(\'pg\')') || !server.includes('CREATE TABLE IF NOT EXISTS pgmzchat_accounts') || !server.includes('CREATE TABLE IF NOT EXISTS pgmzchat_devices'))throw new Error('PostgreSQL durable-account/device storage is missing');
if(!server.includes('serveClientFile(req, res, url.pathname)') || !fs.existsSync(path.join(root,'admin/admin.html')))throw new Error('Hosted client/admin UI is missing');
console.log('PASS: optional PostgreSQL persistence and hosted browser client');
console.log('PASS: version and APK validation rules match 1.0_Beta6');
NODE
printf 'All PgmzChat 1.0_Beta6 source checks passed.\n'
