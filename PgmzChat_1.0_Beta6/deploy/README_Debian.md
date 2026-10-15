# Debian server deployment (account-only)

Run the Node.js account/signalling service behind HTTPS. The application persists only `server/data/accounts.json` (account IDs/usernames and salted password hashes) plus `server/data/devices.json` (device codes, associated account IDs and ban state). Presence and WebRTC signaling are volatile RAM-only; all message and media content is sent peer-to-peer and is not accepted by the server API.

For a basic setup, install a supported Node.js version, copy the project to `/opt/pgmzchat`, set the systemd working directory and `PORT`, and configure the supplied Nginx example for HTTPS. Restrict file permissions on `server/data/accounts.json` and back it up encrypted. Do not expose HTTP in production.

The prototype uses STUN-only WebRTC and has no TURN relay; connections may fail on some mobile networks. Before public operation add operating-system hardening, log retention policy, request limits, monitoring, backups and an independent security review.

## Device-ban administration

Create `/etc/pgmzchat.env` with mode `0600` and a high-entropy `PGMZCHAT_ADMIN_TOKEN` value. The supplied systemd unit loads this file. After restarting the service, use `GET /api/admin/devices` with the `X-Admin-Token` header to list devices. Use `POST /api/admin/devices/{deviceCode}/ban` with JSON `{'reason':'spam'}` to ban a code, or `/unban` with `{}` to reverse it. Keep the token server-side and use HTTPS; never put it in the Android client.
