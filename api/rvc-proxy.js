// ══════════════════════════════════════════════════════════════
//  MARV — RVC PROXY API  (Vercel Serverless Function)
//  Endpoint: /api/rvc-proxy
//  Proxies all RVC server calls so browser never hits ngrok directly
//  Fixes CORS issues with ngrok free plan
// ══════════════════════════════════════════════════════════════

const EXTERNAL_URL = process.env.RVC_EXTERNAL_URL || null;

async function getRvcUrl() {
  // Try PC first
  if (EXTERNAL_URL) {
    try {
      const res = await fetch(`${EXTERNAL_URL}/health`, {
        signal: AbortSignal.timeout(4000),
        headers: { 'ngrok-skip-browser-warning': 'true', 'User-Agent': 'MARV-Server/1.0' },
      });
      if (res.ok) return EXTERNAL_URL;
    } catch(e) {}
  }
  // Try RunPod from Redis
  try {
    const { default: Redis } = await import('ioredis');
    const client = new Redis(process.env.REDIS_URL);
    const podId  = await client.get('marv_active_pod_id') || process.env.RUNPOD_POD_ID;
    await client.quit();
    if (podId) {
      const apiKey = process.env.RUNPOD_API_KEY;
      const query  = `query { pod(input: {podId: "${podId}"}) { runtime { ports { ip isIpPublic publicPort privatePort } } } }`;
      const res    = await fetch(`https://api.runpod.io/graphql?api_key=${apiKey}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      const ports = data?.data?.pod?.runtime?.ports || [];
      const port  = process.env.RVC_SERVER_PORT || '7865';
      const pub   = ports.find(p => String(p.privatePort) === port && p.isIpPublic);
      if (pub) return `http://${pub.ip}:${pub.publicPort}`;
    }
  } catch(e) {}
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { action } = req.body || {};

  try {
    const rvcUrl = await getRvcUrl();

    if (!rvcUrl) {
      return res.status(503).json({ error: 'Voice server is currently offline.' });
    }

    // ── LOAD MODEL ────────────────────────────────────────────
    if (action === 'load_model') {
      const { voice_id, pth_url, index_url } = req.body;
      const upstream = await fetch(`${rvcUrl}/load-model`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ voice_id, pth_url, index_url }),
      });
      const data = await upstream.json();
      return res.status(upstream.status).json(data);
    }

    // ── HEALTH ────────────────────────────────────────────────
    if (action === 'health') {
      return res.status(200).json({ ok: true, url: rvcUrl });
    }

    // ── GET WS URL (returns WebSocket URL for client) ─────────
    if (action === 'get_ws_url') {
      const wsUrl = rvcUrl.replace(/^http/, 'ws') + '/convert';
      return res.status(200).json({ wsUrl });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch(err) {
    console.error('RVC proxy error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
