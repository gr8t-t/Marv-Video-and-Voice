// ══════════════════════════════════════════════════════════════
//  MARV — VOICE REQUEST API  (Vercel Serverless Function)
//  Endpoint: /api/voice-request
//  User submits a voice training request + audio sample URL
//  Admin gets notified via Telegram
//
//  ⚙️  Set these in your Vercel environment variables:
//       TELEGRAM_BOT_TOKEN  = your_bot_token_here
//       TELEGRAM_CHAT_ID    = your_chat_id_here
//       TRAINING_FEE_NAIRA  = 5000  (or whatever you charge)
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const REQUESTS_KEY    = 'marv_voice_requests';
const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || '09130370801Maviegr8@';

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

  const { action, email, password } = req.body || {};

  try {
    const client = getRedis();

    async function loadRequests() {
      const raw = await client.get(REQUESTS_KEY);
      return raw ? JSON.parse(raw) : [];
    }
    async function saveRequests(reqs) {
      await client.set(REQUESTS_KEY, JSON.stringify(reqs));
    }

    // ── USER: submit a voice request ─────────────────────
    if (action === 'submit') {
      const { voiceName, audioUrl, notes } = req.body;
      if (!email)     return res.status(400).json({ error: 'Email required' });
      if (!voiceName) return res.status(400).json({ error: 'Voice name required' });
      if (!audioUrl)  return res.status(400).json({ error: 'Audio sample URL required' });

      const safeEmail = email.trim().toLowerCase();
      const requestId = `req_${Date.now()}_${Math.random().toString(36).slice(2,7)}`;

      const request = {
        id:        requestId,
        email:     safeEmail,
        voiceName: voiceName.trim(),
        audioUrl:  audioUrl.trim(),
        notes:     notes ? notes.trim() : '',
        status:    'awaiting_payment',
        createdAt: Date.now(),
      };

      const reqs = await loadRequests();
      reqs.unshift(request);
      await saveRequests(reqs);

      // Get training fee from env
      const fee = process.env.TRAINING_FEE_NAIRA || '5000';

      // Notify admin via Telegram
      await notifyAdmin(
        `🎤 *New Voice Model Request*\n\n` +
        `👤 User: ${safeEmail}\n` +
        `🎵 Voice Name: ${voiceName}\n` +
        `📎 Audio Sample: ${audioUrl}\n` +
        `📝 Notes: ${notes || 'None'}\n` +
        `💰 Training Fee: ₦${parseInt(fee).toLocaleString()}\n` +
        `🆔 Request ID: ${requestId}\n\n` +
        `Status: Awaiting user payment`
      );

      return res.status(200).json({
        ok: true,
        requestId,
        trainingFeeNaira: parseInt(fee),
        message: 'Request submitted. Please complete the training fee payment to proceed.',
      });
    }

    // ── ADMIN: list all requests ──────────────────────────
    if (action === 'list') {
      if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const reqs = await loadRequests();
      return res.status(200).json({ requests: reqs });
    }

    // ── ADMIN: update request status ─────────────────────
    if (action === 'update_status') {
      if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { requestId, status } = req.body;
      if (!requestId || !status) return res.status(400).json({ error: 'requestId and status required' });

      const reqs    = await loadRequests();
      const request = reqs.find(r => r.id === requestId);
      if (!request) return res.status(404).json({ error: 'Request not found' });

      request.status    = status;
      request.updatedAt = Date.now();
      await saveRequests(reqs);
      return res.status(200).json({ ok: true, request });
    }

    // ── GET TRAINING FEE ─────────────────────────────────────
    if (action === 'get_fee') {
      const fee = process.env.TRAINING_FEE_NAIRA || await client.get('marv_training_fee') || '5000';
      const usd = process.env.TRAINING_FEE_USD   || await client.get('marv_training_fee_usd') || '3';
      return res.status(200).json({ trainingFeeNaira: parseInt(fee), trainingFeeUsd: parseFloat(usd) });
    }

    // ── SET TRAINING FEE (admin only) ─────────────────────────
    if (action === 'set_fee') {
      if (!password || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Unauthorized' });
      const { fee, feeUsd } = req.body;
      if (fee)    await client.set('marv_training_fee',     String(parseInt(fee)));
      if (feeUsd) await client.set('marv_training_fee_usd', String(parseFloat(feeUsd)));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Voice request error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}

// ── Telegram notifier ────────────────────────────────────────
async function notifyAdmin(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.warn('Telegram not configured — skipping notification');
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:    chatId,
        text:       message,
        parse_mode: 'Markdown',
      }),
    });
  } catch (e) {
    console.error('Telegram notify failed:', e.message);
  }
}
