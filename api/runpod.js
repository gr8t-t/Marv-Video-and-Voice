// ══════════════════════════════════════════════════════════════
//  MARV — RVC SERVER API  (Vercel Serverless Function)
//  Endpoint: /api/runpod
//  Priority:
//    1. RVC_EXTERNAL_URL (your PC via ngrok) — checked first
//    2. RunPod pod — fallback if PC is offline
//    3. Auto-creates fallback pod if RunPod pod unavailable
//
//  ⚙️  Vercel environment variables:
//       RVC_EXTERNAL_URL  = https://your-ngrok-url.ngrok-free.app
//       RUNPOD_API_KEY    = your RunPod API key
//       RUNPOD_POD_ID     = your pod ID (fallback)
//       RVC_SERVER_PORT   = 7865
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const POD_ID_KEY     = 'marv_active_pod_id';
const RVC_PORT       = process.env.RVC_SERVER_PORT || '7865';
const EXTERNAL_URL   = process.env.RVC_EXTERNAL_URL || null;

const FALLBACK_GPUS = [
  'RTX A4000', 'RTX A4500', 'RTX 4090', 'RTX A5000',
  'RTX A6000', 'L40', 'A40', 'RTX 3090',
];

const POD_IMAGE = 'runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04';
const START_CMD = 'bash -c "cd /workspace && [ ! -d rvc ] && git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI rvc && cd rvc && pip install -r requirements.txt -q && pip install fastapi uvicorn python-multipart websockets -q; python /workspace/rvc_server.py"';

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

const GRAPHQL = `https://api.runpod.io/graphql?api_key=${process.env.RUNPOD_API_KEY}`;

async function gql(query) {
  const res = await fetch(GRAPHQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  return res.json();
}

// ── Check if a URL is reachable ───────────────────────────────
async function checkHealth(url) {
  try {
    const res = await fetch(`${url}/health`, {
      signal: AbortSignal.timeout(4000),
      headers: {
        'ngrok-skip-browser-warning': 'true',
        'User-Agent': 'MARV-Server/1.0',
      },
    });
    return res.ok;
  } catch(e) {
    return false;
  }
}

// ── RunPod helpers ────────────────────────────────────────────
async function getActivePodId(client) {
  const fromRedis = await client.get(POD_ID_KEY);
  return fromRedis || process.env.RUNPOD_POD_ID || null;
}

async function getPodStatus(podId) {
  if (!podId) return null;
  try {
    const data = await gql(`query { pod(input: {podId: "${podId}"}) { id desiredStatus runtime { uptimeInSeconds ports { ip isIpPublic publicPort privatePort type } } } }`);
    return data?.data?.pod || null;
  } catch(e) { return null; }
}

function getRvcUrl(pod) {
  if (!pod?.runtime?.ports) return null;
  const pub = pod.runtime.ports.find(p => String(p.privatePort) === RVC_PORT && p.isIpPublic);
  return pub ? `http://${pub.ip}:${pub.publicPort}` : null;
}

async function resumePod(podId) {
  try {
    const data = await gql(`mutation { podResume(input: {podId: "${podId}", gpuCount: 1}) { id desiredStatus } }`);
    return data?.data?.podResume || null;
  } catch(e) { return null; }
}

async function stopPod(podId) {
  try {
    await gql(`mutation { podStop(input: {podId: "${podId}"}) { id desiredStatus } }`);
  } catch(e) {}
}

async function createFallbackPod() {
  for (const gpu of FALLBACK_GPUS) {
    try {
      const mutation = `
        mutation {
          podFindAndDeployOnDemand(input: {
            name: "marv-rvc",
            imageName: "${POD_IMAGE}",
            gpuTypeId: "${gpu}",
            cloudType: SECURE,
            gpuCount: 1,
            volumeInGb: 40,
            containerDiskInGb: 20,
            ports: "${RVC_PORT}/tcp,8888/http",
            startJupyter: true,
            startSsh: true,
            startCommand: "${START_CMD}",
          }) { id }
        }`;
      const data = await gql(mutation);
      const newPodId = data?.data?.podFindAndDeployOnDemand?.id;
      if (newPodId) return newPodId;
    } catch(e) {}
  }
  return null;
}

// ══════════════════════════════════════════════════════════════
//  HANDLER
// ══════════════════════════════════════════════════════════════
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  const { action, email } = req.body || {};

  try {
    const client = getRedis();

    // ── STATUS ────────────────────────────────────────────────
    if (action === 'status') {
      // Check PC first
      if (EXTERNAL_URL) {
        const pcOnline = await checkHealth(EXTERNAL_URL);
        if (pcOnline) return res.status(200).json({ running: true, url: EXTERNAL_URL, source: 'pc' });
      }
      // Check RunPod
      const podId = await getActivePodId(client);
      const pod   = await getPodStatus(podId);
      const isRunning = pod?.desiredStatus === 'RUNNING' && pod?.runtime;
      return res.status(200).json({ running: !!isRunning, url: isRunning ? getRvcUrl(pod) : null, source: 'runpod' });
    }

    // ── WAKE ──────────────────────────────────────────────────
    if (action === 'wake') {
      if (!email) return res.status(400).json({ error: 'Email required' });
      const safeEmail = email.trim().toLowerCase();
      await client.set(`marv_voice_active:${safeEmail}`, Date.now().toString(), 'EX', 90);

      // 1. Check if PC is online first
      if (EXTERNAL_URL) {
        const pcOnline = await checkHealth(EXTERNAL_URL);
        if (pcOnline) {
          return res.status(200).json({ status: 'running', url: EXTERNAL_URL, source: 'pc' });
        }
      }

      // 2. PC offline — try RunPod
      const podId = await getActivePodId(client);
      const pod   = await getPodStatus(podId);

      // RunPod already running
      if (pod?.desiredStatus === 'RUNNING' && pod?.runtime) {
        const url = getRvcUrl(pod);
        return res.status(200).json({ status: 'running', url, source: 'runpod' });
      }

      // Try resuming RunPod pod
      if (podId) {
        const result = await resumePod(podId);
        if (result?.desiredStatus === 'RUNNING' || result?.id) {
          return res.status(200).json({ status: 'starting', url: null, eta: 90, source: 'runpod' });
        }
      }

      // RunPod pod failed — create new one
      const newPodId = await createFallbackPod();
      if (newPodId) {
        await client.set(POD_ID_KEY, newPodId);
        return res.status(200).json({ status: 'starting', url: null, eta: 120, source: 'runpod' });
      }

      // Everything failed — voice unavailable
      return res.status(503).json({ error: 'Voice conversion is currently unavailable. Please try again later.' });
    }

    // ── POLL ──────────────────────────────────────────────────
    if (action === 'poll') {
      // Check PC first
      if (EXTERNAL_URL) {
        const pcOnline = await checkHealth(EXTERNAL_URL);
        if (pcOnline) return res.status(200).json({ ready: true, url: EXTERNAL_URL, source: 'pc' });
      }
      // Check RunPod
      const podId = await getActivePodId(client);
      const pod   = await getPodStatus(podId);
      if (!pod) return res.status(200).json({ ready: false });
      const isRunning = pod.desiredStatus === 'RUNNING' && pod.runtime;
      if (!isRunning) return res.status(200).json({ ready: false });
      const url = getRvcUrl(pod);
      if (url) {
        const healthy = await checkHealth(url);
        if (healthy) return res.status(200).json({ ready: true, url, source: 'runpod' });
      }
      return res.status(200).json({ ready: false });
    }

    // ── SLEEP ─────────────────────────────────────────────────
    if (action === 'sleep') {
      if (!email) return res.status(400).json({ error: 'Email required' });
      const safeEmail = email.trim().toLowerCase();
      await client.del(`marv_voice_active:${safeEmail}`);
      const keys = await client.keys('marv_voice_active:*');
      // Only stop RunPod if no active users — never stop PC
      if (keys.length === 0) {
        const podId = await getActivePodId(client);
        if (podId) await stopPod(podId);
      }
      return res.status(200).json({ ok: true, activeUsers: keys.length });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('RVC API error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
