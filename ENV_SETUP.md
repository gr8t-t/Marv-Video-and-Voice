# ══════════════════════════════════════════════════════════════
#  MARV v2.0 — Environment Variables & Setup Guide
#  Add ALL of these to Vercel:
#  Dashboard → Your Project → Settings → Environment Variables
# ══════════════════════════════════════════════════════════════

# ── REQUIRED ─────────────────────────────────────────────────

# Redis connection string (Upstash or Vercel KV)
REDIS_URL=rediss://your-redis-url-here

# Your fal.ai API key — NEVER put this in frontend code
# Get from: https://fal.ai → Dashboard → API Keys
FAL_API_KEY=your-fal-api-key-here

# Admin panel password — change this!
ADMIN_PASSWORD=YourStrongPasswordHere

# ── CRYPTO PAYMENTS ───────────────────────────────────────────
# Free blockchain APIs — no signup needed for Tronscan/Blockchain.com
# Etherscan free key: https://etherscan.io/register → API Keys
ETHERSCAN_API_KEY=your-free-etherscan-key

# % of each payment reserved for infrastructure (RunPod + fal.ai)
# 0.30 = 30% infra cost, 70% is your commission
INFRA_PERCENTAGE=0.30

# ── TELEGRAM BOT ─────────────────────────────────────────────
# 1. Message @BotFather on Telegram → /newbot → copy token
# 2. Send yourself a message on the bot, then visit:
#    https://api.telegram.org/bot<TOKEN>/getUpdates
#    Copy your chat_id from the JSON response
TELEGRAM_BOT_TOKEN=1234567890:ABCdefGHIjklMNOpqrsTUVwxyz
TELEGRAM_CHAT_ID=your_chat_id_here

# ── RUNPOD ────────────────────────────────────────────────────
# 1. Create account: https://runpod.io
# 2. Create a pod:
#    - Template: runpod/pytorch:2.1.0-py3.10-cuda11.8.0-devel
#    - GPU: RTX 3080 or better (cheapest that works well)
#    - Expose TCP port: 7865
# 3. Get API key: RunPod → Settings → API Keys
# 4. Note your Pod ID from the Pods dashboard
RUNPOD_API_KEY=your-runpod-api-key
RUNPOD_POD_ID=your-pod-id
RVC_SERVER_PORT=7865

# ── VOICE TRAINING FEE ───────────────────────────────────────
# How much you charge per custom voice model (can also be set in admin panel)
TRAINING_FEE_NAIRA=5000
TRAINING_FEE_USD=3.00

# ══════════════════════════════════════════════════════════════
#  FILE PLACEMENT GUIDE
# ══════════════════════════════════════════════════════════════
#
#  Your project structure should look like this:
#
#  /
#  ├── index.html          ← main app page
#  ├── index.js            ← frontend logic (fal.ai WebSocket)
#  ├── admin.html          ← admin panel
#  ├── auth.js             ← user list (admin-only file)
#  ├── output.html         ← output stream tab
#  ├── package.json        ← dependencies
#  └── api/
#      ├── admin.js        ← user management
#      ├── usercheck.js    ← login + session + heartbeat
#      ├── fingerprint.js  ← device fingerprinting
#      ├── decart-token.js ← fal.ai JWT token endpoint
#      ├── coins.js        ← coin balance + drain
#      ├── coin-packages.js← coin packages
#      ├── crypto-payment.js← crypto payment verification
#      ├── paystack-webhook.js← Paystack payment webhook
#      ├── voices.js       ← voice model management
#      ├── voice-request.js← voice training requests
#      ├── rvc-proxy.js    ← RVC server proxy
#      └── runpod.js       ← RunPod pod management
#
# ══════════════════════════════════════════════════════════════
#  VERCEL ENVIRONMENT VARIABLES (go to Settings → Env Vars)
# ══════════════════════════════════════════════════════════════
#
#  Required:
#    FAL_API_KEY     → your fal.ai API key
#    REDIS_URL       → your Redis/Upstash connection string
#    ADMIN_PASSWORD  → your admin panel password
#
#  Optional (for payments):
#    PAYSTACK_SECRET_KEY, PAYSTACK_WEBHOOK_SECRET
#    ETHERSCAN_API_KEY
#    INFRA_PERCENTAGE
#
#  Optional (for Telegram alerts):
#    TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
#
#  Optional (for voice/RVC):
#    RUNPOD_API_KEY, RUNPOD_POD_ID, RVC_SERVER_PORT
#    RVC_EXTERNAL_URL
#    TRAINING_FEE_NAIRA, TRAINING_FEE_USD
#
# ══════════════════════════════════════════════════════════════
#  CRYPTO PAYMENT FLOW
# ══════════════════════════════════════════════════════════════
#
#  1. User clicks "Buy Coins" → selects a package you created
#  2. User picks network: TRC20 / ERC20 / BTC
#  3. User sees YOUR wallet address + exact amount to send
#  4. User sends crypto from any wallet (Binance, Trust, etc.)
#  5. User pastes their transaction hash (TXID) into MARV
#  6. MARV verifies on-chain automatically (no manual work)
#  7. Coins are added to their balance instantly ✓
#
# ══════════════════════════════════════════════════════════════
#  COIN PACKAGES (how to create them)
# ══════════════════════════════════════════════════════════════
#
#  Admin Panel → Coin Packages → Add Package
#  Fields: Name, Coins amount, Price in ₦, Price in $
#
#  Suggested starter packages:
#  ┌────────────────┬────────┬──────────┬────────┐
#  │ Name           │ Coins  │ Price ₦  │ Price $ │
#  ├────────────────┼────────┼──────────┼────────┤
#  │ Starter        │   500  │   1,500  │  0.90  │
#  │ Basic          │ 1,200  │   3,000  │  1.80  │
#  │ Standard ★     │ 3,000  │   6,500  │  3.90  │
#  │ Pro            │ 7,000  │  13,000  │  7.80  │
#  └────────────────┴────────┴──────────┴────────┘
#
#  Drain rates:
#  - Video only:       1 coin/second
#  - Video + Voice:  1.1 coins/second
#  - 2000 free coins on first login ≈ ~33 mins video only
#
