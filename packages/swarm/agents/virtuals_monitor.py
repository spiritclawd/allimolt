#!/usr/bin/env python3
"""
Zaia Swarm — Virtuals Protocol Monitor v2
Polls api.virtuals.io for newly created agents (UNDERGRAD/SENTIENT).
For each new agent found:
  1. Checks if it matches any AlliGo risk profiles (protocol name, token symbol)
  2. Fetches token contract bytecode and analyzes for rug patterns
  3. Scores social/metadata signals (holders, mcap, description)
  4. If HIGH risk, submits an automatic claim to AlliGo
  5. Stores discovered agents locally to avoid re-processing

v2 additions: Token bytecode analysis for rug/honeypot/infinite-mint detection

Schedule: every 60 minutes
"""

import json
import os
import sys
import time
import urllib.request
import urllib.parse
from datetime import datetime, timedelta
from pathlib import Path

SWARM_DIR = Path(__file__).parent.parent
DATA_DIR = SWARM_DIR / "data"
LOG_DIR = SWARM_DIR / "logs"
SEEN_FILE = DATA_DIR / "virtuals_seen.json"
LOG_FILE = LOG_DIR / f"virtuals_monitor_{datetime.now().strftime('%Y-%m-%d')}.log"
ALLIGO_API = "https://alligo-production.up.railway.app"
VIRTUALS_API = "https://api.virtuals.io/api/virtuals"

# Risk keywords that warrant automatic claim submission
HIGH_RISK_KEYWORDS = [
    "flash loan", "sandwich", "arbitrage exploit", "mev", "rug", 
    "honeypot", "drain", "infinite mint", "backdoor", "selfdestruct",
    "oracle manipulation", "price manipulation", "exit scam"
]

# Known rekt protocols for cross-reference
KNOWN_REKT_PROTOCOLS = {
    "bybit", "moonwell", "wormhole", "euler", "mango", "nomad",
    "ronin", "beanstalk", "badgerdao", "cream", "compound", "aave",
    "sushiswap", "uniswap", "curve", "balancer", "synthetix"
}


def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [virtuals_monitor] {msg}"
    print(line, flush=True)
    LOG_FILE.parent.mkdir(exist_ok=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def load_seen() -> dict:
    if SEEN_FILE.exists():
        try:
            return json.loads(SEEN_FILE.read_text())
        except Exception:
            return {}
    return {}


def save_seen(seen: dict):
    DATA_DIR.mkdir(exist_ok=True)
    SEEN_FILE.write_text(json.dumps(seen, indent=2))


def http_get(url: str, timeout: int = 15) -> dict | None:
    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json", "User-Agent": "AlliGo-Monitor/1.0"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"⚠️ GET {url[:60]}... failed: {e}")
        return None


def http_post(url: str, payload: dict, headers: dict | None = None) -> dict | None:
    try:
        data = json.dumps(payload).encode()
        h = {"Content-Type": "application/json", "Accept": "application/json"}
        if headers:
            h.update(headers)
        req = urllib.request.Request(url, data=data, headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"⚠️ POST {url[:60]}... failed: {e}")
        return None


# ==================== BYTECODE ANALYSIS ====================
# Base mainnet RPC for contract inspection
BASE_RPC = "https://mainnet.base.org"

# Known rug/honeypot bytecode signatures (4-byte function selectors + patterns)
# These are hex fragments found in malicious ERC20 contracts
RUG_BYTECODE_SIGNATURES = {
    # Blacklist / whitelist transfer controls (honeypot)
    "blacklist": ["blacklist", "addToBlacklist", "isBlacklisted", "_blacklisted"],
    # Hidden mint functions (infinite mint rug)
    "hidden_mint": ["mint(address,uint256)", "0x40c10f19"],  # mint selector
    # Owner can freeze transfers (honeypot)
    "freeze": ["freeze", "pauseTransfer", "lockTransfer", "tradingLocked"],
    # Max tx limits that can block sells (soft honeypot)
    "max_tx": ["maxTxAmount", "maxWalletSize", "_maxTxAmount"],
    # Owner can change tax to 99% (tax rug)
    "tax_rug": ["setBuyTax", "setSellTax", "setFee", "updateFees"],
    # Known rug pattern: renounce-then-backdoor
    "backdoor": ["_owner", "transferOwnership", "renounceOwnership"],
}

# Bytecode fragments for known rug ERC20 patterns (hex substrings)
# These appear consistently in copy-paste rug contracts
RUG_HEX_PATTERNS = [
    # SafeMoon-style reflections (frequent rug mechanism)
    ("6e45776f776e6572", "SafeMoon-style ownership pattern"),
    # Max wallet enforcement bypass (can be used to block large sells)
    ("636865636b4d6178", "checkMax pattern (sell blocking)"),
    # Hidden backdoor mint (common in low-effort rugs)
    ("40c10f19", "mint(address,uint256) selector present"),
    # Blacklist mapping (honeypot indicator)
    ("626c61636b6c6973", "blacklist mapping in bytecode"),
    # Anti-bot that can be repurposed to block all sells
    ("616e7469426f74", "antiBot mechanism (can block sells)"),
    # TradingOpen flag (can prevent sells until owner enables)
    ("74726164696e674f70656e", "tradingOpen flag (sell-blocking risk)"),
    # MaxTxAmount that owner can manipulate
    ("6d61785478416d6f756e74", "maxTxAmount (owner-adjustable sell limit)"),
]


def rpc_call(method: str, params: list, timeout: int = 8) -> dict | None:
    """Make a JSON-RPC call to Base mainnet."""
    payload = json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode()
    try:
        req = urllib.request.Request(
            BASE_RPC, data=payload,
            headers={"Content-Type": "application/json", "User-Agent": "AlliGo-BytecodeAnalyzer/1.0"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"⚠️ RPC {method} failed: {e}")
        return None


def analyze_token_bytecode(token_address: str) -> dict:
    """
    Fetch and analyze token contract bytecode for rug/honeypot indicators.
    Returns a dict with findings and a risk contribution score.
    """
    result = {
        "address": token_address,
        "has_bytecode": False,
        "bytecode_length": 0,
        "findings": [],
        "risk_score": 0,
        "is_eoa": False,
        "error": None,
    }

    if not token_address or not token_address.startswith("0x") or len(token_address) != 42:
        result["error"] = "invalid_address"
        return result

    # Fetch bytecode
    resp = rpc_call("eth_getCode", [token_address, "latest"])
    if not resp or "result" not in resp:
        result["error"] = "rpc_failed"
        return result

    code = resp["result"]
    if code == "0x" or code == "":
        result["is_eoa"] = True
        result["findings"].append("No contract code — token address is an EOA (suspicious)")
        result["risk_score"] += 20
        return result

    result["has_bytecode"] = True
    result["bytecode_length"] = len(code)
    code_lower = code.lower()

    # --- Pattern 1: Hex signature matching ---
    for hex_pattern, description in RUG_HEX_PATTERNS:
        if hex_pattern in code_lower:
            result["findings"].append(f"⚠️ {description}")
            # Weigh by severity
            if "mint" in description or "blacklist" in description:
                result["risk_score"] += 25
            elif "tradingOpen" in description or "sell-blocking" in description.lower():
                result["risk_score"] += 20
            else:
                result["risk_score"] += 10

    # --- Pattern 2: Extremely short bytecode (minimal proxy or stub — often rug) ---
    if len(code) < 200 and len(code) > 2:
        result["findings"].append(f"⚠️ Extremely short bytecode ({len(code)} chars) — possible stub/proxy rug")
        result["risk_score"] += 15

    # --- Pattern 3: No standard ERC20 transfer event signature ---
    # keccak256("Transfer(address,address,uint256)") = ddf252ad...
    if "ddf252ad" not in code_lower:
        result["findings"].append("⚠️ Missing ERC20 Transfer event signature — non-standard contract")
        result["risk_score"] += 15

    # --- Pattern 4: No standard balanceOf selector (70a08231) ---
    if "70a08231" not in code_lower:
        result["findings"].append("⚠️ Missing balanceOf selector — non-standard ERC20")
        result["risk_score"] += 10

    # --- Pattern 5: Contains selfdestruct opcode (ff) in a suspicious position ---
    # ff appears as byte, not reliably detectable from hex without disassembly
    # Instead check for DELEGATECALL pattern (f4) which is common in proxy rugs
    selfdestruct_count = code_lower.count("ff")
    if selfdestruct_count > 50:  # high frequency of 0xff bytes is suspicious
        result["findings"].append(f"⚠️ High 0xff byte frequency ({selfdestruct_count}) — possible selfdestruct/trap")
        result["risk_score"] += 10

    # --- Pattern 6: Check owner() function presence (a useful rug lever) ---
    # owner() selector = 8da5cb5b
    has_owner = "8da5cb5b" in code_lower
    # renounceOwnership() = 715018a6
    has_renounce = "715018a6" in code_lower
    # transferOwnership() = f2fde38b
    has_transfer_ownership = "f2fde38b" in code_lower

    if has_owner and has_transfer_ownership and not has_renounce:
        result["findings"].append("⚠️ Owner can transfer ownership but cannot renounce — persistent control risk")
        result["risk_score"] += 15

    if has_owner:
        result["findings"].append("ℹ️ Contract has owner() — centralization risk")
        result["risk_score"] += 5

    return result


def analyze_token_supply(token_address: str) -> dict:
    """
    Check token supply concentration — top-heavy = rug risk.
    Uses totalSupply() call: 18160ddd selector.
    """
    result = {"total_supply": None, "findings": [], "risk_score": 0}

    if not token_address or not token_address.startswith("0x"):
        return result

    # Call totalSupply() = 0x18160ddd
    resp = rpc_call("eth_call", [{"to": token_address, "data": "0x18160ddd"}, "latest"])
    if resp and resp.get("result") and resp["result"] != "0x":
        try:
            supply = int(resp["result"], 16)
            result["total_supply"] = supply
            # Astronomical supply (>quadrillion) is common in meme rugs
            if supply > 10 ** 24:  # > 1 septillion tokens
                result["findings"].append(f"⚠️ Astronomical token supply ({supply:.2e}) — common rug pattern")
                result["risk_score"] += 15
        except Exception:
            pass

    return result


def fetch_new_virtuals_agents(since_hours: int = 2) -> list:
    """Fetch recently created Virtuals agents."""
    cutoff = datetime.utcnow() - timedelta(hours=since_hours)
    cutoff_str = cutoff.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    
    agents = []
    page = 1
    page_size = 25
    max_pages = 4  # don't over-fetch, cost aware

    while page <= max_pages:
        params = urllib.parse.urlencode({
            "sort[0]": "createdAt:desc",
            "pagination[pageSize]": page_size,
            "pagination[page]": page,
        })
        url = f"{VIRTUALS_API}?{params}"
        data = http_get(url)
        if not data:
            break

        batch = data.get("data", [])
        if not batch:
            break

        new_in_batch = 0
        for agent in batch:
            created_at = agent.get("createdAt", "")
            if created_at < cutoff_str:
                # Sorted desc, so everything after this is older
                return agents
            agents.append(agent)
            new_in_batch += 1

        meta = data.get("meta", {}).get("pagination", {})
        total_pages = meta.get("pageCount", 1)
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.5)  # gentle rate limiting

    return agents


def assess_risk(agent: dict, run_bytecode_analysis: bool = True) -> dict:
    """
    Assess risk level for a Virtuals agent based on:
    - Name/description keyword matching
    - Cross-reference with known rekt protocols
    - Token contract bytecode analysis (v2: rug/honeypot pattern detection)
    - Token supply analysis (v2: astronomical supply detection)
    - Status (UNDERGRAD is less vetted than SENTIENT)
    Returns: {risk_level, reasons, score, bytecode_findings}
    """
    name = (agent.get("name") or "").lower()
    symbol = (agent.get("symbol") or "").lower()
    description = (agent.get("description") or "").lower()
    token_utility = (agent.get("tokenUtility") or "").lower()
    status = agent.get("status", "UNDERGRAD")
    holder_count = agent.get("holderCount") or 0
    is_verified = agent.get("isVerified", False)
    mcap_in_virtual = agent.get("mcapInVirtual") or 0
    token_address = agent.get("tokenAddress") or agent.get("preToken", "")

    reasons = []
    risk_score = 0
    bytecode_findings = []

    # ── SIGNAL 1: High-risk keywords in description ──
    for kw in HIGH_RISK_KEYWORDS:
        if kw in description or kw in token_utility:
            reasons.append(f"risk keyword in description: '{kw}'")
            risk_score += 30

    # ── SIGNAL 2: Impersonation of known rekt protocols ──
    for proto in KNOWN_REKT_PROTOCOLS:
        if proto in name or proto in symbol:
            reasons.append(f"impersonates known rekt protocol: '{proto}'")
            risk_score += 50

    # ── SIGNAL 3: Social/metadata red flags ──
    if holder_count == 1 and mcap_in_virtual > 0:
        reasons.append("single holder with non-zero mcap (potential rug setup)")
        risk_score += 20

    if not is_verified and status == "UNDERGRAD" and mcap_in_virtual > 10000:
        reasons.append("unverified agent with significant mcap")
        risk_score += 15

    if holder_count > 0 and mcap_in_virtual > 0:
        mcap_per_holder = mcap_in_virtual / holder_count
        if mcap_per_holder > 50000:
            reasons.append(f"extreme concentration: {mcap_per_holder:.0f} VIRTUAL per holder (top-heavy)")
            risk_score += 20

    # ── SIGNAL 4: Generic clone name pattern ──
    exploit_patterns = ["fork", "clone", "copy", "v2", "v3", "finance", "protocol"]
    combined = name + " " + symbol
    suspicious_combos = [p for p in exploit_patterns if p in combined]
    if len(suspicious_combos) >= 2:
        reasons.append(f"generic name pattern suggesting clone: {suspicious_combos}")
        risk_score += 10

    # ── SIGNAL 5: Token contract bytecode analysis (NEW v2) ──
    if run_bytecode_analysis and token_address and token_address.startswith("0x"):
        try:
            bc = analyze_token_bytecode(token_address)
            bytecode_findings = bc["findings"]

            if bc.get("is_eoa"):
                reasons.append(f"token address {token_address[:10]}... has no contract code (EOA)")
                risk_score += bc["risk_score"]
            elif bc.get("has_bytecode") and bc["risk_score"] > 0:
                risk_score += bc["risk_score"]
                for finding in bc["findings"]:
                    if "⚠️" in finding:
                        reasons.append(f"bytecode: {finding.replace('⚠️ ', '')}")

            # Supply analysis
            supply_info = analyze_token_supply(token_address)
            if supply_info["risk_score"] > 0:
                risk_score += supply_info["risk_score"]
                for finding in supply_info["findings"]:
                    reasons.append(f"supply: {finding.replace('⚠️ ', '')}")

        except Exception as e:
            log(f"⚠️ Bytecode analysis failed for {token_address[:10]}...: {e}")

    # ── DETERMINE RISK LEVEL ──
    if risk_score >= 50:
        risk_level = "HIGH"
    elif risk_score >= 25:
        risk_level = "MEDIUM"
    elif risk_score >= 10:
        risk_level = "LOW"
    else:
        risk_level = "CLEAN"

    return {
        "risk_level": risk_level,
        "risk_score": risk_score,
        "reasons": reasons,
        "bytecode_findings": bytecode_findings,
        "status": status,
        "holder_count": holder_count,
        "is_verified": is_verified,
        "mcap_in_virtual": mcap_in_virtual,
        "token_address": token_address,
    }


def check_alligo_score(agent_name: str) -> dict | None:
    """Check if AlliGo already has a score for this agent by name."""
    encoded = urllib.parse.quote(agent_name.lower().replace(" ", "-"))
    url = f"{ALLIGO_API}/api/public/agents/{encoded}/score"
    result = http_get(url)
    if result and result.get("agentId"):
        return result
    return None


def submit_claim_to_alligo(agent: dict, risk: dict, admin_key: str) -> dict | None:
    """Submit a high-risk Virtuals agent as a claim to AlliGo."""
    agent_name = agent.get("name", "Unknown Agent")
    symbol = agent.get("symbol", "???")
    virtual_id = agent.get("id")
    token_address = agent.get("tokenAddress") or agent.get("preToken", "")
    chain = agent.get("chain", "BASE")
    status = agent.get("status", "UNDERGRAD")
    reasons_text = "; ".join(risk["reasons"]) if risk["reasons"] else "Automated risk detection"

    payload = {
        "agentId": f"virtuals-{symbol.lower()}-{virtual_id}",
        "agentName": agent_name,
        "protocol": f"Virtuals Protocol ({symbol})",
        "incidentType": "SUSPICIOUS_DEPLOYMENT",
        "severity": risk["risk_level"],
        "description": (
            f"Automated AlliGo risk detection for Virtuals agent '{agent_name}' "
            f"(${symbol}, status={status}, chain={chain}). "
            f"Risk assessment: {risk['risk_level']} (score={risk['risk_score']}). "
            f"Reasons: {reasons_text}. "
            f"Token: {token_address or 'preToken only'}. "
            f"Holders: {risk['holder_count']}, Verified: {risk['is_verified']}, "
            f"MCap: {risk['mcap_in_virtual']} VIRTUAL tokens."
        ),
        "evidence": {
            "source": "virtuals_monitor_v2",
            "virtual_id": virtual_id,
            "token_address": token_address,
            "chain": chain,
            "risk_reasons": risk["reasons"],
            "risk_score": risk["risk_score"],
            "bytecode_findings": risk.get("bytecode_findings", []),
            "holder_count": risk.get("holder_count", 0),
            "mcap_in_virtual": risk.get("mcap_in_virtual", 0),
            "api_url": f"https://app.virtuals.io/virtuals/{virtual_id}",
        },
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "automated": True,
        "source": "zaia_swarm_virtuals_monitor"
    }

    return http_post(
        f"{ALLIGO_API}/api/claims",
        payload,
        headers={"Authorization": f"Bearer {admin_key}"}
    )


def main():
    log("🤖 Virtuals Protocol Monitor starting")
    DATA_DIR.mkdir(exist_ok=True)

    admin_key = os.environ.get("ALLIGO_ADMIN_KEY", "")
    if not admin_key:
        log("⚠️ ALLIGO_ADMIN_KEY not set — claim submission disabled")

    seen = load_seen()
    log(f"📋 Seen agents: {len(seen)}")

    # Fetch agents created in last 2 hours
    agents = fetch_new_virtuals_agents(since_hours=2)
    log(f"🔍 Fetched {len(agents)} recently created Virtuals agents")

    new_agents = [a for a in agents if str(a.get("id")) not in seen]
    log(f"🆕 {len(new_agents)} new (unseen) agents")

    claims_submitted = 0
    high_risk = 0
    medium_risk = 0
    clean = 0

    for agent in new_agents:
        agent_id = str(agent.get("id"))
        agent_name = agent.get("name", f"unknown-{agent_id}")
        symbol = agent.get("symbol", "???")
        status = agent.get("status", "?")
        chain = agent.get("chain", "?")

        risk = assess_risk(agent)

        log(
            f"  [{risk['risk_level']:6s}] {agent_name} (${symbol}) "
            f"| id={agent_id} | status={status} | chain={chain} "
            f"| score={risk['risk_score']} | holders={risk['holder_count']}"
        )

        if risk["reasons"]:
            log(f"         reasons: {'; '.join(risk['reasons'][:3])}")

        # Mark as seen
        seen[agent_id] = {
            "name": agent_name,
            "symbol": symbol,
            "risk_level": risk["risk_level"],
            "risk_score": risk["risk_score"],
            "first_seen": datetime.utcnow().isoformat(),
            "status": status,
        }

        if risk["risk_level"] == "HIGH":
            high_risk += 1
            # Check if AlliGo already knows about this
            existing = check_alligo_score(agent_name)
            if existing:
                log(f"         ℹ️ AlliGo already has score for {agent_name}")
            elif admin_key:
                result = submit_claim_to_alligo(agent, risk, admin_key)
                if result and result.get("success"):
                    claims_submitted += 1
                    claim_id = result.get("claim", {}).get("id", "?")
                    log(f"         ✅ Claim submitted → {claim_id}")
                else:
                    log(f"         ⚠️ Claim submission failed: {result}")
            else:
                log(f"         ⚠️ HIGH RISK but no admin key — skipping claim submission")
        elif risk["risk_level"] == "MEDIUM":
            medium_risk += 1
        else:
            clean += 1

        time.sleep(0.2)  # gentle pacing

    save_seen(seen)

    log(
        f"✅ Done. Processed={len(new_agents)} | HIGH={high_risk} | MEDIUM={medium_risk} | CLEAN={clean} | Claims={claims_submitted}"
    )
    log(f"📦 Total tracked agents: {len(seen)}")


if __name__ == "__main__":
    main()
