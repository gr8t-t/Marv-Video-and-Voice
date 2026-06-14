// ══════════════════════════════════════════════════════════════
//  MARV — ADMIN API  (updated to include get_revenue action)
//  Drop this file in as a REPLACEMENT for api/admin.js
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const ADMIN_PASSWORD   = process.env.ADMIN_PASSWORD || '09130370801Maviegr8@';
const USERS_KEY        = 'marv_users';
const HEARTBEAT_PREFIX = 'marv_hb:';
const REVENUE_KEY      = 'marv_revenue';

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

function generatePassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const seg = (n) => Array.from({ length: n }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `MARV-${seg(4)}-${seg(4)}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { action, password, email, label } = req.body || {};
  if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });

  const client = getRedis();

  try {
    async function loadUsers() { const raw = await client.get(USERS_KEY); return raw ? JSON.parse(raw) : []; }
    async function saveUsers(u) { await client.set(USERS_KEY, JSON.stringify(u)); }

    if (action === 'list') {
      const users = await loadUsers();
      const now   = Date.now();
      const result = await Promise.all(users.map(async (u) => {
        let online = false, lastSeen = 0;
        try { const hb = await client.get(`${HEARTBEAT_PREFIX}${u.email}`); lastSeen = hb ? parseInt(hb) : 0; online = (now - lastSeen) < 35000; } catch(_) {}
        return { ...u, online, lastSeen };
      }));
      return res.status(200).json({ users: result });
    }

    if (action === 'add') {
      if (!email) return res.status(400).json({ error: 'Email required' });
      const safeEmail = email.trim().toLowerCase();
      const users     = await loadUsers();
      if (users.find(u => u.email === safeEmail)) return res.status(409).json({ error: 'User already exists' });
      const newUser = { email: safeEmail, password: generatePassword(), label: label ? label.trim() : safeEmail, createdAt: Date.now() };
      users.push(newUser); await saveUsers(users);
      return res.status(200).json({ user: newUser });
    }

    if (action === 'remove') {
      if (!email) return res.status(400).json({ error: 'Email required' });
      const safeEmail = email.trim().toLowerCase();
      let users = await loadUsers();
      const before = users.length;
      users = users.filter(u => u.email !== safeEmail);
      if (users.length === before) return res.status(404).json({ error: 'User not found' });
      await saveUsers(users);
      try { await client.del(`marv_fp:${safeEmail}`); }           catch(_) {}
      try { await client.del(`${HEARTBEAT_PREFIX}${safeEmail}`); } catch(_) {}
      return res.status(200).json({ ok: true });
    }

    if (action === 'reset_fp') {
      if (!email) return res.status(400).json({ error: 'Email required' });
      const safeEmail = email.trim().toLowerCase();
      try { await client.del(`marv_fp:${safeEmail}`); } catch(_) {}
      return res.status(200).json({ ok: true });
    }

    // ── GET REVENUE LOG ───────────────────────────────────────
    if (action === 'get_revenue') {
      const raw = await client.get(REVENUE_KEY);
      const log = raw ? JSON.parse(raw) : [];
      return res.status(200).json({ revenue: log });
    }

    return res.status(400).json({ error: 'Unknown action' });
  } catch (err) {
    console.error('Admin API error:', err.message);
    return res.status(500).json({ error: 'Database error', detail: err.message });
  }
}
