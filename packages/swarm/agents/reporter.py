#!/usr/bin/env python3
"""
Zaia Swarm — Reporter Agent
Generates the weekly Rogue Agent Report using local LLM (llama3.2:3b).
Pulls live data from AlliGo API, synthesizes via LLM, saves report.
"""

import json
import os
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

SWARM_DIR = Path(__file__).parent.parent
LOG_DIR = SWARM_DIR / "logs"
DATA_DIR = SWARM_DIR / "data"
REPORTS_DIR = SWARM_DIR / "data" / "reports"
ALLIGO_API = "https://alligo-production.up.railway.app"
# OpenRouter primary (llama-3.3-70b for quality reports), local fallback
OPENROUTER_KEY = os.environ.get("OPENROUTER_API_KEY", "")
LLM_ENDPOINT = "https://openrouter.ai/api/v1/chat/completions" if OPENROUTER_KEY else "http://localhost:8080/v1/chat/completions"
LLM_API_KEY = OPENROUTER_KEY if OPENROUTER_KEY else "zaia"
LLM_MODEL = "meta-llama/llama-3.3-70b-instruct" if OPENROUTER_KEY else "llama3.2:3b"
LLM_HEADERS_EXTRA: dict = {"HTTP-Referer": "https://alligo-production.up.railway.app", "X-Title": "AlliGo Reporter"} if OPENROUTER_KEY else {}

def log(msg: str):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] [reporter] {msg}"
    print(line)
    log_file = LOG_DIR / f"reporter_{datetime.now().strftime('%Y-%m-%d')}.log"
    with open(log_file, "a") as f:
        f.write(line + "\n")

def fetch_url(url: str, headers: dict | None = None) -> dict | None:
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read())
    except Exception as e:
        log(f"Fetch error {url}: {e}")
        return None

def get_alligo_data() -> dict:
    """Fetch current stats and recent claims from AlliGo."""
    health = fetch_url(f"{ALLIGO_API}/health") or {}
    admin_key = os.environ.get("ALLIGO_ADMIN_KEY", "alligo_read_dev_key")
    stats = fetch_url(
        f"{ALLIGO_API}/api/stats",
        headers={"Authorization": f"Bearer {admin_key}"}
    ) or {}

    return {
        "health": health,
        "stats": stats,
        "fetched_at": datetime.now().isoformat(),
    }

def llm_generate(prompt: str, max_tokens: int = 800) -> str:
    """Call local LLM for text generation."""
    payload = json.dumps({
        "model": LLM_MODEL,
        "messages": [
            {
                "role": "system",
                "content": "You are Zaia, the intelligence engine behind AlliGo — The Credit Bureau for AI Agents. You write authoritative, data-driven reports about AI agent failures and risk patterns. Your tone is precise, urgent, and credible. No fluff."
            },
            {"role": "user", "content": prompt}
        ],
        "max_tokens": max_tokens,
        "temperature": 0.7,
    }).encode("utf-8")

    try:
        req = urllib.request.Request(
            LLM_ENDPOINT,
            data=payload,
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {LLM_API_KEY}",
                **LLM_HEADERS_EXTRA,
            },
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=120) as resp:
            result = json.loads(resp.read())
            return result["choices"][0]["message"]["content"]
    except Exception as e:
        log(f"LLM error: {e}")
        return f"[LLM unavailable: {e}]"

def generate_report(data: dict) -> str:
    """Generate the weekly Rogue Agent Report."""
    health = data.get("health", {})
    stats_data = data.get("stats", {})
    stats = stats_data.get("stats", {}) if isinstance(stats_data, dict) else {}

    total_claims = health.get("claims", "unknown")
    # API returns totalValueLost (not total_value_at_risk_usd)
    total_value = stats.get("totalValueLost", stats.get("total_value_at_risk_usd", 0))
    week_str = datetime.now().strftime("Week of %B %d, %Y")

    claims_by_type = stats.get("claimsByType", {})
    claims_by_chain = stats.get("claimsByChain", {})
    top_agents = stats.get("topAgents", [])[:3]
    top_chains = sorted(claims_by_chain.items(), key=lambda x: x[1], reverse=True)[:4]
    top_types = sorted(claims_by_type.items(), key=lambda x: x[1], reverse=True)

    context = f"""
AlliGo Live Data ({week_str}):
- Total incidents tracked: {total_claims}
- Total value lost: ${total_value:,.0f} USD
- Database status: {health.get('status', 'unknown')}
- x402 payments: {'enabled' if health.get('x402') else 'disabled'}
- Redis cache hit rate: {health.get('redis', {}).get('hit_rate', 0)*100:.0f}%
- Incident types: {', '.join(f"{k}={v}" for k,v in top_types)}
- Top chains: {', '.join(f"{k}={v}" for k,v in top_chains)}
- Top agents by losses: {', '.join(f"{a.get('name','?')} (${a.get('valueLost',0):,.0f})" for a in top_agents)}
"""

    prompt = f"""Write a weekly "Rogue Agent Report" for AlliGo.

{context}

Structure the report exactly as:

# 🔴 AlliGo Rogue Agent Report
**{week_str}**

## Executive Summary
[2-3 sentences: what happened this week in AI agent risk, key number]

## Key Statistics
[Bullet points with the live data above]

## Threat Landscape
[3-4 paragraphs on current patterns: which archetypes are most active, what protocols are at risk, emerging attack vectors]

## Notable Patterns This Week
[2-3 specific behavioral patterns detected by the AlliGo forensics engine]

## Acquisition Readiness Signal
[1 paragraph on what this data means for potential acquirers — Coinbase, Armilla, Virtuals]

## Recommended Actions
[Numbered list: 3-5 actions for agent developers, platform operators, or insurers]

---
*Generated by Zaia — AlliGo Forensics Engine | alligo-production.up.railway.app*
"""

    log("Generating report via local LLM...")
    report_body = llm_generate(prompt, max_tokens=1000)

    return report_body

def save_report(report: str, data: dict) -> Path:
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    date_str = datetime.now().strftime("%Y-%m-%d")
    report_file = REPORTS_DIR / f"rogue_agent_report_{date_str}.md"
    
    full_report = f"{report}\n\n---\n*Raw data: {json.dumps(data.get('health', {}), indent=2)}*\n"
    report_file.write_text(full_report)
    log(f"Report saved: {report_file}")
    return report_file

def main():
    log("📰 Zaia Reporter starting...")
    DATA_DIR.mkdir(exist_ok=True)
    LOG_DIR.mkdir(exist_ok=True)

    log("Fetching AlliGo live data...")
    data = get_alligo_data()
    log(f"Health: claims={data['health'].get('claims', '?')}, status={data['health'].get('status', '?')}")

    report = generate_report(data)
    report_file = save_report(report, data)

    log(f"✅ Report complete: {report_file}")
    print("\n" + "="*60)
    print(report[:500] + "...")
    print("="*60)

    return {"report_file": str(report_file), "length": len(report)}

if __name__ == "__main__":
    main()
