## 1.0_ALPHA1

- Added an Android foreground service with an ongoing, low-noise notification to keep the app process active for background P2P connections.
- Presence refresh and WebRTC signaling polling continue while the client is backgrounded.
- Smoothed page-entry motion slightly; existing reduced-motion settings remain respected.
- Preserved the P2P-only message architecture: the server does not queue or persist chat payloads, so messages cannot be delivered while the recipient device/app is actually offline or force-stopped.
- Bumped Android version to `1.0_ALPHA1` / `versionCode 44`, retaining `applicationId com.pgmzchat.app`, SDK 34, and same-app update compatibility.

## 1.0_Beta6

- Added a single-origin hosted browser client; opening the server root serves the PgmzChat web app over HTTPS.
- Added optional PostgreSQL storage for account hashes and device ban registry; local JSON persistence remains the default without `DATABASE_URL`.
- Added an offline HTML administrator panel for listing devices and managing device bans. The admin token is entered at runtime and is not persisted by the panel.
- Added a Render Blueprint with a free web service and temporary free PostgreSQL database, a container recipe, and deployment instructions.
- Bumped Android display version to `1.0_Beta6` / `versionCode 43`; preserved `applicationId` and SDK 34 compatibility.
- Added admin HTML and same-origin static-serving checks.

## 1.0_Beta5

- P2P history receive/share permissions are always on and no longer switchable in the UI. The sender still must approve each history-transfer request.
- Channel creator identity is stored as stable account metadata and included when channel metadata is shared over P2P; channels remain creator-owned for publishing and inviting.
- Enforced a limit of three owned channels in the locally known channel list. The server continues not to persist channel metadata, so this limit is client-side, not authoritative across devices.
- Bumped versionCode to 42 and versionName to `1.0_Beta5`; preserved `applicationId` and SDK 34 compatibility.

## 1.0_Beta4

- Added offline demo sandbox for Android debug builds only; release builds hide/disable it and the server no longer offers guest authentication.
- Isolated sandbox profile, contacts, rooms and message history from normal P2P-local storage.
- Added simulated local replies so message composition and message rendering can be tested without an IP address or network connection.
- Added local avatar upload, size reduction and avatar rendering in profile, contacts and message rows.
- Separated local message search from the sidebar search. The sidebar searches channel names and exact `@username`; server lookup no longer matches prefixes or IDs.
- Bumped versionCode to 41 while preserving applicationId and Android SDK 34 compatibility.

## 1.0_Beta2

- Added an active-session manager with per-device revocation.
- Removed server guest/test accounts; registered accounts are required for server signaling.
- Added a 15-minute cooldown after repeated failed login attempts for the same username and IP.
- Added 1×/1.5×/2× playback speed controls for voice notes and video circles.
- Raised video-note audio capture bitrate to 96 kbit/s, enabled preferred echo cancellation/noise suppression/automatic gain control, and added compact circular JPEG posters that travel with P2P message metadata and render before playback.
- Bumped versionCode to 39; kept applicationId stable and Android SDK 34 compatibility.

# Changelog

## 1.0-prerelease-A
- Fixed front/rear camera switching by releasing the active camera stream before opening the other lens, which is required on many Android WebView camera stacks.
- Added a recovery attempt to restore the previous camera if switching fails; the canvas recording track remains stable.
- Bumped versionCode to 37 so this installs as an update.


## 1.0 prerelease A
- Fixed recording crash: replaced undefined `sleep()` calls with the existing `meshSleep()` helper.
- Bumped versionCode to 36 / versionName to `1.0-prerelease-A` so this build installs as an update.

## 1.0 prerelease 8
- Replaced the tiny corner video-note preview with a large, centered circular live preview and recording controls.
- Restored in-recording front/rear camera switching using a stable canvas video track, so MediaRecorder can keep recording while the live source changes.
- Waits for camera frames and paints a real frame before recording to reduce black/empty circle clips on Android WebView.
- Synced the web client with Android assets and bumped versionCode to 35 / versionName to 1.0-prerelease-8.


## 1.0 prerelease 7
- Fixed malformed video/audio Data URLs caused by codec parameters containing commas (for example `video/webm;codecs=vp8,opus`).
- New recordings and cached media are written using a canonical MIME type without codec parameters.
- Video playback repairs legacy malformed local Data URLs in-place, so old locally saved circles can be opened without deleting chat history.
- Peer-history media transfer now normalizes old Data URLs before splitting base64 payloads.
- Added regression tests for the malformed URL, the legacy repair path, images, and ordinary URLs.
- Bumped Android versionCode to 34 / versionName to 1.0-prerelease-7.

## 1.0 prerelease 6
- Removed duplicate chat-header settings and overflow/menu buttons; the global top bar remains the single entry point.
- Reworked video-circle capture to record a direct camera track instead of canvas-copied frames, with simpler getUserMedia retries for Android WebView camera compatibility.
- Added live audio/video track validation before recording and rejects empty/non-video circle outputs with a useful error.
- Bumped versionCode to 33 and synchronized Android assets/build validation to 1.0-prerelease-6.
- Fullscreen media viewing and previous P2P/account-only architecture retained.



## 1.0 prerelease 6
- Enforced accounts-only disk persistence: account ID, username, salt, scrypt password hash. Old records are projected onto this allowed schema when loaded.
- Presence and WebRTC signalling are volatile in-memory state; removed legacy `server/data/messages.json`.
- P2P WebRTC DataChannel mesh transports messages and chat events without server message/media APIs. Added per-message delivery acknowledgements and retained outgoing items locally until a peer confirms persistence.
- Local IndexedDB search remains device-only.
- Room metadata, contacts, stickers, media, reactions, pins, reads and edits are client-local and gossiped to peers.
- Build script now checks source tests and expects versionCode 33 / 1.0-prerelease-6.

## Known prerelease limitations
- The mesh is gossip-based, not a BitTorrent DHT; delivery is best-effort and requires online app instances for discovery/signalling.
- STUN only; TURN is not configured. Background delivery is not guaranteed.
- Multi-device identity verification, robust E2EE key management/signatures, full account-recovery and server abuse hardening remain incomplete.


## 1.0_Beta2 device bans
- Persistent `devices.json` now stores app/device codes, account associations and ban status only.
- Admin API protected with `PGMZCHAT_ADMIN_TOKEN` supports listing, banning and unbanning device codes.
- Android derives a stable app-scoped device code; browsers fall back to a locally persisted code.
- Server still keeps chat payloads off disk; presence and WebRTC signalling remain volatile RAM data.
