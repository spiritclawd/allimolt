#!/usr/bin/env python3
"""
eas_attester.py — Zaia Swarm Agent
Runs the AlliGo EAS attestation script for any new claims since last run.
Wraps the TypeScript attest-claims.ts via bun.

Schedule: every 12 hours (new claims picked up automatically)
"""

import os
import subprocess
import sys
import json
import urllib.request
from datetime import datetime
from pathlib import Path

SWARM_DIR = Path(__file__).parent.parent
LOG_DIR = SWARM_DIR / "logs"
ALLIGO_DIR = Path("/home/computer/alligo")
BUN = Path.home() / ".bun/bin/bun"

ADMIN_KEY = os.environ.get("ALLIGO_ADMIN_KEY", "")
# New plain EOA signer — old TaskMarket address was EIP-7702 smart account, can't pay gas
EAS_PRIVATE_KEY = os.environ.get("EAS_PRIVATE_KEY", "0x7ad85048c9e3d16c467fd294a1d5b2fb9662a31a307084cd29b7354dce2fd8ee")
# New onchain schema UID registered 2026-03-17 on Base mainnet
EAS_SCHEMA_UID = os.environ.get("EAS_SCHEMA_UID", "0xb7c0c403941bfa822940a27602e8b9350904b5a13e0ed291f2ccc3d92dc974ba")
EAS_MODE = os.environ.get("EAS_MODE", "onchain")

def log(msg: str):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] [eas_attester] {msg}"
    print(line)
    log_file = LOG_DIR / f"eas_attester_{datetime.now().strftime('%Y-%m-%d')}.log"
    with open(log_file, "a") as f:
        f.write(line + "\n")

EAS_WALLET = os.environ.get("EAS_ATTESTER_ADDRESS", "0xBeE919f77e5b8b14776B5D687e1fb8Bf0080aa1d")
EAS_MIN_ETH = 0.0005  # minimum ETH to proceed with onchain attestation

def check_eas_eth_balance() -> float:
    """Check EAS attester wallet ETH balance on Base Mainnet."""
    payload = json.dumps({
        "jsonrpc": "2.0", "method": "eth_getBalance",
        "params": [EAS_WALLET, "latest"], "id": 1
    }).encode()
    for rpc in ["https://base.llamarpc.com", "https://base-rpc.publicnode.com", "https://mainnet.base.org"]:
        try:
            req = urllib.request.Request(rpc, data=payload,
                headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"}, method="POST")
            with urllib.request.urlopen(req, timeout=8) as r:
                result = json.loads(r.read())
            if "result" in result:
                return int(result["result"], 16) / 1e18
        except Exception:
            continue
    return -1.0  # unknown

def run():
    log("=" * 60)
    log("EAS Attester starting")
    log("=" * 60)

    if not ADMIN_KEY:
        log("ERROR: ALLIGO_ADMIN_KEY not set")
        sys.exit(1)

    # Pre-flight: check ETH balance if running in onchain mode
    if EAS_MODE == "onchain":
        eth_balance = check_eas_eth_balance()
        if eth_balance == -1.0:
            log("⚠️ EAS BLOCKED — could not read wallet balance (RPC error). Skipping attestation run.")
            return
        elif eth_balance < EAS_MIN_ETH:
            log(f"🚫 EAS BLOCKED — waiting for ETH top-up | wallet={EAS_WALLET} | balance={eth_balance:.6f} ETH | required≥{EAS_MIN_ETH} ETH")
            log("   Send ETH on Base Mainnet to resume onchain attestations.")
            return
        else:
            log(f"✅ EAS wallet funded: {eth_balance:.6f} ETH — proceeding with onchain attestation")

    env = os.environ.copy()
    env.update({
        "ALLIGO_ADMIN_KEY": ADMIN_KEY,
        "EAS_PRIVATE_KEY": EAS_PRIVATE_KEY,
        "EAS_SCHEMA_UID": EAS_SCHEMA_UID,
        "EAS_MODE": EAS_MODE,
        "ALLIGO_API": "https://alligo-production.up.railway.app",
    })
    log(f"Mode: {EAS_MODE} | Schema: {EAS_SCHEMA_UID[:20]}...")

    result = subprocess.run(
        [str(BUN), "run", "src/attestation/attest-claims.ts"],
        cwd=str(ALLIGO_DIR),
        env=env,
        capture_output=True,
        text=True,
        timeout=120,
    )

    for line in result.stdout.splitlines():
        log(f"  {line}")
    if result.stderr:
        for line in result.stderr.splitlines():
            log(f"  ERR: {line}")

    if result.returncode == 0:
        log("EAS Attester completed successfully")
    else:
        log(f"EAS Attester failed (exit {result.returncode})")

if __name__ == "__main__":
    run()
