// ══════════════════════════════════════════════════════════════
//  MARV — USER CHECK + HEARTBEAT API  (Vercel Serverless Function)
//  Endpoint: /api/usercheck
//  Handles: login, session boot, heartbeat (merged to save function slots)
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const USERS_KEY          = 'marv_users';
const FREE_COINS_KEY     = 'marv_free_coins_grant';
const DEFAULT_FREE_COINS = 2000;
const HEARTBEAT_PREFIX   = 'marv_hb:';

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { email, password, sessionOnly, action } = req.body || {};

  // ── HEARTBEAT ────────────────────────────────────────────────
  if (action === 'heartbeat') {
    if (!email) return res.status(400).json({ error: 'Email required' });
    const safeEmail = email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
    try {
      const client = getRedis();
      await client.set(`${HEARTBEAT_PREFIX}${safeEmail}`, Date.now().toString(), 'EX', 60);
      return res.status(200).json({ ok: true });
    } catch(err) {
      return res.status(500).json({ error: 'Database error' });
    }
  }

  if (!email) return res.status(400).json({ error: 'Email required' });
  const safeEmail = email.trim().toLowerCase();

  try {
    const client = getRedis();
    const raw    = await client.get(USERS_KEY);
    const users  = raw ? JSON.parse(raw) : [];

    // ── SESSION BOOT CHECK ───────────────────────────────────
    if (sessionOnly) {
      const exists = users.some(u => u.email === safeEmail);
      return res.status(200).json({ exists });
    }

    // ── LOGIN CHECK ──────────────────────────────────────────
    const user = users.find(u => u.email === safeEmail && u.password === password);
    if (!user) return res.status(200).json({ found: false });

    // ── FIRST LOGIN: grant free coins ────────────────────────
    let firstLogin   = false;
    let coinsGranted = 0;

    const firstLoginKey  = `marv_first_login:${safeEmail}`;
    const alreadyGranted = await client.get(firstLoginKey);

    if (!alreadyGranted) {
      await client.set(firstLoginKey, '1');
      const freeCoinsRaw     = await client.get(FREE_COINS_KEY);
      const FREE_COINS_GRANT = freeCoinsRaw ? parseInt(freeCoinsRaw) : DEFAULT_FREE_COINS;
      const coinKey          = `marv_coins:${safeEmail}`;
      const val              = await client.get(coinKey);
      const balance          = val ? parseFloat(val) : 0;
      const newBalance       = parseFloat((balance + FREE_COINS_GRANT).toFixed(4));
      await client.set(coinKey, newBalance.toString());
      firstLogin   = true;
      coinsGranted = FREE_COINS_GRANT;
    }

    return res.status(200).json({ found: true, email: user.email, firstLogin, coinsGranted });

  } catch (err) {
    console.error('Usercheck error:', err.message);
    return res.status(500).json({ error: 'Database error' });
  }
}
