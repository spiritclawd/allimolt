/**
 * AlliGo - x402 Payment Protocol Implementation
 * HTTP 402 Payment Required for API access
 *
 * Protocol flow:
 * 1. Client requests protected endpoint
 * 2. Server returns 402 with payment details (recipient, amount, network)
 * 3. Client pays USDC on-chain
 * 4. Client retries with X-Payment header containing tx proof
 * 5. Server verifies payment and grants access
 */

import { config } from "../config";
import { db } from "../api/db";

// USDC contract addresses by chain
const USDC_ADDRESSES: Record<string, string> = {
  ethereum: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
  base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
  optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
  solana: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
};

// Payment tiers
export const PAYMENT_TIERS = {
  single_report: {
    priceUsdCents: 100, // $1.00
    description: "Single agent report",
    requests: 1,
  },
  basic: {
    priceUsdCents: 1000, // $10.00
    description: "50 API requests",
    requests: 50,
  },
  pro: {
    priceUsdCents: 5000, // $50.00
    description: "500 API requests",
    requests: 500,
  },
  enterprise: {
    priceUsdCents: 20000, // $200.00
    description: "Unlimited requests for 30 days",
    requests: -1, // unlimited
    daysValid: 30,
  },
};

// Create payments table
db.run(`
  CREATE TABLE IF NOT EXISTS x402_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id TEXT NOT NULL,
    tx_hash TEXT UNIQUE,
    chain TEXT NOT NULL,
    amount_usd_cents INTEGER NOT NULL,
    tier TEXT NOT NULL,
    requests_granted INTEGER NOT NULL,
    requests_used INTEGER DEFAULT 0,
    valid_until INTEGER,
    created_at INTEGER DEFAULT (strftime('%s', 'now')),
    verified INTEGER DEFAULT 0,
    metadata TEXT
  )
`);

db.run(`CREATE INDEX IF NOT EXISTS idx_x402_client ON x402_payments(client_id)`);
db.run(`CREATE INDEX IF NOT EXISTS idx_x402_tx ON x402_payments(tx_hash)`);

export interface PaymentRecord {
  id: number;
  clientId: string;
  txHash?: string;
  chain: string;
  amountUsdCents: number;
  tier: string;
  requestsGranted: number;
  requestsUsed: number;
  validUntil?: number;
  createdAt: number;
  verified: boolean;
  metadata?: string;
}

/**
 * Get client identifier from request
 */
export function getClientId(req: Request): string {
  // Try various identifiers
  const auth = req.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice(7);
  }

  const xClientId = req.headers.get("X-Client-Id");
  if (xClientId) {
    return xClientId;
  }

  // Fall back to IP + User-Agent hash
  const forwarded = req.headers.get("X-Forwarded-For");
  const ip = forwarded?.split(",")[0] || "unknown";
  const ua = req.headers.get("User-Agent") || "";
  return `${ip}_${simpleHash(ua)}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

/**
 * Check if x402 is enabled and configured
 */
export function isX402Configured(): boolean {
  return config.x402Enabled && !!config.usdcRecipientAddress;
}

/**
 * Generate 402 Payment Required response
 */
export function generatePaymentResponse(
  clientId: string,
  tier: keyof typeof PAYMENT_TIERS = "single_report",
  chain: string = "base"
): Response {
  const tierInfo = PAYMENT_TIERS[tier];
  const usdcAddress = USDC_ADDRESSES[chain];

  if (!usdcAddress) {
    return new Response(JSON.stringify({
      success: false,
      error: "Unsupported chain",
      supportedChains: Object.keys(USDC_ADDRESSES),
    }), {
      status: 400,
      headers: { "Content-Type": "application/json" }
    });
  }

  // Convert cents to USDC units (6 decimals)
  const usdcAmount = tierInfo.priceUsdCents / 100;

  const paymentRequest = {
    version: "x402/1.0",
    accepts: [{
      paymentType: "usdc",
      chain: chain,
      network: chain === "solana" ? "mainnet-beta" : "mainnet",
      recipient: config.usdcRecipientAddress,
      amount: usdcAmount.toFixed(6),
      asset: {
        address: usdcAddress,
        symbol: "USDC",
        decimals: 6,
      },
    }],
    tier: tier,
    tierInfo: tierInfo,
    clientId: clientId,
    instructions: {
      step1: `Send exactly ${usdcAmount} USDC to ${config.usdcRecipientAddress} on ${chain}`,
      step2: "Get your transaction hash",
      step3: "Retry request with X-Payment header: {\"txHash\":\"YOUR_TX_HASH\",\"chain\":\"" + chain + "\"}",
    },
    // Pre-generated payment link for wallets
    paymentLink: chain === "solana"
      ? `solana:${config.usdcRecipientAddress}?amount=${usdcAmount}&spl-token=${usdcAddress}`
      : `ethereum:${usdcAddress}@${chain}/transfer?address=${config.usdcRecipientAddress}&uint256=${tierInfo.priceUsdCents * 10000}`,
  };

  return new Response(JSON.stringify(paymentRequest, null, 2), {
    status: 402,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "X-Payment-Required": "true",
      "X-Payment-Amount": usdcAmount.toString(),
      "X-Payment-Recipient": config.usdcRecipientAddress!,
      "X-Payment-Chain": chain,
    },
  });
}

/**
 * Verify payment from X-Payment header
 * In production, this would verify on-chain transaction
 */
export async function verifyPayment(
  clientId: string,
  paymentHeader: string
): Promise<{ valid: boolean; error?: string; record?: PaymentRecord }> {
  try {
    const payment = JSON.parse(paymentHeader);

    if (!payment.txHash) {
      return { valid: false, error: "Missing txHash in payment proof" };
    }

    if (!payment.chain) {
      return { valid: false, error: "Missing chain in payment proof" };
    }

    // Check if we've already processed this tx
    const existing = db.prepare(
      "SELECT * FROM x402_payments WHERE tx_hash = ?"
    ).get(payment.txHash) as PaymentRecord | undefined;

    if (existing) {
      // Tx already processed - check if it belongs to this client
      if (existing.clientId === clientId) {
        return { valid: true, record: existing };
      }
      return { valid: false, error: "Transaction already used by another client" };
    }

    // In production, verify on-chain transaction here
    // For now, we'll accept if the user claims they paid
    // TODO: Integrate with blockchain RPC to verify actual transfer

    const tier = payment.tier || "single_report";
    const tierInfo = PAYMENT_TIERS[tier as keyof typeof PAYMENT_TIERS] || PAYMENT_TIERS.single_report;

    // Create payment record
    const validUntil = tierInfo.daysValid
      ? Date.now() + (tierInfo.daysValid * 24 * 60 * 60 * 1000)
      : null;

    const result = db.prepare(`
      INSERT INTO x402_payments
      (client_id, tx_hash, chain, amount_usd_cents, tier, requests_granted, valid_until, verified)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)
    `).run(
      clientId,
      payment.txHash,
      payment.chain,
      tierInfo.priceUsdCents,
      tier,
      tierInfo.requests,
      validUntil
    );

    const record = db.prepare(
      "SELECT * FROM x402_payments WHERE id = ?"
    ).get(result.lastInsertRowid) as PaymentRecord;

    return { valid: true, record };
  } catch (e: any) {
    return { valid: false, error: e.message || "Invalid payment proof format" };
  }
}

/**
 * Check if client has valid paid access
 */
export function hasValidAccess(clientId: string): { hasAccess: boolean; remaining?: number; record?: PaymentRecord } {
  // Get active payments for this client
  const payments = db.prepare(`
    SELECT * FROM x402_payments
    WHERE client_id = ?
    AND verified = 1
    AND (valid_until IS NULL OR valid_until > ?)
    ORDER BY created_at DESC
  `).all(clientId, Date.now()) as PaymentRecord[];

  if (payments.length === 0) {
    return { hasAccess: false };
  }

  // Check if any payment has remaining requests
  for (const payment of payments) {
    if (payment.requestsGranted === -1) {
      // Unlimited
      return { hasAccess: true, remaining: -1, record: payment };
    }
    if (payment.requestsUsed < payment.requestsGranted) {
      return {
        hasAccess: true,
        remaining: payment.requestsGranted - payment.requestsUsed,
        record: payment
      };
    }
  }

  return { hasAccess: false };
}

/**
 * Increment usage counter for a payment
 */
export function incrementUsage(clientId: string): void {
  // Get the most recent active payment
  const payment = db.prepare(`
    SELECT * FROM x402_payments
    WHERE client_id = ?
    AND verified = 1
    AND (valid_until IS NULL OR valid_until > ?)
    AND (requests_granted = -1 OR requests_used < requests_granted)
    ORDER BY created_at DESC
    LIMIT 1
  `).get(clientId, Date.now()) as PaymentRecord | undefined;

  if (payment && payment.requestsGranted !== -1) {
    db.prepare(
      "UPDATE x402_payments SET requests_used = requests_used + 1 WHERE id = ?"
    ).run(payment.id);
  }
}

/**
 * x402 Middleware - Check payment for protected endpoints
 */
export async function x402Middleware(
  req: Request,
  endpoint: string,
  tier: keyof typeof PAYMENT_TIERS = "single_report"
): Promise<{ allowed: boolean; response?: Response; clientId?: string }> {
  // Skip if x402 not configured
  if (!isX402Configured()) {
    return { allowed: true };
  }

  const clientId = getClientId(req);

  // Check for payment proof in header
  const paymentHeader = req.headers.get("X-Payment");

  if (paymentHeader) {
    const verification = await verifyPayment(clientId, paymentHeader);

    if (verification.valid) {
      // Payment verified, grant access
      incrementUsage(clientId);
      return { allowed: true, clientId };
    }

    // Payment verification failed
    return {
      allowed: false,
      response: new Response(JSON.stringify({
        success: false,
        error: verification.error || "Payment verification failed",
      }), {
        status: 402,
        headers: { "Content-Type": "application/json" }
      }),
      clientId,
    };
  }

  // Check if client already has valid access
  const access = hasValidAccess(clientId);

  if (access.hasAccess) {
    incrementUsage(clientId);
    return { allowed: true, clientId };
  }

  // No access - return 402 payment required
  return {
    allowed: false,
    response: generatePaymentResponse(clientId, tier),
    clientId,
  };
}

/**
 * Get payment stats for admin
 */
export function getPaymentStats(): {
  totalPayments: number;
  totalRevenue: number;
  activeSubscriptions: number;
  recentPayments: PaymentRecord[];
} {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(amount_usd_cents) as revenue
    FROM x402_payments
    WHERE verified = 1
  `).get() as { total: number; revenue: number };

  const active = db.prepare(`
    SELECT COUNT(DISTINCT client_id) as count
    FROM x402_payments
    WHERE verified = 1
    AND (valid_until IS NULL OR valid_until > ?)
    AND (requests_granted = -1 OR requests_used < requests_granted)
  `).get(Date.now()) as { count: number };

  const recent = db.prepare(`
    SELECT * FROM x402_payments
    ORDER BY created_at DESC
    LIMIT 20
  `).all() as PaymentRecord[];

  return {
    totalPayments: stats.total || 0,
    totalRevenue: (stats.revenue || 0) / 100, // Convert to dollars
    activeSubscriptions: active.count || 0,
    recentPayments: recent,
  };
}

/**
 * Get client's payment history
 */
export function getClientPayments(clientId: string): PaymentRecord[] {
  return db.prepare(`
    SELECT * FROM x402_payments
    WHERE client_id = ?
    ORDER BY created_at DESC
  `).all(clientId) as PaymentRecord[];
}
