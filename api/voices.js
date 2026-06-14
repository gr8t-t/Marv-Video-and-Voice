// ══════════════════════════════════════════════════════════════
//  MARV — VOICE MODELS API  (Vercel Serverless Function)
//  Endpoint: /api/voices
//  Admin: add/remove/list voice models
//  Users: list voices available to them
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || '09130370801Maviegr8@';
const VOICES_KEY      = 'marv_voices';

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

  const { action, password, email } = req.body || {};

  try {
    const client = getRedis();

    async function loadVoices() {
      const raw = await client.get(VOICES_KEY);
      return raw ? JSON.parse(raw) : [];
    }
    async function saveVoices(voices) {
      await client.set(VOICES_KEY, JSON.stringify(voices));
    }

    // ── USER: list voices available to this user ──────────
    if (action === 'list_for_user') {
      if (!email) return res.status(400).json({ error: 'Email required' });
      const safeEmail = email.trim().toLowerCase();
      const voices    = await loadVoices();
      const available = voices.filter(v =>
        v.global === true || (v.assignedTo && v.assignedTo.includes(safeEmail))
      );
      // Don't expose pth/index URLs to client — only what's needed for display + RVC server
      const safe = available.map(v => ({
        id:          v.id,
        name:        v.name,
        description: v.description || '',
        global:      v.global,
        createdAt:   v.createdAt,
        sampleUrl:   v.sampleUrl || null,
        pthUrl:      v.pthUrl,
        indexUrl:    v.indexUrl,
      }));
      return res.status(200).json({ voices: safe });
    }

    // ── ADMIN ONLY below this point ───────────────────────
    if (!password || password !== ADMIN_PASSWORD) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    // ── ADMIN: list all voices ────────────────────────────
    if (action === 'list') {
      const voices = await loadVoices();
      return res.status(200).json({ voices });
    }

    // ── ADMIN: add a new voice model ─────────────────────
    if (action === 'add') {
      const { name, description, pthUrl, indexUrl, global: isGlobal, assignedTo } = req.body;
      if (!name || !pthUrl || !indexUrl) {
        return res.status(400).json({ error: 'name, pthUrl and indexUrl are required' });
      }
      const { sampleUrl } = req.body;
      const voices  = await loadVoices();
      const newVoice = {
        id:          `voice_${Date.now()}`,
        name:        name.trim(),
        description: description ? description.trim() : '',
        pthUrl:      pthUrl.trim(),
        indexUrl:    indexUrl.trim(),
        sampleUrl:   sampleUrl ? sampleUrl.trim() : null,
        global:      isGlobal === true || isGlobal === 'true',
        assignedTo:  assignedTo ? assignedTo.map(e => e.trim().toLowerCase()) : [],
        createdAt:   Date.now(),
      };
      voices.push(newVoice);
      await saveVoices(voices);
      return res.status(200).json({ voice: newVoice });
    }

    // ── ADMIN: remove a voice model ───────────────────────
    if (action === 'remove') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Voice ID required' });
      let voices = await loadVoices();
      voices     = voices.filter(v => v.id !== id);
      await saveVoices(voices);
      return res.status(200).json({ ok: true });
    }

    // ── ADMIN: assign private voice to a user ─────────────
    if (action === 'assign') {
      const { id, assignEmail } = req.body;
      if (!id || !assignEmail) return res.status(400).json({ error: 'id and assignEmail required' });
      const voices = await loadVoices();
      const voice  = voices.find(v => v.id === id);
      if (!voice) return res.status(404).json({ error: 'Voice not found' });
      const safeEmail = assignEmail.trim().toLowerCase();
      if (!voice.assignedTo) voice.assignedTo = [];
      if (!voice.assignedTo.includes(safeEmail)) voice.assignedTo.push(safeEmail);
      await saveVoices(voices);
      return res.status(200).json({ ok: true, voice });
    }

    // ── ADMIN: make a private voice global ────────────────
    if (action === 'make_global') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Voice ID required' });
      const voices = await loadVoices();
      const voice  = voices.find(v => v.id === id);
      if (!voice) return res.status(404).json({ error: 'Voice not found' });
      voice.global = true;
      await saveVoices(voices);
      return res.status(200).json({ ok: true, voice });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Voices API error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}
