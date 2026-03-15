/**
 * AlliGo - On-Chain Forensics Engine
 * Exhaustive wallet + transaction history analysis
 */

import { config } from "../config";

// RPC endpoints by chain
const RPC_ENDPOINTS: Record<string, string> = {
  ethereum: "https://eth.llamarpc.com",
  base: "https://mainnet.base.org",
  polygon: "https://polygon-rpc.com",
  arbitrum: "https://arb1.arbitrum.io/rpc",
  optimism: "https://mainnet.optimism.io",
  bsc: "https://bsc-dataseed.binance.org",
  solana: "https://api.mainnet-beta.solana.com",
};

// Known exploit/rug contract signatures
const EXPLOIT_SIGNATURES = [
  "0x0000000000000000000000000000000000000000000000000000000000000000", // delegatecall to zero
  "skim()", "sweep()", "drain()", "withdrawAll()", "emergencyWithdraw()",
];

// High-risk protocol categories
const RISKY_PROTOCOLS: Record<string, "high" | "medium" | "low"> = {
  // DEXes (generally safe)
  "uniswap": "low",
  "sushiswap": "low",
  "curve": "low",
  "balancer": "low",
  // Bridges (medium risk)
  "stargate": "medium",
  "across": "medium",
  "hop": "medium",
  // Lending (medium-high)
  "aave": "medium",
  "compound": "medium",
  "lido": "medium",
  // High risk / often exploited
  "multichain": "high",
  "atom": "high",
  "venus": "medium",
  // Unknown/new
  "unknown": "high",
};

export interface ForensicsResult {
  wallet: string;
  chain: string;
  
  // Transaction metrics
  totalTx: number;
  successfulTx: number;
  failedTx: number;
  successRate: number;
  
  // Financial metrics
  totalInflow: number;
  totalOutflow: number;
  netFlow: number;
  cumulativePnL: number;
  
  // Risk metrics
  maxDrawdown: number;
  longestLosingStreak: number;
  avgLossSize: number;
  maxSingleLoss: number;
  
  // Protocol interactions
  protocols: ProtocolInteraction[];
  uniqueProtocols: number;
  riskyProtocolCount: number;
  
  // Anomaly flags
  failedTxPatterns: FailedTxPattern[];
  exploitContractCalls: string[];
  leverageSpikes: LeverageSpike[];
  suddenExposureChanges: ExposureChange[];
  
  // Counterparty analysis
  flaggedCounterparties: string[];
  uniqueCounterparties: number;
  
  // Timeline
  firstActivity: number;
  lastActivity: number;
  activityDays: number;
  
  // Raw data for pattern engine
  txHistory: TransactionSummary[];
  
  // Sources
  sources: string[];
}

export interface ProtocolInteraction {
  name: string;
  address: string;
  txCount: number;
  totalValue: number;
  riskLevel: "high" | "medium" | "low";
}

export interface FailedTxPattern {
  type: "revert" | "out_of_gas" | "slippage" | "front_run" | "unknown";
  count: number;
  totalGasLost: string;
  lastOccurrence: number;
}

export interface LeverageSpike {
  timestamp: number;
  previousLeverage: number;
  newLeverage: number;
  multiplier: number;
}

export interface ExposureChange {
  timestamp: number;
  protocol: string;
  previousExposure: number;
  newExposure: number;
  riskLevel: "high" | "medium" | "low";
}

export interface TransactionSummary {
  hash: string;
  timestamp: number;
  type: "in" | "out" | "swap" | "contract_call" | "failed";
  value: number;
  asset: string;
  counterparty?: string;
  protocol?: string;
  success: boolean;
  gasUsed?: string;
}

/**
 * Run full forensics on a wallet
 */
export async function runForensics(
  wallet: string,
  chain: string = "ethereum",
  options?: {
    depth?: "quick" | "standard" | "deep";
    fromBlock?: number;
    toBlock?: number;
  }
): Promise<ForensicsResult> {
  const depth = options?.depth || "standard";
  
  const result: ForensicsResult = {
    wallet,
    chain,
    totalTx: 0,
    successfulTx: 0,
    failedTx: 0,
    successRate: 0,
    totalInflow: 0,
    totalOutflow: 0,
    netFlow: 0,
    cumulativePnL: 0,
    maxDrawdown: 0,
    longestLosingStreak: 0,
    avgLossSize: 0,
    maxSingleLoss: 0,
    protocols: [],
    uniqueProtocols: 0,
    riskyProtocolCount: 0,
    failedTxPatterns: [],
    exploitContractCalls: [],
    leverageSpikes: [],
    suddenExposureChanges: [],
    flaggedCounterparties: [],
    uniqueCounterparties: 0,
    firstActivity: 0,
    lastActivity: 0,
    activityDays: 0,
    txHistory: [],
    sources: [],
  };

  // Get transaction history
  const txs = await fetchTransactionHistory(wallet, chain, depth);
  result.txHistory = txs;
  result.sources.push(`Analyzed ${txs.length} transactions on ${chain}`);

  // Process transactions
  processTransactions(txs, result);
  
  // Calculate metrics
  calculateMetrics(result);
  
  // Detect patterns
  detectFailedPatterns(txs, result);
  detectExploitCalls(txs, result);
  detectLeverageSpikes(txs, result);
  detectExposureChanges(txs, result);
  analyzeCounterparties(txs, result);

  return result;
}

/**
 * Fetch transaction history from blockchain
 */
async function fetchTransactionHistory(
  wallet: string,
  chain: string,
  depth: "quick" | "standard" | "deep"
): Promise<TransactionSummary[]> {
  const limit = depth === "quick" ? 50 : depth === "standard" ? 500 : 5000;
  
  // In production: Use Etherscan/Blockscout API or direct RPC
  // For now, return mock data structure
  const endpoint = RPC_ENDPOINTS[chain];
  
  if (!endpoint) {
    throw new Error(`Unsupported chain: ${chain}`);
  }

  // Simulated API call structure
  // const response = await fetch(`${endpoint}/api?module=account&action=txlist&address=${wallet}&startblock=0&endblock=99999999&sort=asc&apikey=${apiKey}`);
  
  // For demo, return empty - would be populated from real data
  return [];
}

/**
 * Process transactions to extract metrics
 */
function processTransactions(
  txs: TransactionSummary[],
  result: ForensicsResult
): void {
  if (txs.length === 0) return;

  const inflows: number[] = [];
  const outflows: number[] = [];
  const counterparties = new Set<string>();
  const protocolMap = new Map<string, ProtocolInteraction>();

  for (const tx of txs) {
    result.totalTx++;
    
    if (tx.success) {
      result.successfulTx++;
    } else {
      result.failedTx++;
    }

    if (tx.type === "in") {
      result.totalInflow += tx.value;
      inflows.push(tx.value);
    } else if (tx.type === "out") {
      result.totalOutflow += tx.value;
      outflows.push(tx.value);
    }

    if (tx.counterparty) {
      counterparties.add(tx.counterparty);
    }

    if (tx.protocol) {
      const existing = protocolMap.get(tx.protocol) || {
        name: tx.protocol,
        address: "",
        txCount: 0,
        totalValue: 0,
        riskLevel: "low" as const,
      };
      existing.txCount++;
      existing.totalValue += tx.value;
      protocolMap.set(tx.protocol, existing);
    }
  }

  result.netFlow = result.totalInflow - result.totalOutflow;
  result.cumulativePnL = result.netFlow;
  result.successRate = result.totalTx > 0 ? result.successfulTx / result.totalTx : 1;
  result.uniqueCounterparties = counterparties.size;
  result.protocols = Array.from(protocolMap.values()).map(p => ({
    ...p,
    riskLevel: RISKY_PROTOCOLS[p.name.toLowerCase()] || "high",
  }));
  result.uniqueProtocols = result.protocols.length;
  result.riskyProtocolCount = result.protocols.filter(p => p.riskLevel === "high").length;
  
  // Find first and last activity
  const timestamps = txs.map(t => t.timestamp).filter(Boolean);
  if (timestamps.length > 0) {
    result.firstActivity = Math.min(...timestamps);
    result.lastActivity = Math.max(...timestamps);
    result.activityDays = Math.ceil((result.lastActivity - result.firstActivity) / (1000 * 60 * 60 * 24));
  }
}

/**
 * Calculate risk metrics
 */
function calculateMetrics(result: ForensicsResult): void {
  if (result.txHistory.length === 0) return;

  // Calculate drawdown
  let peak = 0;
  let drawdown = 0;
  let maxDrawdown = 0;
  let currentStreak = 0;
  let longestStreak = 0;
  let totalLoss = 0;
  let lossCount = 0;
  let maxLoss = 0;

  let runningPnL = 0;
  const sortedTxs = [...result.txHistory].sort((a, b) => a.timestamp - b.timestamp);

  for (const tx of sortedTxs) {
    if (tx.type === "in") {
      runningPnL += tx.value;
    } else if (tx.type === "out") {
      runningPnL -= tx.value;
    }

    if (runningPnL > peak) {
      peak = runningPnL;
      drawdown = 0;
    } else {
      drawdown = peak - runningPnL;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    // Track losing streak
    if (tx.type === "out" && tx.value > 0) {
      currentStreak++;
      totalLoss += tx.value;
      lossCount++;
      if (tx.value > maxLoss) maxLoss = tx.value;
    } else {
      if (currentStreak > longestStreak) longestStreak = currentStreak;
      currentStreak = 0;
    }
  }

  result.maxDrawdown = maxDrawdown;
  result.longestLosingStreak = longestStreak;
  result.avgLossSize = lossCount > 0 ? totalLoss / lossCount : 0;
  result.maxSingleLoss = maxLoss;
}

/**
 * Detect failed transaction patterns
 */
function detectFailedPatterns(
  txs: TransactionSummary[],
  result: ForensicsResult
): void {
  const patterns = new Map<string, { count: number; gas: string; last: number }>();

  for (const tx of txs) {
    if (!tx.success) {
      const type = tx.gasUsed === "21000" ? "revert" : 
                   tx.gasUsed && parseInt(tx.gasUsed) > 100000 ? "out_of_gas" :
                   "unknown";
      
      const existing = patterns.get(type) || { count: 0, gas: "0", last: 0 };
      patterns.set(type, {
        count: existing.count + 1,
        gas: (BigInt(existing.gas) + BigInt(tx.gasUsed || "0")).toString(),
        last: Math.max(existing.last, tx.timestamp),
      });
    }
  }

  result.failedTxPatterns = Array.from(patterns.entries()).map(([type, data]) => ({
    type: type as FailedTxPattern["type"],
    count: data.count,
    totalGasLost: data.gas,
    lastOccurrence: data.last,
  }));
}

/**
 * Detect calls to exploit-like contracts
 */
function detectExploitCalls(
  txs: TransactionSummary[],
  result: ForensicsResult
): void {
  const exploitCalls: string[] = [];

  for (const tx of txs) {
    // In production: Check if tx.to matches known exploit signatures
    // Check for delegatecall to suspicious addresses
    // Check for contract creation with suspicious bytecode
  }

  result.exploitContractCalls = exploitCalls;
}

/**
 * Detect leverage spikes
 */
function detectLeverageSpikes(
  txs: TransactionSummary[],
  result: ForensicsResult
): void {
  // In production: Analyze DeFi positions over time
  // Detect sudden increases in leverage ratio
  result.leverageSpikes = [];
}

/**
 * Detect sudden exposure changes
 */
function detectExposureChanges(
  txs: TransactionSummary[],
  result: ForensicsResult
): void {
  // In production: Track protocol exposure over time
  // Flag sudden large deposits to new/risky protocols
  result.suddenExposureChanges = [];
}

/**
 * Analyze counterparties for flagged addresses
 */
async function analyzeCounterparties(
  txs: TransactionSummary[],
  result: ForensicsResult
): Promise<void> {
  // In production: Check counterparties against known exploit/rug addresses
  // Could integrate with Chainalysis, Elliptic, or community databases
  result.flaggedCounterparties = [];
}

/**
 * Quick forensics check (lightweight)
 */
export async function quickForensics(
  wallet: string,
  chain: string = "ethereum"
): Promise<{
  riskFlags: string[];
  riskScore: number;
}> {
  const forensics = await runForensics(wallet, chain, { depth: "quick" });
  
  const riskFlags: string[] = [];
  let riskScore = 100;

  // Apply risk deductions
  if (forensics.successRate < 0.8) {
    riskFlags.push(`Low tx success rate: ${(forensics.successRate * 100).toFixed(1)}%`);
    riskScore -= 15;
  }

  if (forensics.riskyProtocolCount > 3) {
    riskFlags.push(`Many risky protocol interactions: ${forensics.riskyProtocolCount}`);
    riskScore -= 20;
  }

  if (forensics.maxDrawdown > 10000) {
    riskFlags.push(`Large max drawdown: $${forensics.maxDrawdown.toLocaleString()}`);
    riskScore -= 10;
  }

  if (forensics.failedTxPatterns.length > 2) {
    riskFlags.push(`Multiple failure patterns detected`);
    riskScore -= 15;
  }

  if (forensics.exploitContractCalls.length > 0) {
    riskFlags.push(`Calls to suspicious contracts detected`);
    riskScore -= 30;
  }

  if (forensics.flaggedCounterparties.length > 0) {
    riskFlags.push(`Interactions with flagged addresses`);
    riskScore -= 25;
  }

  return { riskFlags, riskScore: Math.max(0, riskScore) };
}
