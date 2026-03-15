/**
 * AlliGo - Identity & Attribution Resolution
 * ERC-8004 Registry Integration + Wallet Clustering
 */

import { config } from "../config";

// ERC-8004 Agent Registry Interface (simplified ABI)
const ERC8004_REGISTRY_ABI = [
  "function agentOf(address wallet) view returns (uint256 tokenId)",
  "function agentCard(uint256 tokenId) view returns (tuple(string name, address primaryWallet, string endpoints, bytes32 metadataHash, uint256 createdAt))",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function reputation(uint256 tokenId) view returns (uint256 score, uint256 claims, uint256 lastUpdated)",
];

// Registry addresses by chain
const REGISTRY_ADDRESSES: Record<string, string> = {
  ethereum: "0x0000000000008004A1cB444Aa86274eDEdBcED9E", // Placeholder - would be actual ERC-8004 registry
  base: "0x0000000000008004A1cB444Aa86274eDEdBcED9E",
  polygon: "0x0000000000008004A1cB444Aa86274eDEdBcED9E",
};

export interface IdentityResolution {
  inputId: string;
  resolvedType: "erc8004" | "wallet" | "ens" | "handle" | "marketplace" | "unattributed";
  confidence: number; // 0-1
  
  // ERC-8004 data if registered
  erc8004?: {
    registered: boolean;
    tokenId?: string;
    agentCardHash?: string;
    primaryWallet?: string;
    name?: string;
    endpoints?: string[];
    capabilities?: string[];
    createdAt?: number;
  };
  
  // Wallet clustering
  associatedWallets?: string[];
  fundingSources?: string[];
  
  // Risk modifiers
  riskModifiers: {
    anonymityPenalty: number;
    unattributedPenalty: number;
    newAccountPenalty: number;
  };
  
  // Sources
  sources: string[];
}

/**
 * Resolve agent identity from any identifier
 */
export async function resolveIdentity(
  agentId: string,
  options?: { chain?: string }
): Promise<IdentityResolution> {
  const result: IdentityResolution = {
    inputId: agentId,
    resolvedType: "unattributed",
    confidence: 0,
    riskModifiers: {
      anonymityPenalty: 0,
      unattributedPenalty: 30, // Default penalty
      newAccountPenalty: 0,
    },
    sources: [],
  };

  // Determine input type
  if (isWalletAddress(agentId)) {
    return resolveWalletIdentity(agentId, options?.chain || "ethereum", result);
  } else if (isENSName(agentId)) {
    return resolveENSIdentity(agentId, result);
  } else if (isTwitterHandle(agentId)) {
    return resolveHandleIdentity(agentId, result);
  } else if (isMarketplaceUrl(agentId)) {
    return resolveMarketplaceIdentity(agentId, result);
  } else {
    // Generic name/handle resolution
    return resolveGenericIdentity(agentId, result);
  }
}

/**
 * Check if string is a wallet address
 */
function isWalletAddress(id: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(id) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(id);
}

/**
 * Check if string is an ENS name
 */
function isENSName(id: string): boolean {
  return /\.eth$/.test(id.toLowerCase());
}

/**
 * Check if string is a Twitter/X handle
 */
function isTwitterHandle(id: string): boolean {
  return /^@?[a-zA-Z0-9_]{1,15}$/.test(id) && !id.startsWith("0x");
}

/**
 * Check if string is a marketplace URL
 */
function isMarketplaceUrl(id: string): boolean {
  return /^https?:\/\//.test(id) && (
    id.includes("pump.fun") ||
    id.includes("virtuals.io") ||
    id.includes("eliza.gg") ||
    id.includes("autofun") ||
    id.includes("agent.market")
  );
}

/**
 * Resolve wallet address identity
 */
async function resolveWalletIdentity(
  wallet: string,
  chain: string,
  result: IdentityResolution
): Promise<IdentityResolution> {
  result.resolvedType = "wallet";
  result.confidence = 0.5;
  result.sources.push(`Direct wallet: ${wallet}`);

  // Check ERC-8004 registration
  const erc8004Data = await checkERC8004Registration(wallet, chain);
  if (erc8004Data.registered) {
    result.erc8004 = erc8004Data;
    result.resolvedType = "erc8004";
    result.confidence = 0.95;
    result.riskModifiers.unattributedPenalty = 0;
    result.sources.push(`ERC-8004 registered: tokenId ${erc8004Data.tokenId}`);
  } else {
    // Check for on-chain activity to boost confidence
    const activityScore = await checkOnChainActivity(wallet, chain);
    if (activityScore > 0) {
      result.confidence = Math.min(0.8, 0.5 + activityScore * 0.3);
      result.riskModifiers.unattributedPenalty = 15; // Reduced penalty for active wallet
    }
  }

  // Check wallet age for new account penalty
  const walletAge = await getWalletAge(wallet, chain);
  if (walletAge < 30) {
    result.riskModifiers.newAccountPenalty = 20;
    result.sources.push(`New wallet: ${walletAge} days old`);
  }

  // Find associated wallets via clustering
  result.associatedWallets = await findAssociatedWallets(wallet, chain);
  if (result.associatedWallets.length > 0) {
    result.sources.push(`Found ${result.associatedWallets.length} associated wallets`);
  }

  return result;
}

/**
 * Resolve ENS name to identity
 */
async function resolveENSIdentity(
  ensName: string,
  result: IdentityResolution
): Promise<IdentityResolution> {
  result.resolvedType = "ens";
  result.confidence = 0.6;
  result.sources.push(`ENS name: ${ensName}`);

  // Resolve ENS to address
  try {
    const address = await resolveENSToAddress(ensName);
    if (address) {
      result.erc8004 = {
        registered: false,
        primaryWallet: address,
      };
      result.associatedWallets = [address];
      result.confidence = 0.75;
      
      // Now resolve as wallet
      return resolveWalletIdentity(address, "ethereum", result);
    }
  } catch (e) {
    result.sources.push(`ENS resolution failed`);
  }

  return result;
}

/**
 * Resolve Twitter/X handle
 */
async function resolveHandleIdentity(
  handle: string,
  result: IdentityResolution
): Promise<IdentityResolution> {
  result.resolvedType = "handle";
  result.confidence = 0.3;
  result.riskModifiers.anonymityPenalty = 10;
  result.sources.push(`Social handle: ${handle}`);

  // In production: Query social-to-wallet mappings
  // For now, check if we have it in our database
  const linkedWallet = await findWalletByHandle(handle);
  if (linkedWallet) {
    result.erc8004 = {
      registered: false,
      primaryWallet: linkedWallet,
    };
    result.associatedWallets = [linkedWallet];
    result.confidence = 0.6;
    result.sources.push(`Found linked wallet: ${linkedWallet}`);
  }

  return result;
}

/**
 * Resolve marketplace listing
 */
async function resolveMarketplaceIdentity(
  url: string,
  result: IdentityResolution
): Promise<IdentityResolution> {
  result.resolvedType = "marketplace";
  result.confidence = 0.4;
  result.sources.push(`Marketplace URL: ${url}`);

  // Extract agent ID from URL
  const agentId = extractAgentIdFromUrl(url);
  if (agentId) {
    // Check if marketplace has wallet mapping
    const marketplaceData = await fetchMarketplaceData(url);
    if (marketplaceData?.wallet) {
      result.erc8004 = {
        registered: false,
        primaryWallet: marketplaceData.wallet,
        name: marketplaceData.name,
      };
      result.confidence = 0.7;
      result.sources.push(`Marketplace wallet: ${marketplaceData.wallet}`);
    }
  }

  return result;
}

/**
 * Resolve generic identity
 */
async function resolveGenericIdentity(
  id: string,
  result: IdentityResolution
): Promise<IdentityResolution> {
  result.resolvedType = "unattributed";
  result.confidence = 0.1;
  result.sources.push(`Generic identifier: ${id}`);

  // Check our database for known agents
  const knownAgent = await checkKnownAgent(id);
  if (knownAgent) {
    result.erc8004 = {
      registered: false,
      primaryWallet: knownAgent.wallet,
      name: knownAgent.name,
    };
    result.confidence = 0.5;
    result.riskModifiers.unattributedPenalty = 10;
    result.sources.push(`Found in AlliGo database`);
  }

  return result;
}

/**
 * Check ERC-8004 registration
 */
async function checkERC8004Registration(
  wallet: string,
  chain: string
): Promise<{
  registered: boolean;
  tokenId?: string;
  agentCardHash?: string;
  primaryWallet?: string;
  name?: string;
  endpoints?: string[];
  capabilities?: string[];
  createdAt?: number;
}> {
  // In production: Query actual ERC-8004 registry
  // For now, return mock data structure
  const registryAddress = REGISTRY_ADDRESSES[chain];
  
  if (!registryAddress) {
    return { registered: false };
  }

  // Simulated check - in production would use ethers.js or viem
  // const provider = getProvider(chain);
  // const registry = new Contract(registryAddress, ERC8004_REGISTRY_ABI, provider);
  // const tokenId = await registry.agentOf(wallet);
  
  return { registered: false };
}

/**
 * Check on-chain activity score
 */
async function checkOnChainActivity(wallet: string, chain: string): Promise<number> {
  // In production: Query Etherscan/Blockscout API
  // Return 0-1 score based on tx count and age
  return 0.5; // Placeholder
}

/**
 * Get wallet age in days
 */
async function getWalletAge(wallet: string, chain: string): Promise<number> {
  // In production: Query first tx timestamp
  return 365; // Placeholder - 1 year
}

/**
 * Find associated wallets via clustering
 */
async function findAssociatedWallets(wallet: string, chain: string): Promise<string[]> {
  // In production: Use on-chain heuristics
  // - Same deployer
  // - Funding from same source
  // - Similar tx patterns
  return [];
}

/**
 * Resolve ENS to address
 */
async function resolveENSToAddress(ensName: string): Promise<string | null> {
  // In production: Use ethers.js resolver
  return null;
}

/**
 * Find wallet by social handle
 */
async function findWalletByHandle(handle: string): Promise<string | null> {
  // In production: Query our database or external APIs
  return null;
}

/**
 * Extract agent ID from marketplace URL
 */
function extractAgentIdFromUrl(url: string): string | null {
  const patterns = [
    /pump\.fun\/([a-zA-Z0-9]+)/,
    /virtuals\.io\/agents\/([a-zA-Z0-9_-]+)/,
    /eliza\.gg\/agents\/([a-zA-Z0-9_-]+)/,
  ];
  
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

/**
 * Fetch marketplace data
 */
async function fetchMarketplaceData(url: string): Promise<{
  wallet?: string;
  name?: string;
} | null> {
  // In production: Scrape or API call
  return null;
}

/**
 * Check if agent is known in our database
 */
async function checkKnownAgent(id: string): Promise<{
  wallet?: string;
  name?: string;
} | null> {
  // Import database function
  const { getClaimsByAgent } = await import("../api/db");
  const claims = getClaimsByAgent(id);
  
  if (claims.length > 0) {
    return {
      name: claims[0].agentName || id,
      wallet: claims[0].developer || undefined,
    };
  }
  return null;
}

/**
 * Calculate total risk penalty from modifiers
 */
export function calculateRiskPenalty(resolution: IdentityResolution): number {
  const { anonymityPenalty, unattributedPenalty, newAccountPenalty } = resolution.riskModifiers;
  return Math.min(50, anonymityPenalty + unattributedPenalty + newAccountPenalty);
}
