# Roadmap

## Implemented prototype surface
- Local IndexedDB chat history and local-only search.
- Account registration/login and exact username-only lookup on the server.
- Profile display name and compressed local avatar; avatars travel with P2P message metadata.
- Debug-only local sandbox, separate from regular history; global sidebar search is for channels/precise @username while message search stays local.
- Server disk persistence limited to salted account credential records.
- RAM-only presence and WebRTC signalling.
- Peer mesh event gossip for messages, edits, reactions, pins, read markers, room invites and sticker packs.
- Local outbox plus peer delivery acknowledgements; local retention/cleanup controls; explicit opt-in for personal-chat history exchange.

## Required before calling this production-ready
1. Stable multi-peer topology and tested recovery across app/process restarts, NATs and unreliable mobile links.
2. TURN support and native Android foreground/background transport for reliable incoming delivery.
3. Cryptographically authenticated device identity and audited E2EE key establishment; signed event identities/replay protection.
4. Quotas, rate limits and memory limits for signalling, rate-limited account search, account recovery and stronger server deployment controls.
5. Multi-device/manual QA for delivery acknowledgement semantics, offline store-and-forward, group/channel membership and media backpressure.
6. Cross-platform client and protocol compatibility tests.

The server must not grow persistent message, media, group, sticker or search endpoints.
