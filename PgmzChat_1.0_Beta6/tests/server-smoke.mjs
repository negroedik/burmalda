import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = await mkdtemp(path.join(tmpdir(), 'pgmz-account-only-'));
const portServer = net.createServer();
await new Promise((resolve, reject) => portServer.listen(0, '127.0.0.1', resolve).once('error', reject));
const { port } = portServer.address();
await new Promise(resolve => portServer.close(resolve));
const base = `http://127.0.0.1:${port}`;
const adminToken = 'smoke-admin-token-secret';
const child = spawn(process.execPath, [path.join(root, 'server/server.mjs')], { env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), PGMZCHAT_DATA_DIR: dataDir, PGMZCHAT_ADMIN_TOKEN: adminToken }, stdio: ['ignore', 'pipe', 'pipe'] });
let logs = '';
child.stdout.on('data', chunk => logs += chunk.toString()); child.stderr.on('data', chunk => logs += chunk.toString());
const check = (ok, message) => { assert.ok(ok, message); console.log(`PASS: ${message}`); };
async function request(route, options={}) {
  const response = await fetch(`${base}${route}`, { ...options, headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) } });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}
async function waitForServer() {
  for (let i=0; i<100; i++) {
    if (child.exitCode !== null) throw new Error(`server exited early: ${logs}`);
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await sleep(80);
  }
  throw new Error(`server failed to start: ${logs}`);
}
try {
  await waitForServer();
  let { response, payload } = await request('/api/health');
  check(response.status===200 && payload.chatPayloadStorage===false && JSON.stringify(payload.persistentData)===JSON.stringify(['accounts.json','devices.json']) && payload.persistence==='local-json' && payload.signaling==='ephemeral-memory', 'health confirms account/device-only disk persistence and RAM-only signaling');
  const siteResponse = await fetch(`${base}/`); const siteHtml = await siteResponse.text();
  check(siteResponse.status===200 && siteResponse.headers.get('content-type')?.includes('text/html') && siteHtml.includes('1.0_Beta6'), 'root URL serves the browser messenger over the same origin');
  const assetResponse = await fetch(`${base}/app.js`);
  check(assetResponse.status===200 && assetResponse.headers.get('content-type')?.includes('javascript'), 'hosted client JavaScript asset is served with its correct MIME type');
  const traversalResponse = await fetch(`${base}/%2e%2e/server/server.mjs`);
  check(traversalResponse.status===404, 'static client handler refuses traversal outside the client directory');
  const adminFileResponse = await fetch(`${base}/admin/admin.html`);
  check(adminFileResponse.status===404, 'local administrator HTML is not published by the public chat server');
  const preflight = await fetch(`${base}/api/admin/devices`, {method:'OPTIONS',headers:{Origin:'null','Access-Control-Request-Method':'GET','Access-Control-Request-Headers':'x-admin-token'}});
  check(preflight.status===204 && preflight.headers.get('access-control-allow-origin')==='*' && /x-admin-token/i.test(preflight.headers.get('access-control-allow-headers')||''), 'local HTML admin can make a token-authenticated cross-origin request');

  const { response: aResponse, payload: aData } = await request('/api/auth/register', { method:'POST', body: JSON.stringify({ username:'smoke_user_one', password:'long-local-test-pass-1!', deviceCode:'device_code_alpha_000001', deviceLabel:'First test device' }) });
  check(aResponse.status===201 && /^u_[a-f0-9]{32}$/.test(aData.account?.id) && !!aData.token, 'register creates account and volatile login session');
  const { response: bResponse, payload: bData } = await request('/api/auth/register', { method:'POST', body: JSON.stringify({ username:'smoke_user_two', password:'long-local-test-pass-2!', deviceCode:'device_code_beta__000002', deviceLabel:'Second account device' }) });
  check(bResponse.status===201 && bData.account?.id!==aData.account.id, 'second account registration succeeds');
  ({ response, payload } = await request('/api/auth/register', { method:'POST', body: JSON.stringify({ username:'smoke_user_one', password:'long-local-test-pass-3!', deviceCode:'device_code_alpha_000001' }) }));
  check(response.status===409, 'duplicate usernames are rejected');
  ({ response } = await request('/api/auth/login', { method:'POST', body: JSON.stringify({ username:'smoke_user_one', password:'incorrect-password', deviceCode:'device_code_alpha_000001' }) }));
  check(response.status===401, 'invalid password is rejected');
  ({ response, payload } = await request('/api/auth/login', { method:'POST', body: JSON.stringify({ username:'smoke_user_one', password:'long-local-test-pass-1!', deviceCode:'device_code_alpha_000001', deviceLabel:'First test device' }) }));
  check(response.status===200 && payload.account?.id===aData.account.id, 'correct password authenticates against salted password hash');
  const firstSessionToken = aData.token;
  ({ response, payload } = await request('/api/auth/sessions', { headers:{Authorization:`Bearer ${firstSessionToken}`} }));
  check(response.status===200 && payload.sessions?.some(s=>s.current) && payload.sessions?.every(s=>!('token' in s)), 'session manager lists account sessions without exposing bearer tokens');
  const { response: secondLoginResponse, payload: secondLoginData } = await request('/api/auth/login', { method:'POST', body:JSON.stringify({username:'smoke_user_one', password:'long-local-test-pass-1!', deviceCode:'device_code_secondary_000003', deviceLabel:'Second test device'}) });
  check(secondLoginResponse.status===200 && !!secondLoginData.token, 'second device login creates a separate session');
  ({ response, payload } = await request('/api/auth/sessions', { headers:{Authorization:`Bearer ${firstSessionToken}`} }));
  const secondSession = payload.sessions?.find(s=>s.deviceLabel==='Second test device');
  check(response.status===200 && !!secondSession && payload.sessions.length>=2, 'active session list includes the second device');
  ({ response, payload } = await request(`/api/auth/sessions/${secondSession.id}`, { method:'DELETE', headers:{Authorization:`Bearer ${firstSessionToken}`} }));
  check(response.status===200 && payload.revoked===true, 'account owner can revoke another active session');
  ({ response } = await request('/api/auth/me', { headers:{Authorization:`Bearer ${secondLoginData.token}`} }));
  check(response.status===401, 'revoked session token is immediately rejected');
  for (let i=0;i<5;i++) await request('/api/auth/login', { method:'POST', body:JSON.stringify({username:'smoke_user_one', password:'wrong-password-'+i, deviceCode:'device_code_alpha_000001'}) });
  ({ response, payload } = await request('/api/auth/login', { method:'POST', body:JSON.stringify({username:'smoke_user_one', password:'long-local-test-pass-1!', deviceCode:'device_code_alpha_000001'}) }));
  check(response.status===429 && payload.error==='login_temporarily_locked', 'five failed password attempts trigger a temporary username/IP lockout');
  ({ response, payload } = await request('/api/admin/devices', { headers:{'X-Admin-Token':adminToken} }));
  check(response.status===200 && payload.devices?.some(d=>d.deviceCode==='device_code_secondary_000003'), 'admin can list persisted device codes and ban status');
  ({ response, payload } = await request('/api/admin/devices/device_code_secondary_000003/ban', { method:'POST', headers:{'X-Admin-Token':adminToken,'Content-Type':'application/json'}, body:JSON.stringify({reason:'smoke test'}) }));
  check(response.status===200 && payload.banned===true, 'admin can persist a device ban');
  ({ response, payload } = await request('/api/auth/login', { method:'POST', body:JSON.stringify({username:'smoke_user_two', password:'long-local-test-pass-2!', deviceCode:'device_code_secondary_000003'}) }));
  check(response.status===403 && payload.error==='device_banned', 'banned device cannot log in even with valid account credentials');
  ({ response, payload } = await request('/api/admin/devices/device_code_secondary_000003/unban', { method:'POST', headers:{'X-Admin-Token':adminToken,'Content-Type':'application/json'}, body:'{}' }));
  check(response.status===200 && payload.banned===false, 'admin can remove device ban');
  ({ response, payload } = await request('/api/auth/login', { method:'POST', body:JSON.stringify({username:'smoke_user_two', password:'long-local-test-pass-2!', deviceCode:'device_code_secondary_000003'}) }));
  check(response.status===200, 'unbanned device can log in again');

  ({ response } = await request('/api/users/search?q=smoke_user_two'));
  check(response.status===401, 'account search requires authentication');
  ({ response, payload } = await request('/api/users/search?q=smoke_user_two', { headers:{Authorization:`Bearer ${aData.token}`} }));
  check(response.status===200 && payload.users?.[0]?.id===bData.account.id && !('salt' in payload.users[0]) && !('passwordHash' in payload.users[0]), 'user directory returns public identity only, never password material');
  ({ response, payload } = await request('/api/users/search?q=smoke_user', { headers:{Authorization:`Bearer ${aData.token}`} }));
  check(response.status===200 && payload.users?.length===0, 'user directory requires exact username and rejects prefix matches');
  ({ response, payload } = await request('/api/users/search?q='+encodeURIComponent(bData.account.id), { headers:{Authorization:`Bearer ${aData.token}`} }));
  check(response.status===200 && payload.users?.length===0, 'user directory does not search by account ID');

  for (const [token, deviceId] of [[aData.token,'device_AAAAAAAA'],[bData.token,'device_BBBBBBBB']]) {
    ({ response, payload } = await request('/api/presence', { method:'POST', headers:{Authorization:`Bearer ${token}`}, body:JSON.stringify({deviceId,roomIds:['global']}) }));
    check(response.status===200 && payload.online===true, `presence registers ${deviceId} in RAM`);
  }
  ({ response, payload } = await request('/api/presence', { method:'POST', headers:{Authorization:`Bearer ${aData.token}`}, body:JSON.stringify({deviceId:'device_AAAAAAAA',roomIds:['global']}) }));
  check(payload.peers?.some(p=>p.deviceId==='device_BBBBBBBB'), 'presence discovery shares online peer routing metadata only');

  ({ response } = await request('/api/mesh/signals', { method:'POST', headers:{Authorization:`Bearer ${aData.token}`}, body:JSON.stringify({fromId:'device_AAAAAAAA',toId:'device_BBBBBBBB',callId:'mesh-smoke',signal:{type:'mesh-offer',roomId:'global',description:{type:'offer',sdp:'EPHEMERAL_SIGNAL_SENTINEL'}}}) }));
  check(response.status===201, 'authenticated WebRTC signaling is accepted into volatile queue');
  ({ response, payload } = await request('/api/mesh/signals?deviceId=device_BBBBBBBB&after=0', { headers:{Authorization:`Bearer ${bData.token}`} }));
  check(response.status===200 && payload.signals?.some(s=>s.signal?.description?.sdp==='EPHEMERAL_SIGNAL_SENTINEL'), 'recipient can retrieve transient WebRTC signaling');

  for (const route of ['/api/messages','/api/rooms','/api/contacts','/api/media','/media/test.bin','/api/stickers','/api/search/messages']) {
    ({ response } = await request(route));
    check(response.status===404, `${route} is not a persistent server API`);
  }


  const entries = (await readdir(dataDir)).sort();
  check(entries.join(',')==='accounts.json,devices.json', 'server data directory stores only account records and device-code/ban registry');
  const raw = await readFile(path.join(dataDir,'accounts.json'),'utf8');
  const rawDevices = await readFile(path.join(dataDir,'devices.json'),'utf8');
  const devices = JSON.parse(rawDevices);
  check(devices.length>=3 && devices.every(d=>typeof d.deviceCode==='string' && typeof d.banned==='boolean'), 'device registry persists device codes and ban state');
  const accounts = JSON.parse(raw);
  check(accounts.length===2 && accounts.every(a=>Object.keys(a).sort().join(',')==='id,passwordHash,salt,username'), 'persistent accounts contain only ID, username, salt and password hash; test accounts are never persisted');
  check(!raw.includes('long-local-test-pass') && !raw.includes('EPHEMERAL_SIGNAL_SENTINEL'), 'passwords and signaling payloads are not persisted in accounts file');
  check(!rawDevices.includes('EPHEMERAL_SIGNAL_SENTINEL') && !rawDevices.includes('long-local-test-pass'), 'device registry contains no chat payloads or passwords');
  console.log('All account/device-only server smoke tests passed.');
} catch (error) {
  console.error(error?.stack || String(error));
  console.error(logs);
  process.exitCode=1;
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit',resolve)), sleep(1200)]);
  await rm(dataDir,{recursive:true,force:true});
}
