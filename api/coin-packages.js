// ══════════════════════════════════════════════════════════════
//  MARV — COIN PACKAGES API  (Vercel Serverless Function)
//  Endpoint: /api/coin-packages
//  Admin: create/update/delete packages
//  Users: list available packages
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const PACKAGES_KEY   = 'marv_coin_packages';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '09130370801Maviegr8@';

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

  const { action, password } = req.body || {};

  try {
    const client = getRedis();

    async function loadPackages() {
      const raw = await client.get(PACKAGES_KEY);
      return raw ? JSON.parse(raw) : [];
    }
    async function savePackages(pkgs) {
      await client.set(PACKAGES_KEY, JSON.stringify(pkgs));
    }

    // ── PUBLIC: list packages ────────────────────────────
    if (action === 'list') {
      const pkgs = await loadPackages();
      return res.status(200).json({ packages: pkgs.filter(p => p.active !== false) });
    }

    // ── ADMIN ONLY below ─────────────────────────────────
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── ADMIN: list all (including inactive) ─────────────
    if (action === 'list_all') {
      return res.status(200).json({ packages: await loadPackages() });
    }

    // ── ADMIN: add package ────────────────────────────────
    if (action === 'add') {
      const { name, coins, priceNaira, priceUsd, popular } = req.body;
      if (!name || !coins || !priceNaira) {
        return res.status(400).json({ error: 'name, coins, priceNaira required' });
      }
      const pkgs = await loadPackages();
      const pkg  = {
        id:         `pkg_${Date.now()}`,
        name:       name.trim(),
        coins:      parseInt(coins),
        priceNaira: parseInt(priceNaira),
        priceUsd:   priceUsd ? parseFloat(priceUsd) : null,
        popular:    popular === true || popular === 'true',
        active:     true,
        createdAt:  Date.now(),
      };
      pkgs.push(pkg);
      await savePackages(pkgs);
      return res.status(200).json({ package: pkg });
    }

    // ── ADMIN: update package ─────────────────────────────
    if (action === 'update') {
      const { id, name, coins, priceNaira, popular, active } = req.body;
      if (!id) return res.status(400).json({ error: 'Package id required' });
      const pkgs = await loadPackages();
      const pkg  = pkgs.find(p => p.id === id);
      if (!pkg) return res.status(404).json({ error: 'Package not found' });

      if (name       !== undefined) pkg.name       = name.trim();
      if (coins      !== undefined) pkg.coins      = parseInt(coins);
      if (priceNaira !== undefined) pkg.priceNaira = parseInt(priceNaira);
      if (popular    !== undefined) pkg.popular    = popular === true || popular === 'true';
      if (active     !== undefined) pkg.active     = active === true || active === 'true';

      await savePackages(pkgs);
      return res.status(200).json({ package: pkg });
    }

    // ── ADMIN: remove package ─────────────────────────────
    if (action === 'remove') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Package id required' });
      let pkgs = await loadPackages();
      pkgs     = pkgs.filter(p => p.id !== id);
      await savePackages(pkgs);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Coin packages error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
