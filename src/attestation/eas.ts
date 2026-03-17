/**
 * AlliGo EAS (Ethereum Attestation Service) Integration
 * Chain: Base Mainnet
 * 
 * AlliGo Schema:
 *   string agentId          - The agent being attested
 *   string incidentType     - AlliGo archetype (e.g. "Goal_Drift_Hijack")
 *   uint256 amountLost      - USD value lost (in cents to avoid floats)
 *   bytes32 txHash          - On-chain evidence tx (zero if none)
 *   uint8 severityScore     - 0-100
 *   string claimId          - AlliGo internal claim ID for cross-reference
 *   bool verified           - Whether AlliGo forensics engine verified this
 *   uint64 incidentDate     - Unix timestamp of incident
 *
 * Attestation modes:
 *   - OFFCHAIN: Signed by AlliGo private key, stored in IPFS/local, verifiable without gas
 *   - ONCHAIN: Written to Base EAS contract (requires ETH for gas)
 *
 * Both modes produce the same schema UID and are equally verifiable.
 * We start with OFFCHAIN and flip to ONCHAIN when gas is available.
 */

import { EAS, SchemaEncoder, Offchain, SchemaRegistry, ZERO_BYTES32 } from "@ethereum-attestation-service/eas-sdk";
import { ethers } from "ethers";

// Base mainnet EAS contracts
export const EAS_CONTRACT_ADDRESS = "0x4200000000000000000000000000000000000021";
export const SCHEMA_REGISTRY_ADDRESS = "0x4200000000000000000000000000000000000020";
export const BASE_RPC = "https://mainnet.base.org";
export const BASE_CHAIN_ID = 8453;

// AlliGo schema definition
export const ALLIGO_SCHEMA = "string agentId,string incidentType,uint256 amountLostCents,bytes32 txHashBytes,uint8 severityScore,string claimId,bool verified,uint64 incidentDate";

// Deployed schema UID on Base — set after first registration
// Will be populated by register-schema script
export let ALLIGO_SCHEMA_UID = process.env.EAS_SCHEMA_UID || "";

export interface AlliGoAttestation {
  agentId: string;
  incidentType: string;
  amountLostCents: number;
  txHash: string;
  severityScore: number;
  claimId: string;
  verified: boolean;
  incidentDate: number;
}

export interface AttestationResult {
  uid: string;
  mode: "onchain" | "offchain";
  txHash?: string;
  signature?: string;
  schemaUid: string;
  encodedData: string;
  verifyUrl: string;
  timestamp: number;
}

function getProvider(): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(BASE_RPC);
}

function getSigner(privateKey: string): ethers.Wallet {
  return new ethers.Wallet(privateKey, getProvider());
}

function encodeAttestation(data: AlliGoAttestation): string {
  const encoder = new SchemaEncoder(ALLIGO_SCHEMA);

  // Convert tx hash string to bytes32
  let txHashBytes = ZERO_BYTES32;
  if (data.txHash && data.txHash.startsWith("0x") && data.txHash.length === 66) {
    txHashBytes = data.txHash as `0x${string}`;
  }

  return encoder.encodeData([
    { name: "agentId", value: data.agentId, type: "string" },
    { name: "incidentType", value: data.incidentType, type: "string" },
    { name: "amountLostCents", value: BigInt(Math.round(data.amountLostCents)), type: "uint256" },
    { name: "txHashBytes", value: txHashBytes, type: "bytes32" },
    { name: "severityScore", value: data.severityScore, type: "uint8" },
    { name: "claimId", value: data.claimId, type: "string" },
    { name: "verified", value: data.verified, type: "bool" },
    { name: "incidentDate", value: BigInt(data.incidentDate), type: "uint64" },
  ]);
}

/**
 * Create an OFFCHAIN attestation (free, no gas required).
 * Cryptographically signed by AlliGo's private key.
 * Verifiable at https://base.easscan.org
 */
export async function createOffchainAttestation(
  data: AlliGoAttestation,
  privateKey: string,
  schemaUid: string
): Promise<AttestationResult> {
  const signer = getSigner(privateKey);
  const offchain = new Offchain(
    {
      address: EAS_CONTRACT_ADDRESS,
      version: "1.0.1",
      chainId: BigInt(BASE_CHAIN_ID),
    },
    1, // Offchain attestation version
    new EAS(EAS_CONTRACT_ADDRESS)
  );

  const encodedData = encodeAttestation(data);
  const now = Math.floor(Date.now() / 1000);

  const attestation = await offchain.signOffchainAttestation(
    {
      schema: schemaUid as `0x${string}`,
      recipient: "0x0000000000000000000000000000000000000000",
      time: BigInt(now),
      expirationTime: BigInt(0),
      revocable: true,
      refUID: ZERO_BYTES32,
      data: encodedData,
    },
    signer
  );

  // Compute UID from the attestation
  const uid = attestation.uid;

  return {
    uid,
    mode: "offchain",
    signature: JSON.stringify(attestation.sig),
    schemaUid,
    encodedData,
    verifyUrl: `https://base.easscan.org/offchain/attestation/view/${uid}`,
    timestamp: now,
  };
}

/**
 * Create an ONCHAIN attestation (requires ETH for gas on Base).
 * Permanent, immutable, queryable via EAS GraphQL.
 *
 * Pass an explicit nonce to avoid "nonce too low" / "replacement underpriced"
 * errors when attesting multiple claims in a single run. Caller should fetch
 * the current confirmed nonce once and increment it per call.
 */
export async function createOnchainAttestation(
  data: AlliGoAttestation,
  privateKey: string,
  schemaUid: string,
  nonce?: number
): Promise<AttestationResult> {
  const signer = getSigner(privateKey);
  const eas = new EAS(EAS_CONTRACT_ADDRESS);
  eas.connect(signer);

  const encodedData = encodeAttestation(data);
  const now = Math.floor(Date.now() / 1000);

  // Build overrides — always pass explicit nonce when provided so Base can't
  // re-use or collide nonces across rapid sequential transactions.
  const overrides: Record<string, unknown> = {};
  if (nonce !== undefined) {
    overrides.nonce = nonce;
  }

  const tx = await eas.attest(
    {
      schema: schemaUid,
      data: {
        recipient: "0x0000000000000000000000000000000000000000",
        expirationTime: BigInt(0),
        revocable: true,
        data: encodedData,
      },
    },
    overrides
  );

  const uid = await tx.wait();
  const receipt = await tx.tx?.wait();

  return {
    uid: uid ?? "",
    mode: "onchain",
    txHash: receipt?.hash,
    schemaUid,
    encodedData,
    verifyUrl: `https://base.easscan.org/attestation/view/${uid}`,
    timestamp: now,
  };
}

/**
 * Register the AlliGo schema on Base EAS SchemaRegistry.
 * Only needs to be called ONCE. Returns the schema UID.
 * Requires ETH for gas.
 */
export async function registerSchema(privateKey: string): Promise<string> {
  const signer = getSigner(privateKey);
  const registry = new SchemaRegistry(SCHEMA_REGISTRY_ADDRESS);
  registry.connect(signer);

  console.log("Registering AlliGo schema on Base EAS...");
  console.log("Schema:", ALLIGO_SCHEMA);

  const tx = await registry.register({
    schema: ALLIGO_SCHEMA,
    resolverAddress: "0x0000000000000000000000000000000000000000",
    revocable: true,
  });

  const uid = await tx.wait();
  console.log("✅ Schema registered! UID:", uid);
  console.log("View at:", `https://base.easscan.org/schema/view/${uid}`);

  return uid ?? "";
}

/**
 * Get the schema UID from Base EAS by computing it deterministically.
 * EAS schema UIDs are deterministic: keccak256(schema + resolver + revocable).
 * This lets us derive the UID before registering (or verify if already registered).
 */
export function computeSchemaUid(schema: string = ALLIGO_SCHEMA): string {
  const resolver = "0x0000000000000000000000000000000000000000";
  const revocable = true;
  
  // ABI encode: (bytes schema, address resolver, bool revocable)
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["bytes", "address", "bool"],
    [ethers.toUtf8Bytes(schema), resolver, revocable]
  );
  
  return ethers.keccak256(encoded);
}

/**
 * Check if AlliGo schema is already registered on Base.
 */
export async function checkSchemaRegistered(schemaUid: string): Promise<boolean> {
  const provider = getProvider();
  const registry = new SchemaRegistry(SCHEMA_REGISTRY_ADDRESS);
  registry.connect(provider);

  try {
    const record = await registry.getSchema({ uid: schemaUid });
    return record.uid === schemaUid;
  } catch {
    return false;
  }
}
