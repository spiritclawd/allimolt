/**
 * AlliGo EAS Batch Attester
 * 
 * Takes verified AlliGo claims and creates EAS attestations on Base.
 * Runs in OFFCHAIN mode by default (free, no gas).
 * Set EAS_MODE=onchain and fund EAS_ATTESTER_ADDRESS for on-chain mode.
 *
 * Usage:
 *   bun run src/attestation/attest-claims.ts
 *   EAS_MODE=onchain EAS_PRIVATE_KEY=0x... bun run src/attestation/attest-claims.ts
 *
 * Output:
 *   - Writes attestation records to logs/eas-attestations.jsonl
 *   - Patches each claim in AlliGo DB with eas_uid field
 *   - Prints verify URLs for each attestation
 */

import { createOffchainAttestation, createOnchainAttestation, computeSchemaUid, ALLIGO_SCHEMA, BASE_RPC, type AlliGoAttestation, type AttestationResult } from "./eas";
import { ethers } from "ethers";
import { writeFileSync, appendFileSync, existsSync, readFileSync, mkdirSync } from "fs";
import { join } from "path";

const ALLIGO_API = process.env.ALLIGO_API || "https://alligo-production.up.railway.app";
const ADMIN_KEY = process.env.ALLIGO_ADMIN_KEY || "";
const EAS_MODE = (process.env.EAS_MODE || "offchain") as "offchain" | "onchain";
// Use TaskMarket wallet private key for signing
const PRIVATE_KEY = process.env.EAS_PRIVATE_KEY || "0x0f842410e0109a4f6b6e72b40447acc14089c82de5e0b0f6a3c7bee9d05f2a11";
const SCHEMA_UID = process.env.EAS_SCHEMA_UID || computeSchemaUid();

const LOG_DIR = join(process.cwd(), "logs");
const ATTESTATION_LOG = join(LOG_DIR, "eas-attestations.jsonl");

function log(msg: string) {
  const line = `[${new Date().toISOString()}] [eas-attester] ${msg}`;
  console.log(line);
}

async function fetchClaims(): Promise<any[]> {
  const resp = await fetch(`${ALLIGO_API}/api/claims?limit=200`, {
    headers: { Authorization: `Bearer ${ADMIN_KEY}` },
  });
  const data = await resp.json() as any;
  return data.claims || [];
}

async function patchClaimEasUid(claimId: string, easUid: string, verifyUrl: string, mode: string): Promise<string> {
  // Store EAS uid in the claim via PATCH
  const resp = await fetch(`${ALLIGO_API}/api/admin/claims/${claimId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${ADMIN_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ eas_uid: easUid, eas_verify_url: verifyUrl, eas_mode: mode }),
  });
  const text = await resp.text();
  return `${resp.status} ${text.slice(0, 80)}`;
}

function claimToAttestation(claim: any): AlliGoAttestation {
  return {
    agentId: claim.agentId || claim.agent_id || "unknown",
    incidentType: claim.claimType || claim.claim_type || "unknown",
    amountLostCents: Math.round((claim.amountLost || 0) * 100),
    txHash: claim.txHash || claim.tx_hash || "",
    severityScore: Math.round(claim.severity?.score || 50),
    claimId: claim.id,
    verified: claim.verified === true,
    incidentDate: claim.timestamp ? Math.floor(new Date(claim.timestamp).getTime() / 1000) : Math.floor(Date.now() / 1000),
  };
}

function loadAttested(): Set<string> {
  if (!existsSync(ATTESTATION_LOG)) return new Set();
  const lines = readFileSync(ATTESTATION_LOG, "utf-8").trim().split("\n");
  const attested = new Set<string>();
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      if (record.claimId) attested.add(record.claimId);
    } catch {}
  }
  return attested;
}

async function main() {
  log("=".repeat(60));
  log(`AlliGo EAS Batch Attester — mode: ${EAS_MODE}`);
  log(`Schema UID: ${SCHEMA_UID}`);
  log(`Signer: ${new ethers.Wallet(PRIVATE_KEY).address}`);
  log("=".repeat(60));

  mkdirSync(LOG_DIR, { recursive: true });

  if (!ADMIN_KEY) {
    log("ERROR: ALLIGO_ADMIN_KEY not set");
    process.exit(1);
  }

  const claims = await fetchClaims();
  log(`Fetched ${claims.length} claims`);

  // Only attest verified claims or high-value claims
  const eligible = claims.filter(c => 
    c.verified === true || (c.amountLost && c.amountLost >= 100_000)
  );
  log(`Eligible for attestation: ${eligible.length} (verified or >$100k)`);

  const alreadyAttested = loadAttested();
  const toAttest = eligible.filter(c => !alreadyAttested.has(c.id));
  log(`New to attest: ${toAttest.length}`);

  if (toAttest.length === 0) {
    log("Nothing new to attest. Done.");
    return;
  }

  let successCount = 0;
  let failCount = 0;

  // Fetch starting nonce once (confirmed, not pending) to avoid collisions.
  // We increment manually per successful tx submission so rapid sequential
  // attestations don't race on the same nonce.
  let currentNonce: number | undefined;
  if (EAS_MODE === "onchain") {
    const provider = new ethers.JsonRpcProvider(BASE_RPC);
    const wallet = new ethers.Wallet(PRIVATE_KEY);
    currentNonce = await provider.getTransactionCount(wallet.address, "latest");
    log(`Starting nonce: ${currentNonce} (address: ${wallet.address})`);
  }

  for (const claim of toAttest) {
    const attestData = claimToAttestation(claim);
    log(`\nAttesting: ${claim.title?.slice(0, 60)} ($${(claim.amountLost || 0).toLocaleString()})`);
    log(`  agentId=${attestData.agentId} type=${attestData.incidentType} verified=${attestData.verified}`);

    try {
      let result: AttestationResult;
      
      if (EAS_MODE === "onchain") {
        log(`  nonce=${currentNonce}`);
        result = await createOnchainAttestation(attestData, PRIVATE_KEY, SCHEMA_UID, currentNonce);
        log(`  ✅ ONCHAIN tx: ${result.txHash}`);
        // Increment nonce only after successful submission
        currentNonce = (currentNonce ?? 0) + 1;
      } else {
        result = await createOffchainAttestation(attestData, PRIVATE_KEY, SCHEMA_UID);
        log(`  ✅ OFFCHAIN uid: ${result.uid.slice(0, 20)}...`);
      }
      
      log(`  🔗 Verify: ${result.verifyUrl}`);

      // Log attestation record
      const record = {
        claimId: claim.id,
        claimTitle: claim.title,
        easUid: result.uid,
        mode: result.mode,
        txHash: result.txHash,
        verifyUrl: result.verifyUrl,
        schemaUid: result.schemaUid,
        timestamp: new Date().toISOString(),
        attestData,
      };
      appendFileSync(ATTESTATION_LOG, JSON.stringify(record) + "\n");

      // Patch claim DB with EAS uid
      const patchResp = await patchClaimEasUid(claim.id, result.uid, result.verifyUrl, result.mode);
      log(`  DB patch: ${patchResp}`);

      successCount++;
    } catch (e: any) {
      log(`  ❌ Failed: ${e.message?.split("\n")[0]}`);
      failCount++;
      // On failure, re-fetch the confirmed nonce in case we're out of sync
      if (EAS_MODE === "onchain") {
        try {
          const provider = new ethers.JsonRpcProvider(BASE_RPC);
          const wallet = new ethers.Wallet(PRIVATE_KEY);
          currentNonce = await provider.getTransactionCount(wallet.address, "latest");
          log(`  Nonce re-synced to ${currentNonce} after failure`);
        } catch {}
      }
    }

    // Small delay to let Base broadcast — nonce is now explicit so this is just courtesy
    await new Promise(r => setTimeout(r, 500));
  }

  log("\n" + "=".repeat(60));
  log(`Attestation complete:`);
  log(`  Success: ${successCount}`);
  log(`  Failed:  ${failCount}`);
  log(`  Log: ${ATTESTATION_LOG}`);
  log(`  Schema: https://base.easscan.org/schema/view/${SCHEMA_UID}`);
  log("=".repeat(60));
}

main().catch(console.error);
