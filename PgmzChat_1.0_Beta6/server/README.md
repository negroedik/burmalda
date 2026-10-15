# PgmzChat 1.0_Beta6 account/signalling server

Node.js 20+ HTTP server. If `DATABASE_URL` is set, the server initializes and uses PostgreSQL tables `pgmzchat_accounts` and `pgmzchat_devices`. If the variable is absent, the server stores the same account/device-only records in `data/accounts.json` and `data/devices.json`.

Persistent records contain only account `id`, `username`, password salt/hash and device codes/associated account IDs/ban state. Salted scrypt hashes are never exposed by the public API. Guest server auth is disabled. Session tokens, presence and signaling queues stay in RAM. Messages, rooms, contacts, media, stickers, and message search are not persisted by the server.

## Endpoints

- `GET /api/health`
- `POST /api/auth/register`, `POST /api/auth/login`
- `GET /api/auth/me`, `GET /api/auth/sessions`, `DELETE /api/auth/sessions/:id`, `POST /api/auth/logout`
- `GET /api/users/search` (exact username only)
- `POST /api/presence`
- `POST/GET /api/mesh/signals` and `/api/calls/signals`
- `GET /api/admin/devices`
- `POST /api/admin/devices/:deviceCode/ban` and `/unban`

## Local run

```sh
npm install
PGMZCHAT_ADMIN_TOKEN='use-a-long-random-secret' node server.mjs
```

`HOST` defaults to `0.0.0.0`; `PORT` defaults to 8080; `PGMZCHAT_DATA_DIR` changes JSON storage; `DATABASE_URL` enables PostgreSQL; `PGMZCHAT_DB_SSL=true` enables TLS with non-validating certificate mode for external PostgreSQL endpoints. Prefer a private/internal database connection where possible. Do not commit credentials.

In the browser open `/` to load the bundled PgmzChat client. `../client` is served only for ordinary GET/HEAD requests. API paths never fall through to static files.

## Admin HTML

Open `../admin/admin.html` as a local file on the administrator's computer. It calls the configured server over HTTPS and uses `X-Admin-Token`. The token is not stored in browser storage. Do not host the admin HTML publicly, include the token in a URL, or paste the token into client settings. CORS currently allows the local-file page to call the admin API; the token is the authorization mechanism.

## Limits

Device code is an abuse-control identifier, not trusted hardware attestation. Reinstalling/clearing app data or changing the client may produce a new code. Use HTTPS in public deployments. Sessions are RAM-only and expire on restart; presence and queued signaling also reset. The P2P client is a beta and has not undergone independent security review.
