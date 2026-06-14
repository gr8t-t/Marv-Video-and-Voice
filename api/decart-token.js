// ══════════════════════════════════════════════════════════════
//  MARV — FAL.AI TOKEN API  (Vercel Serverless Function)
//  Endpoint: /api/decart-token
//  POST { email } → checks coins, returns short-lived JWT
//                   for direct WebSocket connection to fal.ai
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const USERS_KEY = 'marv_users';

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

async function getFalJwt(apiKey) {
  const res = await fetch('https://rest.alpha.fal.ai/tokens/realtime', {
    method: 'POST',
    headers: {
      'Authorization': `Key ${apiKey}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      app:      'decart/lucy-realtime-2',
      duration: 300,
    }),
  });

  const text = await res.text();
  console.log(`fal.ai token response [${res.status}]:`, text);

  if (!res.ok) {
    throw new Error(`fal token error ${res.status}: ${text}`);
  }

  try {
    const data  = JSON.parse(text);
    const token = data.token || data.jwt || (typeof data === 'string' ? data : null);
    if (!token) throw new Error(`No token in fal.ai response: ${text}`);
    return token;
  } catch (e) {
    if (e.message.includes('No token')) throw e;
    const token = text.trim();
    if (!token) throw new Error('Empty token from fal.ai');
    return token;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-fal-target-url');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FAL_API_KEY not configured in Vercel environment variables' });

  // ── FAL PROXY (detected by x-fal-target-url header) ────────
  const targetUrl = req.headers['x-fal-target-url'];
  if (targetUrl) {
    try {
      const falRes = await fetch(targetUrl, {
        method:  req.method,
        headers: {
          'Authorization': `Key ${apiKey}`,
          'Content-Type':  req.headers['content-type'] || 'application/json',
        },
        body: req.method !== 'GET' ? JSON.stringify(req.body) : undefined,
      });
      const contentType = falRes.headers.get('content-type') || '';
      res.status(falRes.status);
      if (contentType.includes('application/json')) return res.json(await falRes.json());
      return res.send(await falRes.text());
    } catch (err) {
      return res.status(500).json({ error: 'Proxy error', detail: err.message });
    }
  }

  // ── STANDARD REQUEST: verify user + return JWT ──────────────
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'Email required' });

  const safeEmail = email.trim().toLowerCase();

  try {
    const client  = getRedis();
    const raw     = await client.get(USERS_KEY);
    const users   = raw ? JSON.parse(raw) : [];
    const user    = users.find(u => u.email === safeEmail);

    if (!user) return res.status(403).json({ error: 'User not found' });

    const coinKey = `marv_coins:${safeEmail}`;
    const coins   = await client.get(coinKey);
    const balance = coins ? parseFloat(coins) : 0;

    if (balance <= 0) {
      return res.status(402).json({ error: 'Insufficient coins', balance: 0 });
    }

    let falToken;
    try {
      falToken = await getFalJwt(apiKey);
    } catch (e) {
      console.error('JWT fetch failed:', e.message);
      return res.status(500).json({ error: 'fal.ai token error', detail: e.message });
    }

    return res.status(200).json({ falToken, balance });

  } catch (err) {
    console.error('Fal token handler error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
