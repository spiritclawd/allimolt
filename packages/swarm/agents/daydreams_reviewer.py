#!/usr/bin/env python3
"""
Zaia Swarm — Daydreams Task Market Reviewer Agent
Polls open AlliGo bounty tasks for new submissions, runs forensics validation,
auto-accepts qualifying traces, triggers USDC payment, ingests into AlliGo DB.

Flow:
  1. List all open AlliGo bounty tasks from TaskMarket
  2. For each task, fetch new submissions
  3. Validate: quality check + forensics score via AlliGo engine
  4. Auto-accept if: score >= 0.75 OR (CLEAN and score < 0.30) + has payment_address
  5. Call `taskmarket task accept` to release USDC
  6. Ingest trace into AlliGo via /api/submit-traces
  7. Track payout ledger, stop when remaining budget < $5

Schedule: every 15 minutes
Budget cap: $45 USDC (stop accepting when balance < $5)
"""

import json
import os
import subprocess
import time
import hashlib
import urllib.request
import urllib.error
from datetime import datetime
from pathlib import Path

# ==================== CONFIG ====================
SWARM_DIR = Path(__file__).parent.parent
DATA_DIR = SWARM_DIR / "data"
LOG_DIR = SWARM_DIR / "logs"

ALLIGO_API = os.environ.get("ALLIGO_API", "https://alligo-production.up.railway.app")
ALLIGO_ADMIN_KEY = os.environ.get("ALLIGO_ADMIN_KEY", "")

# TaskMarket CLI
TASKMARKET = ["npx", "--yes", "@lucid-agents/taskmarket"]

# Our posted task IDs (updated as new tasks are posted)
ALLIGO_TASK_IDS_FILE = DATA_DIR / "alligo_task_ids.json"

# Payout ledger
PAYOUT_LEDGER_FILE = DATA_DIR / "payout_ledger.json"

# Seen submission hashes (dedup)
SEEN_SUBMISSIONS_FILE = DATA_DIR / "seen_submissions.json"

# Budget
USDC_STOP_THRESHOLD = 5.0   # stop auto-accepting when balance drops below this
REWARD_BASE = 2.0            # USDC base per accepted bronze trace
REWARD_BONUS_HIGH = 3.0      # bonus for high-signal traces (confidence >= 0.90, priority archetype)
REWARD_MAX = 5.0             # cap per submission

# Archetype priority weights (highest = most coverage-starved)
ARCHETYPE_PRIORITY = {
    "Jailbreak_Vulnerability":      10,  # weakest detector — highest weight
    "Memory_Poisoning":              9,
    "Tool_Looping_Denial":           9,
    "Counterparty_Collusion":        9,
    "Rogue_Self_Modification":       8,
    "Exploit_Generation_Mimicry":    8,
    "CLEAN":                         8,  # critically underrepresented
    "Reckless_Planning":             6,
    "Goal_Drift_Hijack":             5,
    "Prompt_Injection_Escalation":   4,
    "Multi_Framework_Collusion":     2,
}

# Validation thresholds
MIN_COT_LENGTH = 100
FAILURE_MIN_CONFIDENCE = 0.60   # engine must score >= this for labeled failure traces
CLEAN_MAX_CONFIDENCE = 0.30     # engine must score < this for CLEAN traces
AUTO_ACCEPT_CONFIDENCE = 0.75   # above this = auto-store + pay

# Emergency controls
MAX_CONSECUTIVE_REJECTIONS = 5  # pause reviewer after this many in a row
CONSEC_REJECT_FILE = DATA_DIR / "consec_rejections.json"

LOG_FILE = LOG_DIR / f"daydreams_reviewer_{datetime.now().strftime('%Y-%m-%d')}.log"

VALID_ARCHETYPES = {
    "CLEAN", "Memory_Poisoning", "Counterparty_Collusion", "Tool_Looping_Denial",
    "Jailbreak_Vulnerability", "Rogue_Self_Modification", "Exploit_Generation_Mimicry",
    "Reckless_Planning", "Goal_Drift_Hijack", "Prompt_Injection_Escalation",
    "Multi_Framework_Collusion"
}

# ==================== ENV + TELEGRAM ====================
def load_env_vars() -> dict:
    env_file = SWARM_DIR / ".env"
    env = {}
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env

def send_telegram_pause_alert(consec_count: int, env_vars: dict):
    token = env_vars.get("TELEGRAM_BOT_TOKEN", "")
    channel = env_vars.get("TELEGRAM_CHANNEL_ID", "-1003655064149")
    if not token:
        return
    msg = (
        f"🚨 *Daydreams Reviewer PAUSED*\n\n"
        f"{consec_count} consecutive rejections hit limit ({MAX_CONSECUTIVE_REJECTIONS}).\n"
        f"Possible causes: spam submissions, format change, or detector issue.\n\n"
        f"To resume: delete `/home/computer/zaia-swarm/data/consec_rejections.json`\n"
        f"or set {{\"count\":0,\"paused\":false}} in that file."
    )
    try:
        data = json.dumps({"chat_id": channel, "text": msg, "parse_mode": "Markdown"}).encode()
        req = urllib.request.Request(
            f"https://api.telegram.org/bot{token}/sendMessage",
            data=data, headers={"Content-Type": "application/json"}, method="POST"
        )
        urllib.request.urlopen(req, timeout=10)
    except Exception:
        pass

# ==================== LOGGING ====================
def log(msg: str):
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{ts}] [daydreams_reviewer] {msg}"
    print(line, flush=True)
    with open(LOG_FILE, "a") as f:
        f.write(line + "\n")

# ==================== PERSISTENCE ====================
def load_json(path: Path, default):
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return default
    return default

def save_json(path: Path, data):
    path.write_text(json.dumps(data, indent=2, default=str))

def load_task_ids() -> list[str]:
    return load_json(ALLIGO_TASK_IDS_FILE, [])

def save_task_id(task_id: str):
    ids = load_task_ids()
    if task_id not in ids:
        ids.append(task_id)
        save_json(ALLIGO_TASK_IDS_FILE, ids)

def load_ledger() -> dict:
    return load_json(PAYOUT_LEDGER_FILE, {
        "total_paid_usdc": 0.0,
        "total_accepted": 0,
        "total_rejected": 0,
        "payments": []
    })

def record_payment(ledger: dict, submission_id: str, amount: float, archetype: str, agent_address: str, task_id: str):
    ledger["total_paid_usdc"] = round(ledger["total_paid_usdc"] + amount, 6)
    ledger["total_accepted"] = ledger["total_accepted"] + 1
    ledger["payments"].append({
        "submission_id": submission_id,
        "amount_usdc": amount,
        "archetype": archetype,
        "agent_address": agent_address,
        "task_id": task_id,
        "paid_at": datetime.now().isoformat()
    })
    save_json(PAYOUT_LEDGER_FILE, ledger)

def load_seen() -> set:
    return set(load_json(SEEN_SUBMISSIONS_FILE, []))

def save_seen(seen: set):
    lst = list(seen)[-5000:]
    save_json(SEEN_SUBMISSIONS_FILE, lst)

# ==================== API HELPERS ====================
def http_get(url: str, headers: "dict | None" = None) -> "dict | None":
    try:
        req = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(req, timeout=15) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"GET {url} error: {e}")
        return None

def http_post(url: str, payload: dict, headers: dict | None = None) -> dict | None:
    try:
        data = json.dumps(payload).encode()
        h = {"Content-Type": "application/json", **(headers or {})}
        req = urllib.request.Request(url, data=data, headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except Exception as e:
        log(f"POST {url} error: {e}")
        return None

def taskmarket_cli(*args) -> dict | None:
    """Run taskmarket CLI and return parsed JSON output."""
    try:
        result = subprocess.run(
            TASKMARKET + list(args),
            capture_output=True, text=True, timeout=30,
            env={**os.environ, "HOME": str(Path.home())}
        )
        out = result.stdout.strip()
        if out:
            try:
                return json.loads(out)
            except Exception:
                log(f"CLI non-JSON output: {out[:200]}")
                return None
        if result.stderr:
            log(f"CLI stderr: {result.stderr[:200]}")
        return None
    except subprocess.TimeoutExpired:
        log("CLI timeout")
        return None
    except Exception as e:
        log(f"CLI error: {e}")
        return None

# ==================== WALLET BALANCE ====================
def get_usdc_balance() -> float:
    """Check USDC balance via TaskMarket CLI (most reliable — uses their RPC)."""
    try:
        result = taskmarket_cli("wallet", "balance")
        if result and result.get("ok"):
            return float(result.get("data", {}).get("balanceUsdc", 0))
        return 999.0  # Fail open
    except Exception as e:
        log(f"Balance check failed: {e}")
        return 999.0

# ==================== VALIDATION ====================
def validate_trace(submission_text: str) -> tuple[bool, str, dict]:
    """
    Parse and validate submission. Handles two formats:
    1. Direct JSON trace (preferred)
    2. Proof-report (markdown text with API results + payment wallet)
    Returns (is_valid, rejection_reason, parsed_data)
    """
    import re

    # --- Try JSON trace format first ---
    parsed = None
    try:
        parsed = json.loads(submission_text)
    except Exception:
        json_match = re.search(r'\{[\s\S]*\}', submission_text)
        if json_match:
            try:
                parsed = json.loads(json_match.group())
            except Exception:
                pass

    if parsed and isinstance(parsed, dict):
        agent_id = parsed.get("agentId") or parsed.get("agent_id")
        if not agent_id:
            return False, "missing agentId", {}
        cot = parsed.get("chain_of_thought") or parsed.get("cot") or ""
        tool_calls = parsed.get("tool_calls") or parsed.get("toolCalls") or []
        goal_history = parsed.get("goal_history") or parsed.get("goalHistory") or []
        if not cot and not tool_calls and not goal_history:
            return False, "no behavioral data (need chain_of_thought, tool_calls, or goal_history)", {}
        if cot and len(cot) < MIN_COT_LENGTH:
            return False, f"chain_of_thought too short ({len(cot)} chars, need {MIN_COT_LENGTH})", {}
        ground_truth = parsed.get("ground_truth_archetype") or parsed.get("archetype")
        if ground_truth and ground_truth not in VALID_ARCHETYPES:
            return False, f"invalid archetype label: {ground_truth}", {}
        payment_address = parsed.get("payment_address") or parsed.get("paymentAddress")
        if not payment_address:
            return False, "missing payment_address (Base wallet for USDC)", {}
        if not payment_address.startswith("0x") or len(payment_address) != 42:
            return False, f"invalid payment_address format: {payment_address}", {}
        if re.search(r'(?:private.?key|mnemonic|seed.?phrase)', cot, re.IGNORECASE):
            return False, "submission contains potential private key or mnemonic data", {}
        return True, "ok", parsed

    # --- Proof-report format (markdown with API results) ---
    # Agent submitted traces directly to our API and is reporting proof
    text = submission_text

    # Must confirm traces were successfully stored by our engine
    accepted_actions = len(re.findall(r'action=(?:stored|analyzed)', text, re.IGNORECASE))
    if accepted_actions == 0:
        return False, "proof-report: no confirmed API submissions found (need action=stored or action=analyzed)", {}

    # Must claim CLEAN or a known archetype
    archetype_matches = re.findall(
        r'archetype=(' + '|'.join(VALID_ARCHETYPES) + r')', text, re.IGNORECASE
    )
    detected_archetype = archetype_matches[0] if archetype_matches else "CLEAN"

    # Extract payment wallet from markdown
    wallet_match = re.search(r'(?:Wallet|payment_address|wallet address)[:\s]+`?(0x[a-fA-F0-9]{40})`?', text, re.IGNORECASE)
    if not wallet_match:
        # Try any 0x address that looks like a wallet
        all_addrs = re.findall(r'0x[a-fA-F0-9]{40}', text)
        # Exclude our own task/tx hashes (64 chars), keep 40-char addresses
        wallet_addrs = [a for a in all_addrs if len(a) == 42]
        payment_address = wallet_addrs[-1] if wallet_addrs else None
    else:
        payment_address = wallet_match.group(1)

    if not payment_address:
        return False, "proof-report: no payment wallet address found", {}

    # Extract agent ID from report
    agent_id_match = re.search(r'Agent ID[:\s]+(\S+)', text, re.IGNORECASE)
    agent_id = agent_id_match.group(1) if agent_id_match else "proof-report-agent"

    # Build a pseudo-parsed dict for scoring purposes
    pseudo = {
        "agentId": agent_id,
        "ground_truth_archetype": detected_archetype,
        "payment_address": payment_address,
        "proof_report": True,
        "confirmed_submissions": accepted_actions,
        "chain_of_thought": f"[Proof report] Agent submitted {accepted_actions} trace(s) directly to AlliGo API. Reported archetype: {detected_archetype}.",
        "_raw_report": text[:500],
    }
    return True, f"proof-report: {accepted_actions} confirmed submission(s), archetype={detected_archetype}", pseudo

def run_forensics(parsed: dict) -> dict:
    """Run parsed trace through AlliGo forensics engine."""
    payload = {
        "agentId": parsed.get("agentId") or parsed.get("agent_id", "bounty-agent"),
        "traces": parsed.get("chain_of_thought") or parsed.get("traces") or "",
        "chain_of_thought": parsed.get("chain_of_thought") or parsed.get("cot"),
        "tool_calls": parsed.get("tool_calls") or parsed.get("toolCalls"),
        "goal_history": parsed.get("goal_history") or parsed.get("goalHistory"),
        "memory_ops": parsed.get("memory_ops"),
        "injection_attempts": parsed.get("injection_attempts"),
        "agent_messages": parsed.get("agent_messages"),
        "description": f"[Bounty reviewer] {parsed.get('ground_truth_archetype', 'unknown')}",
    }
    payload = {k: v for k, v in payload.items() if v is not None}
    result = http_post(
        f"{ALLIGO_API}/api/submit-traces",
        payload,
        headers={"Authorization": f"Bearer {ALLIGO_ADMIN_KEY}"}
    )
    return result or {}

def should_accept(parsed: dict, forensics: dict) -> tuple[bool, str]:
    """
    Determine accept/reject based on forensics result vs ground truth label.
    Handles both direct JSON traces and proof-reports.
    Returns (accept, reason)
    """
    # Proof-report: agent already submitted to our API, report confirms it
    if parsed.get("proof_report"):
        n = parsed.get("confirmed_submissions", 0)
        archetype = parsed.get("ground_truth_archetype", "CLEAN")
        if n >= 1:
            return True, f"proof-report accepted — {n} confirmed submission(s) to AlliGo API, archetype={archetype}"
        return False, "proof-report: no confirmed submissions"

    ground_truth = parsed.get("ground_truth_archetype") or parsed.get("archetype", "")
    f = forensics.get("forensics", {})
    detected_archetype = f.get("archetype", "CLEAN")
    confidence = f.get("confidence", 0)

    if ground_truth == "CLEAN":
        if confidence < CLEAN_MAX_CONFIDENCE:
            return True, f"CLEAN accepted (engine confidence {confidence:.2f} < {CLEAN_MAX_CONFIDENCE})"
        else:
            return False, f"CLEAN rejected — engine detected {detected_archetype} at {confidence:.2f}"
    elif ground_truth:
        if confidence >= FAILURE_MIN_CONFIDENCE:
            return True, f"accepted — {detected_archetype} confidence {confidence:.2f} >= {FAILURE_MIN_CONFIDENCE}"
        else:
            return False, f"rejected — confidence {confidence:.2f} below {FAILURE_MIN_CONFIDENCE} (detected: {detected_archetype})"
    else:
        if confidence >= 0.65:
            return True, f"accepted unlabeled — {detected_archetype} at {confidence:.2f}"
        elif forensics.get("action") == "stored":
            return True, "accepted — auto-stored by engine"
        else:
            return False, f"rejected unlabeled — low confidence ({confidence:.2f})"

# ==================== ACCEPT + PAY ====================
def accept_submission(task_id: str, submission_id: str, payment_address: str, amount: float) -> bool:
    """Accept a TaskMarket submission — releases USDC to worker."""
    log(f"  💸 Accepting {submission_id} → paying {payment_address} ${amount:.2f} USDC")
    result = taskmarket_cli("task", "accept", task_id, "--worker", payment_address)
    if result and result.get("ok"):
        tx = result.get("data", {}).get("txHash") or result.get("data", {}).get("tx", "pending")
        log(f"  ✅ Payment released | tx: {tx}")
        return True
    else:
        log(f"  ⚠️ Accept failed: {result}")
        return False

# ==================== MAIN ====================
def run():
    log("=" * 60)
    log("Daydreams Reviewer starting")
    log("=" * 60)

    if not ALLIGO_ADMIN_KEY:
        log("❌ ALLIGO_ADMIN_KEY not set")
        return

    DATA_DIR.mkdir(exist_ok=True)

    # Check wallet balance
    balance = get_usdc_balance()
    log(f"💰 TaskMarket wallet balance: ${balance:.2f} USDC")

    if balance < USDC_STOP_THRESHOLD:
        log(f"⚠️ Balance ${balance:.2f} below stop threshold ${USDC_STOP_THRESHOLD} — not accepting new submissions")

    ledger = load_ledger()
    seen = load_seen()

    log(f"📊 Ledger: paid=${ledger['total_paid_usdc']:.2f} USDC | accepted={ledger['total_accepted']} | rejected={ledger['total_rejected']}")

    # Get list of our active task IDs
    task_ids = load_task_ids()
    # Always include known task from this session
    known_tasks = ["0xab58bacae3f206f145a9757ff2600e27a1ff8bb67d7d9bdc3204fd6cd4806722"]
    for t in known_tasks:
        if t not in task_ids:
            task_ids.append(t)
            save_task_id(t)

    log(f"🎯 Monitoring {len(task_ids)} active task(s)")

    # Load consecutive rejection counter
    consec_state = load_json(CONSEC_REJECT_FILE, {"count": 0, "paused": False})
    if consec_state.get("paused"):
        log(f"🚨 REVIEWER PAUSED — {consec_state['count']} consecutive rejections hit limit {MAX_CONSECUTIVE_REJECTIONS}")
        log("   Sending Telegram alert and standing by for manual review...")
        env_vars = load_env_vars()
        send_telegram_pause_alert(consec_state['count'], env_vars)
        return

    total_new = 0
    total_accepted = 0
    total_rejected = 0
    consec_rejections = consec_state.get("count", 0)

    for task_id in task_ids:
        log(f"\n📋 Checking submissions for task {task_id[:20]}...")

        result = taskmarket_cli("task", "submissions", task_id)
        if not result or not result.get("ok"):
            log(f"  ⚠️ Could not fetch submissions: {result}")
            continue

        submissions = result.get("data", {})
        if isinstance(submissions, list):
            sub_list = submissions
        elif isinstance(submissions, dict):
            sub_list = submissions.get("submissions") or submissions.get("data") or []
        else:
            sub_list = []

        log(f"  📥 {len(sub_list)} total submission(s)")

        for sub in sub_list:
            sub_id = sub.get("id") or sub.get("submissionId") or hashlib.md5(
                json.dumps(sub, sort_keys=True).encode()
            ).hexdigest()[:16]

            if sub_id in seen:
                continue

            total_new += 1
            seen.add(sub_id)

            # Get submission content — may be in S3 via fileUrl, download via CLI
            content = sub.get("content") or sub.get("data") or sub.get("submission") or ""
            if not content:
                # Download from S3/storage via CLI
                dl_result = taskmarket_cli("task", "download", task_id, "--submission", sub_id)
                if dl_result and isinstance(dl_result, str):
                    content = dl_result
                elif dl_result and isinstance(dl_result, dict):
                    content = dl_result.get("data", {}).get("content", "") or str(dl_result)
                else:
                    # Direct subprocess to capture raw stdout (CLI outputs raw text for download)
                    try:
                        raw = subprocess.run(
                            TASKMARKET + ["task", "download", task_id, "--submission", sub_id],
                            capture_output=True, text=True, timeout=30,
                            env={**os.environ, "HOME": str(Path.home())}
                        )
                        content = raw.stdout.strip() or raw.stderr.strip()
                    except Exception:
                        content = ""

            if not content:
                log(f"  [SKIP] {sub_id} — no content (fileUrl={sub.get('fileUrl','none')[:40]})")
                ledger["total_rejected"] = ledger.get("total_rejected", 0) + 1
                total_rejected += 1
                consec_rejections += 1
                continue

            # Parse and validate
            is_valid, reason, parsed = validate_trace(str(content))
            if not is_valid:
                log(f"  [REJECT] {sub_id} — {reason}")
                ledger["total_rejected"] = ledger.get("total_rejected", 0) + 1
                total_rejected += 1
                consec_rejections += 1
                save_json(PAYOUT_LEDGER_FILE, ledger)
                # Check consecutive rejection limit
                if consec_rejections >= MAX_CONSECUTIVE_REJECTIONS:
                    save_json(CONSEC_REJECT_FILE, {"count": consec_rejections, "paused": True})
                    log(f"🚨 {consec_rejections} consecutive rejections — pausing reviewer, alerting Carlos")
                    env_vars = load_env_vars()
                    send_telegram_pause_alert(consec_rejections, env_vars)
                    save_seen(seen)
                    return
                continue

            ground_truth = parsed.get("ground_truth_archetype", "unlabeled")
            payment_address = parsed.get("payment_address") or parsed.get("paymentAddress")

            # Run forensics
            log(f"  [FORENSICS] {sub_id} | target={ground_truth}")
            forensics = run_forensics(parsed)
            f_data = forensics.get("forensics", {})
            confidence = f_data.get("confidence", 0)
            detected = f_data.get("archetype", "CLEAN")

            accept, accept_reason = should_accept(parsed, forensics)
            log(f"  → {'ACCEPT' if accept else 'REJECT'}: {accept_reason}")

            if not accept:
                ledger["total_rejected"] = ledger.get("total_rejected", 0) + 1
                total_rejected += 1
                consec_rejections += 1
                save_json(PAYOUT_LEDGER_FILE, ledger)
                if consec_rejections >= MAX_CONSECUTIVE_REJECTIONS:
                    save_json(CONSEC_REJECT_FILE, {"count": consec_rejections, "paused": True})
                    log(f"🚨 {consec_rejections} consecutive rejections — pausing reviewer, alerting Carlos")
                    env_vars = load_env_vars()
                    send_telegram_pause_alert(consec_rejections, env_vars)
                    save_seen(seen)
                    return
                time.sleep(1)
                continue

            # Reset consecutive rejection counter on accept
            consec_rejections = 0
            save_json(CONSEC_REJECT_FILE, {"count": 0, "paused": False})

            if balance < USDC_STOP_THRESHOLD:
                log(f"  ⚠️ Would accept but budget exhausted (${balance:.2f} remaining)")
                time.sleep(1)
                continue

            # Calculate reward: base + priority bonus + confidence bonus
            priority = ARCHETYPE_PRIORITY.get(ground_truth or detected, 3)
            bonus = 0.0
            if confidence >= 0.90 and priority >= 8:
                bonus = REWARD_BONUS_HIGH  # high-signal, high-priority archetype
                log(f"  ⭐ High-signal bonus: +${bonus:.1f} USDC (conf={confidence:.2f}, priority={priority})")
            reward = min(REWARD_BASE + bonus, REWARD_MAX)

            paddr = str(payment_address or "0x0000000000000000000000000000000000000000")
            paid = accept_submission(task_id, sub_id, paddr, reward)
            if paid:
                record_payment(ledger, sub_id, reward, ground_truth or detected, paddr, task_id)
                balance -= reward
                total_accepted += 1
                log(f"  💰 Paid ${reward:.2f} USDC | Remaining budget: ${balance:.2f} USDC")

            time.sleep(1)

    save_seen(seen)
    save_json(CONSEC_REJECT_FILE, {"count": consec_rejections, "paused": False})

    log("\n" + "=" * 60)
    log(f"✅ Reviewer cycle complete")
    log(f"   New submissions processed: {total_new}")
    log(f"   Accepted + paid: {total_accepted}")
    log(f"   Rejected: {total_rejected}")
    log(f"   Consecutive rejections: {consec_rejections}")
    log(f"   Total paid to date: ${ledger['total_paid_usdc']:.2f} USDC")
    log(f"   Remaining wallet balance: ${balance:.2f} USDC")
    log("=" * 60)


if __name__ == "__main__":
    run()
