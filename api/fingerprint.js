// ══════════════════════════════════════════════════════════════
//  MARV — Fingerprint API  (Vercel Serverless Function)
//  Endpoint: /api/fingerprint
//  Uses: ioredis via REDIS_URL environment variable
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

let redis;
function getRedis() {
  if (!redis) {
    const url = process.env.REDIS_URL;
    // Vercel Redis URLs starting with rediss:// need TLS
    redis = new Redis(url);
  }
  return redis;
}

export default async function handler(req, res) {

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { action, email, fingerprint } = req.body || {};

  if (!action || !email || !fingerprint) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const safeEmail = email.trim().toLowerCase().replace(/[^a-z0-9@._-]/g, '');
  const key       = `marv_fp:${safeEmail}`;

  try {
    const client = getRedis();

    if (action === 'check') {
      const stored = await client.get(key);
      if (!stored)                return res.status(200).json({ status: 'new' });
      if (stored === fingerprint) return res.status(200).json({ status: 'match' });
      return res.status(200).json({ status: 'mismatch' });
    }

    if (action === 'register') {
      await client.set(key, fingerprint);
      return res.status(200).json({ status: 'registered' });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Redis error:', err.message);
    return res.status(500).json({ error: 'Database error', detail: err.message });
  }
}