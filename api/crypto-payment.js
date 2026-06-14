// ══════════════════════════════════════════════════════════════
//  MARV — CRYPTO PAYMENT API  (Vercel Serverless Function)
//  Endpoint: /api/crypto-payment
//  Supports: USDT/USDC TRC20, USDT/USDC ERC20, BTC
//  Auto-verifies transactions on-chain
//
//  ⚙️  Set in Vercel environment variables:
//       ETHERSCAN_API_KEY = your_free_etherscan_key
//       (Tronscan + Blockchain.com need no key)
// ══════════════════════════════════════════════════════════════

import Redis from 'ioredis';

const ADMIN_PASSWORD  = process.env.ADMIN_PASSWORD || '09130370801Maviegr8@';
const WALLETS_KEY     = 'marv_crypto_wallets';
const PACKAGES_KEY    = 'marv_coin_packages';
const REVENUE_KEY     = 'marv_revenue';
const TX_USED_PREFIX  = 'marv_tx_used:';
const INFRA_PCT       = parseFloat(process.env.INFRA_PERCENTAGE || '0.30');

// USDT/USDC contract addresses (ERC20)
const ERC20_CONTRACTS = {
  USDT: '0xdac17f958d2ee523a2206206994597c13d831ec7',
  USDC: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
};

// USDT/USDC contract addresses (TRC20)
const TRC20_CONTRACTS = {
  USDT: 'TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t',
  USDC: 'TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8',
};

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

    // ── GET WALLET ADDRESSES (public) ────────────────────
    if (action === 'get_wallets') {
      const raw     = await client.get(WALLETS_KEY);
      const wallets = raw ? JSON.parse(raw) : {};
      // Only return addresses, not any private info
      return res.status(200).json({
        wallets: {
          trc20: wallets.trc20 || null,
          erc20: wallets.erc20 || null,
          btc:   wallets.btc   || null,
        }
      });
    }

    // ── VERIFY TRANSACTION ───────────────────────────────
    if (action === 'verify') {
      const { txHash, network, email, packageId } = req.body;
      if (!txHash || !network || !email || !packageId) {
        return res.status(400).json({ error: 'txHash, network, email, packageId required' });
      }

      const safeEmail = email.trim().toLowerCase();
      const safeTx    = txHash.trim();

      // Check tx not already used
      const txKey = `${TX_USED_PREFIX}${safeTx}`;
      const used  = await client.get(txKey);
      if (used) {
        return res.status(409).json({ error: 'This transaction has already been used.' });
      }

      // Get wallet addresses
      const raw     = await client.get(WALLETS_KEY);
      const wallets = raw ? JSON.parse(raw) : {};

      // Get coin package
      const pkgRaw  = await client.get(PACKAGES_KEY);
      const packages = pkgRaw ? JSON.parse(pkgRaw) : [];
      const pkg      = packages.find(p => p.id === packageId);
      if (!pkg) return res.status(400).json({ error: 'Package not found' });

      // Verify on-chain
      let verified = false;
      let amountUsd = 0;

      if (network === 'trc20') {
        const result = await verifyTRC20(safeTx, wallets.trc20, pkg.priceUsd);
        verified  = result.verified;
        amountUsd = result.amount;
      } else if (network === 'erc20') {
        const result = await verifyERC20(safeTx, wallets.erc20, pkg.priceUsd);
        verified  = result.verified;
        amountUsd = result.amount;
      } else if (network === 'btc') {
        const result = await verifyBTC(safeTx, wallets.btc, pkg.priceUsd);
        verified  = result.verified;
        amountUsd = result.amount;
      } else {
        return res.status(400).json({ error: 'Unknown network' });
      }

      if (!verified) {
        return res.status(402).json({
          error: 'Transaction not verified. Check the hash and try again, or wait a few minutes for confirmation.'
        });
      }

      // Mark tx as used (never reuse)
      await client.set(txKey, JSON.stringify({ email: safeEmail, ts: Date.now() }), 'EX', 60 * 60 * 24 * 365);

      // Add coins to user
      const coinKey    = `marv_coins:${safeEmail}`;
      const val        = await client.get(coinKey);
      const balance    = val ? parseFloat(val) : 0;
      const newBalance = parseFloat((balance + pkg.coins).toFixed(4));
      await client.set(coinKey, newBalance.toString());

      // Log revenue
      await logRevenue(client, safeEmail, amountUsd, pkg.priceNaira, pkg.coins, network, safeTx);

      return res.status(200).json({ ok: true, coins: pkg.coins, newBalance });
    }

    // ── ADMIN: set wallet addresses ───────────────────────
    if (action === 'set_wallets') {
      if (!password || password !== ADMIN_PASSWORD) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
      const { trc20, erc20, btc } = req.body;
      const raw     = await client.get(WALLETS_KEY);
      const wallets = raw ? JSON.parse(raw) : {};
      if (trc20 !== undefined) wallets.trc20 = trc20.trim();
      if (erc20 !== undefined) wallets.erc20 = erc20.trim();
      if (btc   !== undefined) wallets.btc   = btc.trim();
      await client.set(WALLETS_KEY, JSON.stringify(wallets));
      return res.status(200).json({ ok: true, wallets });
    }

    return res.status(400).json({ error: 'Unknown action' });

  } catch (err) {
    console.error('Crypto payment error:', err.message);
    return res.status(500).json({ error: 'Server error', detail: err.message });
  }
}

// ══════════════════════════════════════════════════════════════
//  ON-CHAIN VERIFIERS
// ══════════════════════════════════════════════════════════════

// ── TRC20 (Tronscan) ─────────────────────────────────────────
async function verifyTRC20(txHash, walletAddress, expectedUsd) {
  if (!walletAddress) return { verified: false, amount: 0 };
  try {
    const url  = `https://apilist.tronscanapi.com/api/transaction-info?hash=${txHash}`;
    const res  = await fetch(url, { headers: { 'Accept': 'application/json' } });
    const data = await res.json();

    if (!data || data.contractRet !== 'SUCCESS') return { verified: false, amount: 0 };

    // Check TRC20 token transfers
    const transfers = data.trc20TransferInfo || [];
    for (const t of transfers) {
      const contractAddr = (t.contract_address || '').toLowerCase();
      const toAddr       = (t.to_address || '').toLowerCase();
      const isUsdToken   = contractAddr === TRC20_CONTRACTS.USDT.toLowerCase()
                        || contractAddr === TRC20_CONTRACTS.USDC.toLowerCase();
      const isToUs       = toAddr === walletAddress.toLowerCase();
      const amount       = parseFloat(t.amount_str || t.amount || 0) / 1e6;

      if (isUsdToken && isToUs && amount >= expectedUsd * 0.98) {
        return { verified: true, amount };
      }
    }
    return { verified: false, amount: 0 };
  } catch(e) {
    console.error('TRC20 verify error:', e.message);
    return { verified: false, amount: 0 };
  }
}

// ── ERC20 (Etherscan) ────────────────────────────────────────
async function verifyERC20(txHash, walletAddress, expectedUsd) {
  if (!walletAddress) return { verified: false, amount: 0 };
  const apiKey = process.env.ETHERSCAN_API_KEY || '';
  try {
    const url  = `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionByHash&txhash=${txHash}&apikey=${apiKey}`;
    const res  = await fetch(url);
    const data = await res.json();
    const tx   = data.result;
    if (!tx) return { verified: false, amount: 0 };

    // Check token transfers via logs
    const receiptUrl  = `https://api.etherscan.io/api?module=proxy&action=eth_getTransactionReceipt&txhash=${txHash}&apikey=${apiKey}`;
    const receiptRes  = await fetch(receiptUrl);
    const receiptData = await receiptRes.json();
    const receipt     = receiptData.result;

    if (!receipt || receipt.status !== '0x1') return { verified: false, amount: 0 };

    // Transfer(address,address,uint256) topic
    const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';

    for (const log of (receipt.logs || [])) {
      const contractAddr = (log.address || '').toLowerCase();
      const isUsdToken   = contractAddr === ERC20_CONTRACTS.USDT.toLowerCase()
                        || contractAddr === ERC20_CONTRACTS.USDC.toLowerCase();
      if (!isUsdToken) continue;
      if ((log.topics || [])[0]?.toLowerCase() !== TRANSFER_TOPIC) continue;

      // topics[2] is the 'to' address (padded)
      const toAddr = '0x' + (log.topics[2] || '').slice(26).toLowerCase();
      if (toAddr !== walletAddress.toLowerCase()) continue;

      const amount = parseInt(log.data, 16) / 1e6; // USDT/USDC have 6 decimals
      if (amount >= expectedUsd * 0.98) {
        return { verified: true, amount };
      }
    }
    return { verified: false, amount: 0 };
  } catch(e) {
    console.error('ERC20 verify error:', e.message);
    return { verified: false, amount: 0 };
  }
}

// ── BTC (Blockchain.com) ─────────────────────────────────────
async function verifyBTC(txHash, walletAddress, expectedUsd) {
  if (!walletAddress) return { verified: false, amount: 0 };
  try {
    // Get live BTC price in USD
    const priceRes  = await fetch('https://api.blockchain.com/v3/exchange/tickers/BTC-USD');
    const priceData = await priceRes.json();
    const btcPrice  = parseFloat(priceData?.last_trade_price || priceData?.price || 0);
    if (!btcPrice) return { verified: false, amount: 0 };

    const expectedBtc = expectedUsd / btcPrice;

    // Get transaction
    const txRes  = await fetch(`https://blockchain.info/rawtx/${txHash}`);
    const txData = await txRes.json();
    if (!txData || txData.error) return { verified: false, amount: 0 };

    // Check outputs for our wallet
    for (const out of (txData.out || [])) {
      if ((out.addr || '').toLowerCase() !== walletAddress.toLowerCase()) continue;
      const btcAmount = (out.value || 0) / 1e8;
      if (btcAmount >= expectedBtc * 0.98) {
        return { verified: true, amount: btcAmount * btcPrice };
      }
    }
    return { verified: false, amount: 0 };
  } catch(e) {
    console.error('BTC verify error:', e.message);
    return { verified: false, amount: 0 };
  }
}

// ── Revenue logger ───────────────────────────────────────────
async function logRevenue(client, email, amountUsd, amountNaira, coins, network, txHash) {
  const infraCost  = parseFloat((amountUsd * INFRA_PCT).toFixed(4));
  const commission = parseFloat((amountUsd - infraCost).toFixed(4));

  const entry = {
    email, amountUsd, amountNaira, infraCost, commission,
    coins, network, txHash, type: 'crypto_coins', ts: Date.now(),
  };

  const raw = await client.get(REVENUE_KEY);
  const log = raw ? JSON.parse(raw) : [];
  log.unshift(entry);
  if (log.length > 1000) log.splice(1000);
  await client.set(REVENUE_KEY, JSON.stringify(log));
}
