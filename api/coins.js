// ══════════════════════════════════════════════════════════════
//  MARV — COINS API  (Vercel Serverless Function)
//  Endpoint: /api/coins
//  Handles: balance check, drain (per tick), topup, get/set rates
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '09130370801Maviegr8@';
const RATES_KEY      = 'marv_drain_rates';

// ── Fallback rates if none set in Redis ──────────────────────
const DEFAULT_RATES = { video: 1.0, video_voice: 1.1 };

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

async function getDrainRates(client) {
  try {
    const raw = await client.get(RATES_KEY);
    if (raw) {
      const r = JSON.parse(raw);
      return {
        video:       parseFloat(r.video       ?? DEFAULT_RATES.video),
        video_voice: parseFloat(r.video_voice ?? DEFAULT_RATES.video_voice),
      };
    }
  } catch(_) {}
  return { ...DEFAULT_RATES };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, mode, amount, password } = req.body || {};

  const safeEmail = email ? email.trim().toLowerCase() : null;
  const coinKey   = safeEmail ? `marv_coins:${safeEmail}` : null;

  try {
    const client = getRedis();

    // ── BALANCE ──────────────────────────────────────────────
    if (action === 'balance') {
      if (!safeEmail) return res.status(400).json({ error: 'Email required' });
      const val     = await client.get(coinKey);
      const balance = val ? parseFloat(val) : 0;
      return res.status(200).json({ balance });
    }

    // ── DRAIN ────────────────────────────────────────────────
    if (action === 'drain') {
      if (!safeEmail) return res.status(400).json({ error: 'Email required' });
      const rates   = await getDrainRates(client);
      const rate    = mode === 'video_voice' ? rates.video_voice : rates.video;
      const val     = await client.get(coinKey);
      const balance = val ? parseFloat(val) : 0;

      if (balance <= 0) {
        return res.status(402).json({ error: 'Insufficient coins', balance: 0 });
      }

      const newBalance = Math.max(0, parseFloat((balance - rate).toFixed(4)));
      await client.set(coinKey, newBalance.toString());
      return res.status(200).json({ balance: newBalance, drained: rate });
    }

    // ── TOPUP ────────────────────────────────────────────────
    if (action === 'topup') {
      if (!safeEmail) return res.status(400).json({ error: 'Email required' });
      if (!amount || isNaN(amount) || amount <= 0) return res.status(400).json({ error: 'Invalid amount' });
      const val        = await client.get(coinKey);
      const balance    = val ? parseFloat(val) : 0;
      const newBalance = parseFloat((balance + parseFloat(amount)).toFixed(4));
      await client.set(coinKey, newBalance.toString());
      return res.status(200).json({ balance: newBalance });
    }

    // ── GET RATES (public — used by frontend on stream start) ─
    if (action === 'get_rates') {
      const rates = await getDrainRates(client);
      return res.status(200).json({ rates });
    }

    // ── SET RATES (admin only) ────────────────────────────────
    if (action === 'set_rates') {
      if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { video, video_voice } = req.body;
      if (video === undefined && video_voice === undefined) {
        return res.status(400).json({ error: 'At least one rate required' });
      }
      const current = await getDrainRates(client);
      const updated = {
        video:       video       !== undefined ? parseFloat(video)       : current.video,
        video_voice: video_voice !== undefined ? parseFloat(video_voice) : current.video_voice,
      };
      await client.set(RATES_KEY, JSON.stringify(updated));
      return res.status(200).json({ ok: true, rates: updated });
    }

    // ── GET FREE COINS GRANT (admin) ─────────────────────────
    if (action === 'get_free_coins') {
      if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const raw = await client.get('marv_free_coins_grant');
      return res.status(200).json({ freeCoins: raw ? parseInt(raw) : 2000 });
    }

    // ── SET FREE COINS GRANT (admin) ──────────────────────────
    if (action === 'set_free_coins') {
      if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const { freeCoins } = req.body;
      if (freeCoins === undefined || isNaN(freeCoins) || freeCoins < 0) return res.status(400).json({ error: 'Invalid freeCoins value' });
      await client.set('marv_free_coins_grant', String(parseInt(freeCoins)));
      return res.status(200).json({ ok: true, freeCoins: parseInt(freeCoins) });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Coins API error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
