// ══════════════════════════════════════════════════════════════
//  MARV — Reference Image Upload  (Vercel Serverless Function)
//  Endpoint: /api/upload-reference
//  POST { imageBase64, email }
//    → uploads compressed reference JPEG to fal.ai CDN storage
//    → returns { referenceUrl } — an HTTPS URL the model can fetch
//
//  Why: decart/lucy-realtime-2 requires reference_image_url to be
//  a real HTTPS URL, not a base64 data URL embedded in the payload.
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const USERS_KEY = 'marv_users';

let redis;
function getRedis() {
  if (!redis) redis = new Redis(process.env.REDIS_URL);
  return redis;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.FAL_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'FAL_API_KEY not configured' });

  const { imageBase64, email } = req.body || {};
  if (!imageBase64 || !email) return res.status(400).json({ error: 'imageBase64 and email required' });

  // Verify the user exists
  try {
    const client   = getRedis();
    const raw      = await client.get(USERS_KEY);
    const users    = raw ? JSON.parse(raw) : [];
    const safeEmail = email.trim().toLowerCase();
    const user     = users.find(u => u.email === safeEmail);
    if (!user) return res.status(403).json({ error: 'User not found' });
  } catch (err) {
    console.error('Redis error:', err.message);
    return res.status(500).json({ error: 'Redis error', detail: err.message });
  }

  // Strip data URL prefix and decode to binary
  const match = imageBase64.match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) return res.status(400).json({ error: 'Invalid base64 image — expected data:image/...;base64,... format' });
  const [, contentType, base64Data] = match;
  const buffer = Buffer.from(base64Data, 'base64');

  // Upload to fal.ai CDN storage
  try {
    const uploadRes = await fetch('https://storage.alpha.fal.ai/upload', {
      method: 'POST',
      headers: {
        'Authorization':   `Key ${apiKey}`,
        'Content-Type':    contentType,
        'X-Fal-File-Name': 'reference.jpg',
      },
      body: buffer,
    });

    const text = await uploadRes.text();
    console.log(`fal.ai storage [${uploadRes.status}]:`, text.slice(0, 200));

    if (!uploadRes.ok) {
      return res.status(502).json({ error: 'fal.ai storage upload failed', status: uploadRes.status, detail: text });
    }

    let data;
    try { data = JSON.parse(text); } catch(_) {
      return res.status(502).json({ error: 'Non-JSON response from fal.ai storage', raw: text });
    }

    const referenceUrl = data.access_url || data.url || data.file_url;
    if (!referenceUrl) {
      return res.status(502).json({ error: 'No URL field in fal.ai storage response', raw: data });
    }

    console.log('Reference image uploaded:', referenceUrl);
    return res.status(200).json({ referenceUrl });

  } catch (err) {
    console.error('Upload fetch error:', err.message);
    return res.status(500).json({ error: 'Upload request failed', detail: err.message });
  }
}
