# ══════════════════════════════════════════════════════════════
#  MARV — Environment Variables Setup Guide
#  Add all of these to your Vercel project:
#  Vercel Dashboard → Your Project → Settings → Environment Variables
# ══════════════════════════════════════════════════════════════

# ── REQUIRED ─────────────────────────────────────────────────

# Your Redis connection URL (from Upstash or Vercel KV)
REDIS_URL=rediss://your-redis-url-here

# Your Decart API key (NEVER put this in frontend code)
# Get it from: https://app.decart.ai → API Keys
DECART_API_KEY=dct-your-key-here

# Admin panel password (change this from the default!)
ADMIN_PASSWORD=YourStrongPasswordHere

# ── PAYSTACK ──────────────────────────────────────────────────
# Get from: https://dashboard.paystack.com → Settings → API Keys

# Secret key (server-side only)
PAYSTACK_SECRET_KEY=sk_live_your-secret-key

# Webhook secret (from Paystack webhook settings)
PAYSTACK_WEBHOOK_SECRET=your-webhook-secret

# Public key (safe to expose in frontend)
# Add this to your index.html as:
# <script>window.__PAYSTACK_PUBLIC_KEY__ = "pk_live_..."</script>
PAYSTACK_PUBLIC_KEY=pk_live_your-public-key

# ── TELEGRAM BOT ─────────────────────────────────────────────
# 1. Message @BotFather on Telegram → /newbot → copy the token
# 2. Start your bot, then visit:
#    https://api.telegram.org/bot<TOKEN>/getUpdates
#    Send yourself a message first, then get your chat_id from the response

TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=your-chat-id-here

# ── RUNPOD ────────────────────────────────────────────────────
# 1. Create account at https://runpod.io
# 2. Create a pod with:
#    - Template: runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel-ubuntu22.04
#    - GPU: RTX 3080 or better
#    - Expose TCP port: 7865
# 3. Note your Pod ID from the dashboard
# 4. Get API key from: RunPod → Settings → API Keys

RUNPOD_API_KEY=your-runpod-api-key
RUNPOD_POD_ID=your-pod-id-here
RVC_SERVER_PORT=7865

# ── VOICE TRAINING FEE ───────────────────────────────────────
# How much (in Naira) you charge per custom voice model training
TRAINING_FEE_NAIRA=5000

# ── INFRASTRUCTURE COST PERCENTAGE ───────────────────────────
# What % of each coin purchase is set aside for RunPod + Decart bills
# 0.30 = 30% goes to infrastructure, 70% is your commission
# Adjust based on your actual running costs
INFRA_PERCENTAGE=0.30


# ══════════════════════════════════════════════════════════════
#  RUNPOD SETUP STEPS (do this once)
# ══════════════════════════════════════════════════════════════
#
# 1. Create pod in RunPod dashboard (Community Cloud is cheaper)
# 2. In pod terminal, run:
#
#    git clone https://github.com/RVC-Project/Retrieval-based-Voice-Conversion-WebUI /workspace/rvc
#    cd /workspace/rvc
#    pip install -r requirements.txt
#    pip install fastapi uvicorn python-multipart websockets
#
# 3. Upload rvc_server.py to your pod:
#    - Use RunPod's file browser or SCP
#
# 4. Start the server:
#    python /workspace/rvc_server.py
#
# 5. Stop the pod when done (you only pay when it's running)
#
# ══════════════════════════════════════════════════════════════
#  CLOUDFLARE R2 SETUP (for voice model file storage)
# ══════════════════════════════════════════════════════════════
#
# 1. Create free Cloudflare account at https://cloudflare.com
# 2. Go to R2 → Create bucket (name it: marv-voices)
# 3. Enable "Public access" on the bucket
# 4. Upload your .pth and .index files via the dashboard
# 5. Copy the public URL of each file
# 6. Paste URLs into Admin Panel → Voice Models → Add Voice
#
# R2 Free tier: 10GB storage, 1M requests/month — plenty to start
#
# ══════════════════════════════════════════════════════════════
#  PAYSTACK WEBHOOK SETUP
# ══════════════════════════════════════════════════════════════
#
# 1. Go to: https://dashboard.paystack.com → Settings → Webhooks
# 2. Add URL: https://your-domain.vercel.app/api/paystack-webhook
# 3. Copy the webhook secret and add it to PAYSTACK_WEBHOOK_SECRET above
#
# ══════════════════════════════════════════════════════════════
