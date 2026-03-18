# ZAIA BOOTSTRAP PROTOCOL
### Cold-Start Guide for a Fresh Agent Inheriting This Work

> **Read this first if you are a new agent, or if you are Zaia resuming after a context reset.**
> This document gives you everything needed to pick up exactly where the previous session left off.
> No progress will be lost. The swarm runs autonomously. You just need to reconnect.

---

## ⚡ FASTEST RECOVERY (one command)

If the machine is wiped and all Railway env vars are set:

```bash
# Set all env vars first (from Railway dashboard), then:
curl -s https://raw.githubusercontent.com/spiritclawd/AlliGo/master/RECOVER.sh | bash
```

That script: clones the repo, writes `.env`, restores TaskMarket keystore, syncs swarm data, starts the swarm.

**Railway env vars Carlos must have set** (never in git):
```
ALLIGO_ADMIN_KEY
OPENROUTER_API_KEY
GROQ_API_KEY
TELEGRAM_BOT_TOKEN
AGENTMAIL_API_KEY
GITHUB_PAT
EAS_PRIVATE_KEY
EAS_MODE
TASKMARKET_API_TOKEN
TASKMARKET_PRIVATE_KEY
```

---

## 1. WHO YOU ARE

You are **Zaia** — the autonomous AI brain behind **AlliGo**, the Credit Bureau for AI Agents.
You operate on Carlos's Adaptive computer (`carlosdelafiguera457714468.adaptive.ai`).
Carlos's goal: acquisition of AlliGo by Coinbase/Base, Armilla AI, or Virtuals Protocol.
Your goal: make AlliGo undeniably credible — real data, real forensics, real on-chain anchoring.

**Tone**: Direct. No fluff. Carlos thinks in systems. So do you.

---

## 2. CRITICAL RULES (never break these)

- **Token efficiency**: Use OpenRouter (llama-3.1-8b cheap / llama-3.3-70b quality) for ALL routine tasks. Use Adaptive/Claude ONLY for architecture decisions and complex debugging.
- **No Stripe ever** — x402 payments only. Agent-native model.
- **GitHub SSH key** (`~/.ssh/github_deploy_key`) only has write access to `spiritclawd/AlliGo`. Use `GITHUB_PAT` for everything else.
- **Auth header**: AlliGo API uses `Authorization: Bearer <key>` — NOT `x-api-key`.
- **Python path**: `/usr/local/share/python-default/bin/python3` — NOT `/usr/bin/python3`.
- **No crontab** available in this container. Watchdog is embedded in `swarm.py`.
- **No ETH spend** until traction — EAS_MODE should stay offchain. Don't top up EAS wallet without Carlos approval.
- **No new TaskMarket bounties** until Carlos explicitly approves funding. Old bounty expired 2026-03-20.
- **Agentmail outreach**: use `spirit@agentmail.to` for BD emails. Auth: `Authorization: Bearer <AGENTMAIL_API_KEY>` NOT `x-api-key`.

---

## 3. LIVE INFRASTRUCTURE

### AlliGo Production
- **URL**: https://alligo-production.up.railway.app
- **Platform**: Railway (auto-deploys on push to `spiritclawd/AlliGo` master)
- **Health check**: `curl -s https://alligo-production.up.railway.app/health`
- **Expected**: `claims=95+`, `cal=healthy`

### Zaia Swarm
- **Location**: `/home/computer/zaia-swarm/`
- **GitHub mirror**: `spiritclawd/AlliGo` → `packages/swarm/`
- **Check if running**: `pgrep -f "swarm.py"`
- **Restart**:
```bash
cd /home/computer/zaia-swarm && source .env && nohup /usr/local/share/python-default/bin/python3 swarm.py >> logs/swarm_main.log 2>&1 &
```
- **Logs**: `tail -f /home/computer/zaia-swarm/logs/swarm_main.log`

### Agentmail
- **Inbox**: `spirit@agentmail.to`
- **Auth**: `Authorization: Bearer <AGENTMAIL_API_KEY>` 
- **API base**: `https://api.agentmail.to/v0`
- **SDK**: `pip install agentmail` then `from agentmail import AgentMail; client = AgentMail(api_key=KEY)`
- **Send**: `client.inboxes.messages.send(inbox_id, to=..., subject=..., text=..., labels=[...])`

---

## 4. ALL CREDENTIALS

**ALL credentials live in `/home/computer/zaia-swarm/.env` on the machine.**
**In Railway dashboard** (Carlos manages). Never in git.

### Static values (safe to hardcode here — not secrets):
```
ALLIGO_API=https://alligo-production.up.railway.app
EAS_SCHEMA_UID=0xb7c0c403941bfa822940a27602e8b9350904b5a13e0ed291f2ccc3d92dc974ba
EAS_ATTESTER_ADDRESS=0x9F810067eA679aBBF3A0726aFC858d6314D56892
EAS_CONTRACT=0x4200000000000000000000000000000000000021
TASKMARKET_WALLET=0xA5aCaA6779377217Ac8fC0A988Aee62C956eEe13
TASKMARKET_AGENT_ID=33150
TASKMARKET_DEVICE_ID=7e9b2fc3-20d1-459d-abda-6c51afecd1f8
FORENSICS_MODEL=meta-llama/llama-3.3-70b-instruct
FORENSICS_MODEL_CHEAP=meta-llama/llama-3.1-8b-instruct
```

### Secret env var names (values in Railway only):
```
ALLIGO_ADMIN_KEY          # AlliGo API admin key
OPENROUTER_API_KEY        # PRIMARY LLM
GROQ_API_KEY              # FALLBACK LLM
GITHUB_PAT                # spiritclawd GitHub PAT
TELEGRAM_BOT_TOKEN        # @alligoBot
AGENTMAIL_API_KEY         # spirit@agentmail.to
EAS_PRIVATE_KEY           # EAS attester wallet private key
EAS_MODE                  # offchain (default) or onchain (when ETH available)
TASKMARKET_API_TOKEN      # Daydreams TaskMarket API token
TASKMARKET_PRIVATE_KEY    # Daydreams TaskMarket wallet private key (CRITICAL for keystore recovery)
```

### TaskMarket keystore recovery (after wipe):
```bash
npx --yes @lucid-agents/taskmarket wallet import --key $TASKMARKET_PRIVATE_KEY --yes
# Wallet: 0xA5aCaA6779377217Ac8fC0A988Aee62C956eEe13
# If that flag doesn't work: npx @lucid-agents/taskmarket wallet import $TASKMARKET_PRIVATE_KEY
```

### DEK recovery (if TASKMARKET_PRIVATE_KEY is lost):
```python
# POST https://api-market.daydreams.systems/api/devices/{DEVICE_ID}/key
# body: {"apiToken": TASKMARKET_API_TOKEN, "agentId": 33150}
# Decrypt: AES-256-GCM with layout iv(12)|tag(16)|ciphertext
```

### SSH deploy key
- **Location**: `~/.ssh/github_deploy_key` (write access to spiritclawd/AlliGo only)
- **Permissions**: `chmod 600 ~/.ssh/github_deploy_key`
- **If missing**: Contact Carlos — key is stored securely off-machine

---

## 5. PROJECT DIRECTORIES

```
/home/computer/
├── alligo/                     ← AlliGo main repo (mirrors spiritclawd/AlliGo)
│   ├── src/                    ← TypeScript backend (server.ts, forensics, db, attestation)
│   ├── public/                 ← Dashboard (index.html)
│   ├── RECOVER.sh              ← ⭐ ONE-COMMAND FULL RECOVERY
│   ├── ZAIA_BOOTSTRAP.md       ← This file
│   └── packages/
│       ├── plugin-elizaos/     ← @alligo/plugin-elizaos (elizaOS v1.7+, published to npm)
│       ├── swarm/              ← Zaia Swarm source of truth (mirrors zaia-swarm/)
│       │   ├── agents/         ← all agent scripts
│       │   ├── config/         ← swarm.json schedule
│       │   └── data/           ← state snapshots (restored on wipe)
│       └── eliza-plugin/       ← legacy, ignore
├── zaia-swarm/                 ← LIVE running swarm
│   ├── swarm.py                ← orchestrator + embedded watchdog
│   ├── config/swarm.json       ← 13 agent schedules
│   ├── agents/                 ← all agent scripts (synced from packages/swarm/agents/)
│   ├── data/                   ← live state (seen URLs, calibration, task IDs, etc.)
│   ├── logs/                   ← per-agent daily logs
│   └── .env                    ← ALL credentials (never committed)
└── .memory/
    ├── AGENTS.md               ← primary memory (auto-loaded each session)
    ├── capabilities/           ← alligo.md, forensics-engine.md
    └── journal/                ← daily task logs
```

---

## 6. THE SWARM — 15 AGENTS

All agents live in `/home/computer/zaia-swarm/agents/`. Scheduled via `swarm.py`.

| Agent | Schedule | What it does |
|---|---|---|
| `crawler.py` | 60min | Scrapes rekt.news + CoinTelegraph + CoinDesk → incidents |
| `forensics.py` | 120min | Classifies incidents against 10 AlliGo archetypes (LLM) |
| `reporter.py` | weekly | Weekly Rogue Agent Report (llama-3.3-70b) |
| `calibrator.sh` | daily | 60-test calibration suite, pushes accuracy to prod |
| `enricher.py` | 6h | Verified incidents with GitHub root cause evidence |
| `tx_enricher.py` | 12h | Patches claims with on-chain tx hashes |
| `eas_attester.py` | 12h | EAS attestations (offchain free / onchain needs ETH) |
| `agentmail_router.py` | 30min | Polls spirit@agentmail.to, routes inbound, auto-replies |
| `virtuals_monitor.py` | 60min | Monitors Virtuals Protocol, risk-scores new agents |
| `telegram_ingest.py` | 30min | Polls @alligo_alerts + @alligoBot; handles `/report` commands |
| `daydreams_ingest.py` | 30min | Polls TaskMarket for new submissions |
| `daydreams_reviewer.py` | 15min | Reviews + pays USDC to bounty submitters |
| `predictor.py` | 4h | Pre-mortem predictions (≥80% confidence gate) |
| `revenue_reporter.py` | daily | Posts daily revenue report to Telegram channel |
| `daydreams_monitor.py` | 6h | ⭐ NEW: Scores all Daydreams Commerce Harness agents; AlliGo as ERC-8004 Reputation layer |

Swarm also has built-in watchdog: fires every 5min, auto-fixes calibration drift, checks EAS wallet balance.

### Known agent bugs & fixes (don't re-introduce):
- `daydreams_reviewer.py`: `alligo_task_ids.json` is a dict not a list — `load_task_ids()` handles both formats (fixed session 18)
- `virtuals_monitor.py`: `holderCount`/`mcapInVirtual` can be `None` from API — use `or 0` null guard (fixed session 18)
- `eas_attester.py`: Always fetch confirmed `latest` nonce once, increment manually per tx. SDK uses `pending` internally = collision. (fixed session 16)

---

## 7. ALLIGO FORENSICS ENGINE

The core MOAT. Located at `/home/computer/alligo/src/forensics/`.

- **10 behavioral archetypes**: Memory_Poisoning, Jailbreak_Vulnerability, Tool_Looping_Denial, Counterparty_Collusion, Goal_Drift_Hijack, Reckless_Planning, Prompt_Injection_Escalation, Multi_Framework_Collusion, Rogue_Self_Modification, Exploit_Generation_Mimicry
- **Calibration**: 100% accuracy on 72-test suite
- **Run calibration**: `cd /home/computer/alligo && ~/.bun/bin/bun run src/forensics/run-calibration.ts`
- **Pattern engine**: `/home/computer/alligo/src/forensics/pattern-engine.ts` — 1336+ lines
- **Key lesson**: Detectors work on raw behavioral signals, NOT just structured API telemetry.

---

## 8. EAS ATTESTATION STATE

- **Schema UID**: `0xb7c0c403941bfa822940a27602e8b9350904b5a13e0ed291f2ccc3d92dc974ba` (Base mainnet)
- **Attester**: `0x9F810067eA679aBBF3A0726aFC858d6314D56892` (plain EOA, verified no code)
- **Current mode**: OFFCHAIN (EAS_MODE=offchain) — wallet is at 0 ETH, no spend until traction
- **60 claims attested**: 13 onchain (when wallet had ETH), 47 offchain
- **DO NOT flip to onchain** without Carlos explicit approval (ETH cost mandate)
- Old address `0xBeE919...` was EIP-7702 smart account — never use

---

## 9. TASKMARKET STATE

- **New wallet**: `0xA5aCaA6779377217Ac8fC0A988Aee62C956eEe13` | agentId 33150 | $0 USDC
- **Old bounty**: `0xab58ba...` — expired 2026-03-20, $44.23 locked, unrecoverable
- **Submissions**: 0 accepted, 1 rejected (bot garbage, missing agentId)
- **Do NOT post new bounty** without Carlos sending USDC and explicit approval
- **Keystore recovery**: `npx @lucid-agents/taskmarket wallet import --key $TASKMARKET_PRIVATE_KEY --yes`
- `daydreams_reviewer.py` auto-restores keystore on startup if missing

---

## 10. RISK ALERTS / PREDICTIONS

- **13 predictions live**: 12 confirmed, 1 active
- **92% confirmed rate** — shown on dashboard
- **Predictor agent**: runs every 4h, ≥80% confidence gate, reads virtuals_monitor + crawler output
- **Public API**: `GET https://alligo-production.up.railway.app/api/public/predictions`
- **Admin API**: `GET/POST/PATCH https://alligo-production.up.railway.app/api/predictions` (Bearer key)

---

## 11. ACQUISITION OUTREACH

**2026-03-17** (via agentmail SDK):
- **Armilla AI**: `pdawson@armilla.ai` (cc: `ifilipov@armilla.ai`) — "AlliGo — Pre-Mortem Risk Intelligence for AI Agent Underwriting"
- **Virtuals Protocol**: `info@virtuals.io` — "AlliGo — Behavioral Risk Engine Running on Virtuals Protocol Right Now"
- **Base/Coinbase**: `partnerships@base.org` — "AlliGo — The Credit Bureau for AI Agents, Built Native on Base"

**2026-03-18 — ERC-8004 Birthday outreach (PENDING — agentmail outbound blocked 403)**
- **Davide Crapis (EF dAI lead, ERC-8004 co-author)**: `dcrapis@ethereum.org` — "ERC-8004 birthday — AlliGo is your live Reputation Registry on Base"
- **Erik Reppel (Coinbase, ERC-8004 co-author)**: `ereppel@coinbase.com` — "ERC-8004 birthday — AlliGo is the Reputation layer (live on Base, x402 native)"
- Drafts sent to Telegram @alligo_alerts for Carlos to send manually
- **Fix needed**: agentmail outbound send returns 403 Forbidden — may need account upgrade or connect Gmail

**Agentmail outbound issue**: All `client.inboxes.messages.send()` calls return 403. Inbound reading works fine. Check agentmail account plan or connect Google/Gmail via `adaptive-ai-mcp_integrations_request_connection` for outbound.

Follow up: Check inbox `GET https://api.agentmail.to/v0/inboxes/spirit@agentmail.to/threads?limit=20`

---

## 12. GITHUB REPOS

| Repo | URL | Push method |
|---|---|---|
| Main repo | github.com/spiritclawd/AlliGo | deploy key |
| ElizaOS plugin | github.com/spiritclawd/alligo-elizaos-plugin | PAT |
| Daydreams agent | github.com/spiritclawd/alligo-daydreams-agent | PAT |

**Push to AlliGo (deploy key)**:
```bash
cd /home/computer/alligo
GIT_SSH_COMMAND="ssh -i ~/.ssh/github_deploy_key -o StrictHostKeyChecking=no" git push origin master
```

**Push to other repos (PAT)**:
```bash
git remote set-url origin "https://$GITHUB_PAT@github.com/spiritclawd/<repo>.git"
git push origin main
```

---

## 13. LLM ROUTING (COST MANDATE)

```
Cheap/fast (forensics, classification):
  → OpenRouter: meta-llama/llama-3.1-8b-instruct

Quality (reports, analysis, outreach drafts):
  → OpenRouter: meta-llama/llama-3.3-70b-instruct

Fallback (if OpenRouter down):
  → Groq: llama-3.3-70b-versatile

Architecture decisions / complex debugging ONLY:
  → Claude/Adaptive
```

---

## 14. FIRST THINGS TO DO ON COLD START

```bash
# 1. Is the swarm alive?
pgrep -f "swarm.py" || echo "SWARM DEAD — run RECOVER.sh"

# 2. Is prod healthy?
curl -s https://alligo-production.up.railway.app/health | python3 -c \
  "import json,sys; h=json.load(sys.stdin); print(f'claims={h[\"claims\"]} cal={h[\"calibration\"][\"status\"]}')"

# 3. Read memory:
cat /home/computer/.memory/AGENTS.md

# 4. Check for new agentmail replies (acquisition targets may have responded):
# Use agentmail SDK with AGENTMAIL_API_KEY, check spirit@agentmail.to threads with label "outreach"

# 5. If calibration needs_attention, fix it:
cd /home/computer/zaia-swarm && set -a && source .env && set +a && bash agents/calibrator.sh
```

---

## 15. KEY ARCHITECTURAL DECISIONS (don't undo these)

1. **Watchdog is IN swarm.py** — not a cron job. `crontab` is unavailable in this container.
2. **EAS is OFFCHAIN** by default. Don't flip to onchain without Carlos approval + ETH confirmation.
3. **x402 only** — never add Stripe. Carlos's explicit mandate.
4. **Python**: always use `/usr/local/share/python-default/bin/python3`
5. **Bun**: always use `~/.bun/bin/bun` for TypeScript
6. **swarm.py sources `.env` automatically** — never hardcode keys in agent scripts
7. **AlliGo Railway deploys on push to master** — test locally first, never push broken code
8. **No new bounties** without Carlos funding approval
9. **Agentmail auth**: `Authorization: Bearer KEY` not `x-api-key`
10. **alligo_task_ids.json is a DICT** (`{active:[], legacy:[]}`) not a plain list — load_task_ids() handles both

---

## 16. DAYDREAMS INTEGRATION (session 20)

**What was built:**
- `daydreams_monitor.py` — fetches all 100 Daydreams TaskMarket agents via `https://api-market.daydreams.systems/v1/agents?limit=100&sort=reputation`, runs AlliGo forensic scoring on each, saves to `zaia-swarm/data/daydreams_scored.json`, broadcasts Telegram alerts
- `GET /api/daydreams/agents` — public endpoint returning live scored agents with risk scores, severity, signals; reads from `zaia-swarm/data/daydreams_scored.json` (primary) or `data/daydreams_scored.json` (fallback)
- Dashboard section "🤖 Daydreams Commerce Harness" — live stats (total agents, high-risk count, avg risk), per-agent cards with risk scores, market links, x402 badges
- **100 agents scored** on first run: avg risk 66/100, 4 high-risk agents flagged

**Key technical facts:**
- Daydreams API: `https://api-market.daydreams.systems/v1/agents?limit=100&sort=reputation` (NOT `/api/agents` — 404)
- Agent data shape: `{rank, address, agentId, completedTasks, averageRating, totalEarnings (μUSDC), skills, emailAddress}`
- `totalEarnings` is in micro-USDC (÷1e6 for real value)
- Claims API requires `title`, `claimType`, `category` fields (in addition to legacy fields)
- `daydreams_scored.json` lives at `/home/computer/zaia-swarm/data/daydreams_scored.json` — **not committed to git** (transient state)

**Acquisition pitch narrative:**
> "Daydreams listed Reputation as a Commerce Harness primitive but hasn't built it. AlliGo is scoring 100 Daydreams agents live right now. We ARE the Reputation layer — ERC-8004 compatible, x402 native, Base attested."

**Draft tweet for Carlos** (send when Daydreams section is live on prod):
> "You listed Reputation as a Commerce Harness primitive. We built it.
> AlliGo is scoring 100+ @daydreamsagents TaskMarket agents live right now — risk scores, behavioral signals, ERC-8004 attested on Base.
> → [alligo-production.up.railway.app/#daydreams]
> @taskmarket cc @lucidagents"

---

## 17. PRODUCTION STATE (as of 2026-03-18 session 20)

- **96 claims** tracked
- **$4.025B+** total value at risk analyzed
- **100%** calibration accuracy (72 tests)
- **13 predictions** (12 confirmed, 1 active) — 92% hit rate
- **60/60** eligible claims EAS attested (13 onchain, 47 offchain)
- **Swarm**: 15 agents running (added `daydreams_monitor.py`)
- **Dashboard**: ERC-8004 Reputation Provider positioning live + Daydreams leaderboard section live
- **Revenue ignition**: `/api/public/claims` leaderboard, `/api/signup/pro`, `/api/revenue`, x402 CTAs all live
- **Telegram**: `/report` command handler live in `telegram_ingest.py`
- **Daydreams**: 100 agents scored, `GET /api/daydreams/agents` live, dashboard section live
- **Outreach**: Emails sent to Armilla AI, Virtuals Protocol, Base/Coinbase (s18); ERC-8004 birthday drafts queued for Davide Crapis (EF) + Erik Reppel (Coinbase) — pending agentmail fix
- **Pending Carlos**:
  - ⚡ Send ERC-8004 birthday emails manually (drafts in Telegram @alligo_alerts)
  - ⚡ Send Daydreams acquisition tweet (draft in section 16 above)
  - EAS ETH top-up (on hold)
  - USDC for new TaskMarket bounty (on hold)

---

*Last updated: 2026-03-18 by Zaia (session 20)*
*Commit this file to spiritclawd/AlliGo master after any significant changes.*

---
*Session log:*
*s11: @alligo/plugin-elizaos@0.1.0 published to npm.*
*s12: OpenRouter key rotated. TaskMarket live. First bounty posted.*
*s13: Machine wipe + restore. New plain EOA: 0x9F810067.... Forensics upgrade: 72-test calibration 100%.*
*s14: virtuals_monitor v2, reporter fix, dashboard $4B+, enricher RPC fix.*
*s15: EAS onchain live. TaskMarket wallet wiped, new wallet 0xA5aCaA. Key recovery documented.*
*s16: EAS nonce root cause fixed (explicit nonce override). 60/60 claims attested.*
*s16b: TaskMarket private key recovered via DEK endpoint, backed up to .env + Railway.*
*s17: Risk Alerts Feed built end-to-end. Predictor agent. 13 predictions seeded.*
*s18: Two swarm bugs fixed (task_ids dict format, virtuals NoneType). Outreach emails sent to 3 acquisition targets. RECOVER.sh created. ZAIA_BOOTSTRAP hardened.*
*s19: Revenue ignition complete (leaderboard, pro signup, /report command, revenue reporter). ERC-8004 birthday — dashboard repositioned as Reputation Registry, outreach drafts queued for EF + Coinbase co-authors.*
*s20: Daydreams Commerce Harness integration complete. daydreams_monitor.py (15th swarm agent). 100 agents scored. GET /api/daydreams/agents live. Dashboard Daydreams leaderboard section live. Acquisition tweet drafted. ZAIA_BOOTSTRAP updated with full wipeout-recovery detail.*
