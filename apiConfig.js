// apiConfig.js — the SINGLE source of truth for every backend host in the app.
//
// EDIT ONE LINE to test against your LAN box, and KEEP THAT EDIT UNCOMMITTED:
// flip `ENV` from 'prod' to 'local'. Every fetch / cookie / socket in the app
// derives its host from here, so you never hand-edit a URL inside a screen again.
//
// The COMMITTED value MUST stay 'prod'. Guard it in review with:
//   grep -rn "192.168" --include='*.js' . | grep -v node_modules   # must be empty
//   node -e "if(require('./apiConfig').IS_LOCAL) process.exit(1)"   # must pass
//
// Note the two hosts differ by more than a hostname: prod serves the API under
// a `/rpm-be` path and the socket at the bare origin, while the LAN box serves
// both at its root. So each env carries its full api/socket roots explicitly
// rather than deriving one from the other.

const ENV = 'prod'; // 'prod' | 'local'  — committed value MUST be 'prod'

const HOSTS = {
  prod:  { api: 'https://rmtrpm.duckdns.org/rpm-be', socket: 'https://rmtrpm.duckdns.org' },
  local: { api: 'http://192.168.1.15:4000',          socket: 'http://192.168.1.15:4000' },
};

const H = HOSTS[ENV] || HOSTS.prod; // an unknown ENV degrades to prod, never LAN

// Auth, care-team, refresh, logout, check-me — everything under the API root.
export const API_BASE = H.api;
// Device-data ingest + vitals reads (the outbox POSTs and the latest/history GETs).
export const DEV_DATA_BASE = `${H.api}/api/dev-data`;
// Patient <-> clinician chat REST.
export const MESSAGES_BASE = `${H.api}/api/messages`;
// socket.io connects to the bare origin, not the API path.
export const SOCKET_BASE = H.socket;

export const IS_LOCAL = ENV === 'local';
