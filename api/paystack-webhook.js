// ══════════════════════════════════════════════════════════════
//  MARV — PAYSTACK WEBHOOK  (Vercel Serverless Function)
//  Endpoint: /api/paystack-webhook
//  Called by Paystack when a payment is completed.
//
//  ⚙️  Set these in your Vercel environment variables:
//       PAYSTACK_SECRET_KEY   = sk_test_ec44e01abb803693bb16524827e5395f4db4e157
//       PAYSTACK_WEBHOOK_SECRET = your_webhook_secret_here
//
//  In your Paystack dashboard:
//    Settings → Webhooks → Add: https://your-domain.vercel.app/api/paystack-webhook
// ══════════════════════════════════════════════════════════════

import Redis   from 'ioredis';
import crypto  from 'crypto';

const PACKAGES_KEY  = 'marv_coin_packages';
const REVENUE_KEY   = 'marv_revenue';
const TRAINING_FEE_KEY = 'marv_training_fee';

// Infrastructure cost percentage (e.g. 0.30 = 30% goes to RunPod + fal.ai)
const INFRA_PERCENTAGE = 0.30;

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // ── Verify Paystack signature ────────────────────────────
  const secret    = process.env.PAYSTACK_WEBHOOK_SECRET;
  const hash      = crypto
    .createHmac('sha512', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== req.headers['x-paystack-signature']) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const event = req.body;

  // ── Only handle successful charges ──────────────────────
  if (event.event !== 'charge.success') {
    return res.status(200).json({ received: true });
  }

  const data      = event.data;
  const email     = data.customer?.email?.trim().toLowerCase();
  const amountKobo = data.amount; // Paystack sends in kobo (₦1 = 100 kobo)
  const amountNaira = amountKobo / 100;
  const meta      = data.metadata || {};
  const type      = meta.type || 'coins'; // 'coins' or 'training_fee'

  if (!email) return res.status(400).json({ error: 'No email in payment data' });

  try {
    const client = getRedis();

    // ── TRAINING FEE payment ─────────────────────────────
    if (type === 'training_fee') {
      const requestKey = `marv_voice_request:${email}:${meta.requestId}`;
      await client.set(requestKey, JSON.stringify({
        email,
        paid: true,
        paidAt: Date.now(),
        amountNaira,
        audioUrl: meta.audioUrl || null,
        voiceName: meta.voiceName || 'Unnamed Voice',
        status: 'pending_training',
      }));

      // Log revenue
      await logRevenue(client, email, amountNaira, 'training_fee');

      // Send Telegram notification to admin
      await notifyAdmin(
        `🎤 *Voice Training Fee Received*\n\n` +
        `👤 User: ${email}\n` +
        `🎵 Voice: ${meta.voiceName || 'Unnamed'}\n` +
        `💰 Amount: ₦${amountNaira.toLocaleString()}\n` +
        `📋 Request ID: ${meta.requestId}\n\n` +
        `User's audio sample is ready. Start training when available.`
      );

      return res.status(200).json({ ok: true, type: 'training_fee' });
    }

    // ── COINS purchase ───────────────────────────────────
    const packageId = meta.packageId;
    const raw       = await client.get(PACKAGES_KEY);
    const packages  = raw ? JSON.parse(raw) : [];
    const pkg       = packages.find(p => p.id === packageId);

    if (!pkg) {
      return res.status(400).json({ error: 'Package not found', packageId });
    }

    // Add coins to user balance
    const coinKey    = `marv_coins:${email}`;
    const val        = await client.get(coinKey);
    const balance    = val ? parseFloat(val) : 0;
    const newBalance = parseFloat((balance + pkg.coins).toFixed(4));
    await client.set(coinKey, newBalance.toString());

    // Log revenue
    await logRevenue(client, email, amountNaira, 'coins', pkg.coins);

    return res.status(200).json({ ok: true, type: 'coins', newBalance });

  } catch (err) {
    console.error('Webhook error:', err.message);
    return res.status(500).json({ error: 'Server error' });
  }
}

// ── Revenue logger ───────────────────────────────────────────
async function logRevenue(client, email, amountNaira, type, coins = 0) {
  const infraCost  = parseFloat((amountNaira * INFRA_PERCENTAGE).toFixed(2));
  const commission = parseFloat((amountNaira - infraCost).toFixed(2));

  const entry = {
    email,
    type,
    amountNaira,
    infraCost,
    commission,
    coins,
    ts: Date.now(),
  };

  // Append to revenue log (keep last 1000 entries)
  const raw      = await client.get(REVENUE_KEY);
  const log      = raw ? JSON.parse(raw) : [];
  log.unshift(entry);
  if (log.length > 1000) log.splice(1000);
  await client.set(REVENUE_KEY, JSON.stringify(log));
}

// ── Telegram notifier ────────────────────────────────────────
async function notifyAdmin(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: 'Markdown',
      }),
    });
  } catch (e) {
    console.error('Telegram notify failed:', e.message);
  }
}
