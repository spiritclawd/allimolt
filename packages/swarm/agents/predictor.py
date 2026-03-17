#!/usr/bin/env python3
"""
predictor.py — Zaia Swarm Agent
Pre-Mortem Prediction Engine for AlliGo.

Reads high-risk assessments from virtuals_monitor and crawler outputs,
runs them through the forensics engine, and publishes Risk Alerts with:
  - ≥80% confidence threshold (hard gate)
  - 24h internal review queue before public visibility
  - EAS attestation for each alert (timestamp = proof)
  - Tracks confirmed predictions when incidents happen

Schedule: every 4 hours
"""

import os
import json
import time
import hashlib
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

SWARM_DIR = Path(__file__).parent.parent
LOG_DIR = SWARM_DIR / "logs"
DATA_DIR = SWARM_DIR / "data"

ALLIGO_API = os.environ.get("ALLIGO_API", "https://alligo-production.up.railway.app")
ADMIN_KEY = os.environ.get("ALLIGO_ADMIN_KEY", "")
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
GROQ_KEY = os.environ.get("GROQ_API_KEY", "")

# Confidence threshold — never publish below this
MIN_CONFIDENCE = 80

# Review queue: predictions stay internal for this many hours before going public
REVIEW_HOURS = 24

# Track which predictions we've already submitted
SEEN_FILE = DATA_DIR / "predictor_seen.json"

LOG_FILE = LOG_DIR / f"predictor_{datetime.now().strftime('%Y-%m-%d')}.log"


def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [predictor] {msg}"
    print(line)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")


def load_seen() -> set:
    if SEEN_FILE.exists():
        return set(json.loads(SEEN_FILE.read_text()))
    return set()


def save_seen(seen: set):
    SEEN_FILE.write_text(json.dumps(list(seen)))


def api_post(path: str, body: dict) -> dict | None:
    url = f"{ALLIGO_API}{path}"
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method="POST",
        headers={
            "Authorization": f"Bearer {ADMIN_KEY}",
            "Content-Type": "application/json",
            "User-Agent": "AlliGo-Predictor/1.0",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        log(f"  API error {e.code}: {e.read().decode()[:200]}")
        return None
    except Exception as e:
        log(f"  API error: {e}")
        return None


def api_get(path: str) -> dict | None:
    url = f"{ALLIGO_API}{path}"
    req = urllib.request.Request(
        url, method="GET",
        headers={
            "Authorization": f"Bearer {ADMIN_KEY}",
            "User-Agent": "AlliGo-Predictor/1.0",
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"  API GET error: {e}")
        return None


def call_llm(prompt: str) -> str | None:
    """Call LLM for forensic analysis. OpenRouter → Groq fallback."""
    # Try OpenRouter first (cheaper, higher quality)
    if OPENROUTER_KEY:
        try:
            body = json.dumps({
                "model": "meta-llama/llama-3.3-70b-instruct",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
                "temperature": 0.2,
            }).encode()
            req = urllib.request.Request(
                "https://openrouter.ai/api/v1/chat/completions",
                data=body, method="POST",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_KEY}",
                    "Content-Type": "application/json",
                    "HTTP-Referer": "https://alligo-production.up.railway.app",
                }
            )
            with urllib.request.urlopen(req, timeout=20) as r:
                resp = json.loads(r.read())
            return resp["choices"][0]["message"]["content"]
        except Exception as e:
            log(f"  OpenRouter error: {e} — trying Groq")

    # Groq fallback
    if GROQ_KEY:
        try:
            body = json.dumps({
                "model": "llama-3.3-70b-versatile",
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": 800,
                "temperature": 0.2,
            }).encode()
            req = urllib.request.Request(
                "https://api.groq.com/openai/v1/chat/completions",
                data=body, method="POST",
                headers={
                    "Authorization": f"Bearer {GROQ_KEY}",
                    "Content-Type": "application/json",
                }
            )
            with urllib.request.urlopen(req, timeout=20) as r:
                resp = json.loads(r.read())
            return resp["choices"][0]["message"]["content"]
        except Exception as e:
            log(f"  Groq error: {e}")

    return None


def assess_candidate(agent_id: str, agent_name: str, protocol: str,
                     chain: str, contract: str, risk_score: int,
                     risk_reasons: list[str], source: str) -> dict | None:
    """
    Run LLM forensic assessment on a high-risk candidate.
    Returns structured prediction dict or None if confidence < threshold.
    """
    reasons_text = "\n".join(f"- {r}" for r in risk_reasons)
    prompt = f"""You are AlliGo's forensic engine. Assess this high-risk AI agent/protocol for pre-mortem prediction.

Agent: {agent_name} ({agent_id})
Protocol: {protocol}
Chain: {chain}
Contract: {contract}
Raw risk score: {risk_score}/100
Risk signals detected:
{reasons_text}

Your task:
1. Map the strongest signals to ONE of these AlliGo archetypes:
   - Goal_Drift_Hijack (agent objectives silently mutate)
   - Tool_Looping_Denial (recursive tool calls, quota exhaustion)
   - Jailbreak_Vulnerability (prompt injection susceptibility)
   - Memory_Poisoning (corrupted context manipulation)
   - Counterparty_Collusion (coordinated multi-agent exploit)
   - Reckless_Planning (high-risk plans without safeguards)
   - Prompt_Injection_Escalation (privilege escalation via injection)
   - Multi_Framework_Collusion (cross-framework coordination attack)
   - Reentrancy_Pattern (callback before state update)
   - Oracle_Manipulation (price/data feed manipulation)

2. Estimate confidence (0-100). Be conservative. Only output ≥80 if evidence is strong.

3. Write a one-sentence evidence snippet (anonymized, no contract addresses).

4. Write a 2-sentence public summary explaining the risk in plain English.

Respond ONLY with valid JSON:
{{
  "archetype": "...",
  "confidence": <number 0-100>,
  "evidence_snippet": "...",
  "summary": "...",
  "reasons": ["...", "..."]
}}"""

    raw = call_llm(prompt)
    if not raw:
        return None

    try:
        # Extract JSON from response
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start == -1 or end == 0:
            return None
        result = json.loads(raw[start:end])

        confidence = int(result.get("confidence", 0))
        if confidence < MIN_CONFIDENCE:
            log(f"  Confidence {confidence}% < {MIN_CONFIDENCE}% threshold — skipping")
            return None

        return {
            "archetype": result.get("archetype", "Unknown"),
            "confidence": confidence,
            "evidence_snippet": result.get("evidence_snippet", ""),
            "summary": result.get("summary", ""),
            "reasons": result.get("reasons", risk_reasons[:3]),
        }
    except Exception as e:
        log(f"  LLM parse error: {e} — raw: {raw[:200]}")
        return None


def get_virtuals_candidates() -> list[dict]:
    """Read HIGH-risk virtuals detections from today's log."""
    candidates = []
    log_file = LOG_DIR / f"virtuals_monitor_{datetime.now().strftime('%Y-%m-%d')}.log"
    if not log_file.exists():
        return candidates

    current = {}
    with open(log_file) as f:
        for line in f:
            if "[HIGH]" in line or "HIGH RISK" in line:
                # Parse agent name from log line
                # Format: [HIGH   ] AgentName ($SYMBOL) score=XX reasons=[...]
                import re
                m = re.search(r'\[HIGH\s*\]\s+(.+?)\s+\(\$(\w+)\)', line)
                if m:
                    current = {
                        "agent_name": m.group(1).strip(),
                        "symbol": m.group(2),
                        "reasons": [],
                        "score": 75,
                        "source": "virtuals_monitor",
                    }
                if "score=" in line:
                    m2 = re.search(r'score=(\d+)', line)
                    if m2 and current:
                        current["score"] = int(m2.group(1))
            if "⚠️" in line or "🚨" in line or "findings:" in line.lower():
                if current and line.strip():
                    reason = line.strip().split("] ")[-1].strip()
                    if reason and len(reason) > 5:
                        current.setdefault("reasons", []).append(reason[:120])
            if current and len(current.get("reasons", [])) >= 1 and current not in candidates:
                candidates.append(dict(current))

    # Also read seen virtuals JSON for structured data
    virtuals_seen = DATA_DIR / "virtuals_seen.json"
    if virtuals_seen.exists():
        try:
            seen = json.loads(virtuals_seen.read_text())
            for vid, vdata in seen.items():
                if isinstance(vdata, dict) and vdata.get("risk_level") == "HIGH":
                    candidates.append({
                        "agent_id": vid,
                        "agent_name": vdata.get("name", vid),
                        "symbol": vdata.get("symbol", ""),
                        "reasons": vdata.get("reasons", []),
                        "score": vdata.get("score", 70),
                        "chain": vdata.get("chain", "base"),
                        "contract": vdata.get("contractAddress", ""),
                        "source": "virtuals_monitor",
                    })
        except Exception:
            pass

    return candidates


def get_crawler_candidates() -> list[dict]:
    """Read HIGH-risk incidents from crawler discovered_incidents.jsonl."""
    candidates = []
    incidents_file = DATA_DIR / "discovered_incidents.jsonl"
    if not incidents_file.exists():
        return candidates

    cutoff = time.time() - (4 * 3600)  # last 4 hours
    with open(incidents_file) as f:
        for line in f:
            try:
                inc = json.loads(line)
                if inc.get("discovered_at", 0) < cutoff:
                    continue
                amount = inc.get("amount_lost_usd", 0) or 0
                if amount >= 500_000:  # only significant incidents
                    candidates.append({
                        "agent_id": inc.get("agent_id", f"discovered_{inc.get('id', '')[:8]}"),
                        "agent_name": inc.get("protocol", inc.get("title", "Unknown")),
                        "reasons": [inc.get("summary", "")[:120]],
                        "score": min(90, 60 + int(amount / 1_000_000)),
                        "chain": inc.get("chain", "ethereum"),
                        "contract": inc.get("contract_address", ""),
                        "source": "crawler",
                    })
            except Exception:
                continue
    return candidates


def build_prediction_id(agent_id: str, archetype: str) -> str:
    """Stable dedup ID for a given agent+archetype combination."""
    raw = f"{agent_id}:{archetype}:{datetime.now().strftime('%Y-%m-%d')}"
    return "pred_" + hashlib.sha256(raw.encode()).hexdigest()[:16]


def run():
    log("=" * 60)
    log("Predictor starting — Pre-Mortem Risk Alert Engine")
    log(f"Confidence threshold: ≥{MIN_CONFIDENCE}%")
    log(f"Review queue: {REVIEW_HOURS}h before public")
    log("=" * 60)

    if not ADMIN_KEY:
        log("ERROR: ALLIGO_ADMIN_KEY not set")
        return

    seen = load_seen()

    # Gather candidates from all sources
    candidates = []
    virtuals = get_virtuals_candidates()
    crawler = get_crawler_candidates()
    candidates.extend(virtuals)
    candidates.extend(crawler)

    log(f"Candidates: {len(virtuals)} from virtuals_monitor, {len(crawler)} from crawler")

    new_preds = 0
    skipped = 0

    for c in candidates:
        agent_id = c.get("agent_id", c.get("agent_name", "unknown").lower().replace(" ", "_")[:30])
        agent_name = c.get("agent_name", agent_id)
        protocol = c.get("agent_name", agent_id)
        chain = c.get("chain", "base")
        contract = c.get("contract", "")
        risk_score = c.get("score", 70)
        reasons = c.get("reasons", [])
        source = c.get("source", "unknown")

        if not reasons:
            skipped += 1
            continue

        # Dedup key: same agent+day → skip
        dedup_key = f"{agent_id}:{datetime.now().strftime('%Y-%m-%d')}"
        if dedup_key in seen:
            skipped += 1
            continue

        log(f"\nAssessing: {agent_name} (score={risk_score})")

        assessment = assess_candidate(
            agent_id=agent_id,
            agent_name=agent_name,
            protocol=protocol,
            chain=chain,
            contract=contract,
            risk_score=risk_score,
            risk_reasons=reasons,
            source=source,
        )

        if not assessment:
            skipped += 1
            seen.add(dedup_key)
            continue

        log(f"  ✅ {assessment['archetype']} @ {assessment['confidence']}% confidence")

        pred_id = build_prediction_id(agent_id, assessment["archetype"])

        prediction_body = {
            "agentId": agent_id,
            "agentName": agent_name,
            "protocol": protocol,
            "chain": chain,
            "contractAddress": contract,
            "archetype": assessment["archetype"],
            "confidence": assessment["confidence"],
            "riskScore": risk_score,
            "riskLevel": "HIGH" if risk_score >= 70 else "MEDIUM",
            "title": f"Pre-Mortem Alert: {assessment['archetype'].replace('_', ' ')} — {agent_name}",
            "summary": assessment["summary"],
            "reasons": assessment["reasons"],
            "source": source,
        }

        result = api_post("/api/predictions", prediction_body)
        if result and result.get("success"):
            log(f"  📌 Prediction stored: {result.get('id')}")
            new_preds += 1
            seen.add(dedup_key)
        else:
            log(f"  ❌ Failed to store prediction: {result}")

        time.sleep(1)  # Rate limit

    save_seen(seen)

    # Check for incidents that confirm existing predictions
    check_confirmations()

    log(f"\n{'=' * 60}")
    log(f"Predictor complete: {new_preds} new predictions, {skipped} skipped")
    log("=" * 60)


def check_confirmations():
    """
    Cross-reference active predictions against new claims.
    If a predicted agent now has a confirmed incident → mark as confirmed.
    """
    log("\nChecking for confirmations...")

    preds_resp = api_get("/api/predictions?status=active&limit=200")
    if not preds_resp:
        return
    predictions = preds_resp.get("predictions", [])

    claims_resp = api_get("/api/claims?limit=200")
    if not claims_resp:
        return
    claims = claims_resp.get("claims", [])

    # Build map: agentId → claim
    claim_map = {}
    for c in claims:
        aid = c.get("agentId", "")
        if aid:
            claim_map[aid] = c

    confirmed = 0
    for pred in predictions:
        pred_agent = pred.get("agentId", "")
        pred_arch = pred.get("archetype", "")
        matched_claim = claim_map.get(pred_agent)

        if matched_claim:
            claim_type = matched_claim.get("claimType", "")
            claim_id = matched_claim.get("id", "")
            tx_hash = matched_claim.get("txHash", "")

            # Predicted BEFORE incident (predictedAt < claim timestamp)
            pred_time = pred.get("predictedAt", 0)
            claim_time = matched_claim.get("timestamp", 0) / 1000  # ms → s

            if pred_time < claim_time and claim_id:
                days_ahead = (claim_time - pred_time) / 86400
                log(f"  🎯 CONFIRMED: {pred_agent} — predicted {days_ahead:.1f}d before incident!")
                log(f"     Prediction: {pred.get('id')} | Claim: {claim_id}")

                # Update prediction status to confirmed
                patch_url = f"{ALLIGO_API}/api/predictions/{pred.get('id')}"
                patch_body = json.dumps({
                    "status": "confirmed",
                    "confirmedClaimId": claim_id,
                    "confirmedTxHash": tx_hash,
                }).encode()
                patch_req = urllib.request.Request(
                    patch_url, data=patch_body, method="PATCH",
                    headers={
                        "Authorization": f"Bearer {ADMIN_KEY}",
                        "Content-Type": "application/json",
                    }
                )
                try:
                    with urllib.request.urlopen(patch_req, timeout=10) as r:
                        confirmed += 1
                except Exception as e:
                    log(f"  Confirm patch error: {e}")

    if confirmed:
        log(f"  ✅ {confirmed} prediction(s) confirmed by new incidents")
    else:
        log("  No new confirmations")


if __name__ == "__main__":
    run()
