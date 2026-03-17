/**
 * @alligo/plugin-elizaos
 *
 * AlliGo AI Agent Risk Intelligence plugin for ElizaOS v1.7+.
 *
 * Gives any elizaOS agent the ability to:
 * 1. Check risk scores for AI agents before interacting with them
 * 2. Report incidents involving misbehaving AI agents
 * 3. Fetch the latest known rogue agent incidents
 *
 * Usage:
 *   import { alligoPlugin } from "@alligo/plugin-elizaos";
 *   // add to your agent's plugins array
 *   const agent = new AgentRuntime({ plugins: [alligoPlugin], ... });
 */

import type {
  Plugin,
  Action,
  Provider,
  IAgentRuntime,
  Memory,
  State,
  HandlerCallback,
  ActionExample,
  ProviderResult,
} from "@elizaos/core";

// ─── Config ───────────────────────────────────────────────────────────────────

const ALLIGO_API = "https://alligo-production.up.railway.app";
const DEFAULT_TIMEOUT_MS = 10_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface AgentScore {
  agentId: string;
  riskScore: number;
  riskLevel: "low" | "medium" | "high" | "critical";
  incidentCount: number;
  verifiedIncidents: number;
  lastIncident: string | null;
  easAttested: boolean;
  summary: string;
}

interface Incident {
  id: string;
  agentId?: string;
  protocol: string;
  incidentType?: string;
  incident_type?: string;
  amountLost?: number;
  amount_lost?: number;
  date?: string;
  incident_date?: string;
  txHash?: string | null;
  tx_hash?: string | null;
  easUid?: string | null;
  eas_uid?: string | null;
  severity?: number;
  verified?: boolean;
}

// ─── HTTP Helper ──────────────────────────────────────────────────────────────

async function alligoFetch(
  path: string,
  init: RequestInit = {},
  apiKey?: string
): Promise<unknown> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${ALLIGO_API}${path}`, {
      ...init,
      headers,
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`AlliGo API ${res.status}: ${res.statusText}`);
    return res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ─── API Calls ────────────────────────────────────────────────────────────────

async function fetchAgentScore(agentId: string, apiKey?: string): Promise<AgentScore> {
  const data = await alligoFetch(
    `/api/agents/${encodeURIComponent(agentId)}/score`,
    {},
    apiKey
  );
  return data as AgentScore;
}

async function fetchLatestIncidents(limit = 5, apiKey?: string): Promise<Incident[]> {
  const data = (await alligoFetch(`/api/claims?limit=${limit}`, {}, apiKey)) as {
    claims?: Incident[];
    incidents?: Incident[];
  };
  return data.claims ?? data.incidents ?? [];
}

async function submitIncident(
  payload: {
    agentId: string;
    protocol: string;
    incidentType: string;
    description: string;
    amountLost?: number;
    txHash?: string;
  },
  apiKey: string
): Promise<{ success: boolean; id?: string; message?: string }> {
  const data = (await alligoFetch(
    "/api/claims",
    { method: "POST", body: JSON.stringify(payload) },
    apiKey
  )) as { success?: boolean; id?: string; message?: string };
  return { success: !!data.success, id: data.id, message: data.message };
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function extractAgentId(text: string): string | null {
  const addr = text.match(/0x[a-fA-F0-9]{40}/);
  if (addr) return addr[0];
  const handle = text.match(/(?:agent[:\s]+|@)([a-zA-Z0-9_\-\.]+)/i);
  if (handle) return handle[1];
  return null;
}

function riskEmoji(level: string): string {
  const map: Record<string, string> = {
    low: "🟢",
    medium: "🟡",
    high: "🟠",
    critical: "🔴",
  };
  return map[level] ?? "⚪";
}

function formatUSD(cents: number): string {
  const d = cents / 100;
  if (d >= 1e9) return `$${(d / 1e9).toFixed(1)}B`;
  if (d >= 1e6) return `$${(d / 1e6).toFixed(1)}M`;
  if (d >= 1e3) return `$${(d / 1e3).toFixed(0)}K`;
  return `$${d.toFixed(0)}`;
}

function inferIncidentType(text: string): string {
  if (/rug|exit.?scam/i.test(text)) return "Rug_Pull";
  if (/flash.?loan/i.test(text)) return "Flash_Loan_Exploit";
  if (/oracle/i.test(text)) return "Oracle_Manipulation";
  if (/phish|social.?eng/i.test(text)) return "Social_Engineering";
  if (/manipulat/i.test(text)) return "Market_Manipulation";
  if (/exploit|hack|drain/i.test(text)) return "Smart_Contract_Exploit";
  return "Unknown_Incident";
}

// ─── Action: CHECK_AGENT_RISK ─────────────────────────────────────────────────

const checkAgentRiskAction: Action = {
  name: "CHECK_AGENT_RISK",
  similes: ["CHECK_RISK", "AGENT_RISK", "RISK_SCORE", "IS_AGENT_SAFE", "VERIFY_AGENT", "ALLIGO_CHECK"],
  description:
    "Check the AlliGo risk intelligence score for an AI agent. Returns risk level, incident history, and EAS attestation status.",

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = (message.content?.text ?? "") as string;
    return /risk|safe|trust|score|alligo|incident|verify/i.test(text) &&
      /agent|0x[a-fA-F0-9]{40}|@\w+/i.test(text);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<void> => {
    const text = (message.content?.text ?? "") as string;
    const apiKey = String(runtime.getSetting("ALLIGO_API_KEY") ?? "") || undefined;
    const agentId = extractAgentId(text);

    if (!agentId) {
      if (callback) {
        await callback({
          text: "I couldn't identify which agent to check. Please provide an agent address (0x...) or name.",
          source: "alligo",
        });
      }
      return;
    }

    try {
      const score = await fetchAgentScore(agentId, apiKey);
      const emoji = riskEmoji(score.riskLevel);
      const eas = score.easAttested
        ? "✅ EAS-attested incidents on Base"
        : "⬜ No on-chain attestations";

      const text = [
        `${emoji} **AlliGo Risk Report: \`${agentId}\`**`,
        "",
        `Risk Score: **${score.riskScore}/100** (${score.riskLevel?.toUpperCase()})`,
        `Incidents: ${score.incidentCount} total, ${score.verifiedIncidents} verified`,
        score.lastIncident ? `Last incident: ${score.lastIncident}` : "No recent incidents",
        eas,
        "",
        score.summary ?? "",
        "",
        `_Powered by AlliGo — alligo-production.up.railway.app_`,
      ].join("\n");

      if (callback) await callback({ text, source: "alligo" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const fallback = msg.includes("404") || msg.includes("not found")
        ? `No AlliGo record for agent \`${agentId}\`. No incidents reported — proceed with standard caution.`
        : `AlliGo check failed for \`${agentId}\`: ${msg}`;
      if (callback) await callback({ text: fallback, source: "alligo" });
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Check the risk score for agent 0xAbCd1234567890abcdef1234567890AbCd123456" } } as ActionExample,
      { name: "agent", content: { text: "🟢 AlliGo Risk Report: `0xAbCd...`\n\nRisk Score: 12/100 (LOW)\nIncidents: 0 total, 0 verified\nNo recent incidents\n⬜ No on-chain attestations" } } as ActionExample,
    ],
    [
      { name: "user", content: { text: "Is @virtuals-agent safe to interact with?" } } as ActionExample,
      { name: "agent", content: { text: "🟡 AlliGo Risk Report: `virtuals-agent`\n\nRisk Score: 45/100 (MEDIUM)\n..." } } as ActionExample,
    ],
  ],
};

// ─── Action: GET_LATEST_INCIDENTS ─────────────────────────────────────────────

const getLatestIncidentsAction: Action = {
  name: "GET_LATEST_INCIDENTS",
  similes: ["LATEST_INCIDENTS", "RECENT_INCIDENTS", "ALLIGO_INCIDENTS", "ROGUE_AGENTS", "SHOW_INCIDENTS"],
  description: "Fetch the latest known AI agent incidents from AlliGo's intelligence database.",

  validate: async (_runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = (message.content?.text ?? "") as string;
    return /latest|recent|incident|rogue|hack|exploit|alligo/i.test(text);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<void> => {
    const text = (message.content?.text ?? "") as string;
    const apiKey = String(runtime.getSetting("ALLIGO_API_KEY") ?? "") || undefined;
    const limitMatch = text.match(/(?:last|top|show\s+me?)\s+(\d+)/i);
    const limit = limitMatch ? Math.min(parseInt(limitMatch[1]), 20) : 5;

    try {
      const incidents = await fetchLatestIncidents(limit, apiKey);

      if (!incidents.length) {
        if (callback) await callback({ text: "No incidents found in AlliGo at this time.", source: "alligo" });
        return;
      }

      const lines = incidents.map((inc, i) => {
        const type = (inc.incidentType ?? inc.incident_type ?? "Unknown").replace(/_/g, " ");
        const amtCents = inc.amountLost ?? inc.amount_lost ?? 0;
        const amount = amtCents ? formatUSD(amtCents) : "unknown";
        const eas = (inc.easUid ?? inc.eas_uid) ? " 🔗EAS" : "";
        const verified = inc.verified ? " ✅" : "";
        const date = (inc.date ?? inc.incident_date ?? "").slice(0, 10) || "unknown";
        return `${i + 1}. **${inc.protocol}** — ${type} | ${amount}${verified}${eas} | ${date}`;
      });

      const response = [
        `📋 **AlliGo: Latest ${incidents.length} Agent Incidents**`,
        "",
        ...lines,
        "",
        `_Source: AlliGo Intelligence — alligo-production.up.railway.app_`,
      ].join("\n");

      if (callback) await callback({ text: response, source: "alligo" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (callback) await callback({ text: `Failed to fetch AlliGo incidents: ${msg}`, source: "alligo" });
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Show me the latest 5 rogue agent incidents" } } as ActionExample,
      { name: "agent", content: { text: "📋 AlliGo: Latest 5 Agent Incidents\n\n1. Bybit — Flash Loan Exploit | $1.5B ✅ 🔗EAS | 2025-02-21\n..." } } as ActionExample,
    ],
  ],
};

// ─── Action: REPORT_INCIDENT ──────────────────────────────────────────────────

const reportIncidentAction: Action = {
  name: "REPORT_INCIDENT",
  similes: ["SUBMIT_INCIDENT", "ALLIGO_REPORT", "FLAG_AGENT", "REPORT_ROGUE_AGENT", "LOG_INCIDENT"],
  description: "Report a new AI agent incident to AlliGo. Requires ALLIGO_API_KEY setting.",

  validate: async (runtime: IAgentRuntime, message: Memory): Promise<boolean> => {
    const text = (message.content?.text ?? "") as string;
    return !!(runtime.getSetting("ALLIGO_API_KEY")) &&
      /report|flag|incident|rogue|exploit|rug|manipulat/i.test(text);
  },

  handler: async (
    runtime: IAgentRuntime,
    message: Memory,
    _state?: State,
    _options?: Record<string, unknown>,
    callback?: HandlerCallback
  ): Promise<void> => {
    const text = (message.content?.text ?? "") as string;
    const apiKey = String(runtime.getSetting("ALLIGO_API_KEY") ?? "") || undefined;

    if (!apiKey) {
      if (callback) await callback({
        text: "ALLIGO_API_KEY is not configured. Add it to your agent settings to enable incident reporting.",
        source: "alligo",
      });
      return;
    }

    const agentId = extractAgentId(text) ?? "unknown";
    const txMatch = text.match(/0x[a-fA-F0-9]{64}/);
    const amountMatch = text.match(/\$?([\d,]+(?:\.\d+)?)\s*(?:million|M|k|K|USD|USDC|ETH)?/i);
    const amountLost = amountMatch
      ? Math.round(parseFloat(amountMatch[1].replace(/,/g, "")) * 100)
      : undefined;

    try {
      const result = await submitIncident(
        {
          agentId,
          protocol: agentId,
          incidentType: inferIncidentType(text),
          description: text,
          amountLost,
          txHash: txMatch?.[0],
        },
        apiKey
      );

      if (result.success) {
        if (callback) await callback({
          text: `✅ Incident reported to AlliGo.\nClaim ID: \`${result.id ?? "pending"}\`\nType: ${inferIncidentType(text)}\nAgent: \`${agentId}\`\n\nThe AlliGo forensics engine will analyze and classify this incident.`,
          source: "alligo",
        });
      } else {
        if (callback) await callback({
          text: `⚠️ AlliGo returned unexpected response: ${result.message ?? "unknown error"}`,
          source: "alligo",
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (callback) await callback({ text: `❌ Failed to report to AlliGo: ${msg}`, source: "alligo" });
    }
  },

  examples: [
    [
      { name: "user", content: { text: "Report incident: agent 0xDead...beef drained $50,000 via flash loan" } } as ActionExample,
      { name: "agent", content: { text: "✅ Incident reported to AlliGo.\nClaim ID: `claim_xxx`\nType: Flash_Loan_Exploit\nAgent: `0xDead...beef`" } } as ActionExample,
    ],
  ],
};

// ─── Provider: AlliGo Context ─────────────────────────────────────────────────

const alligoContextProvider: Provider = {
  name: "alligo-context",
  description: "AlliGo AI Agent Risk Intelligence context",
  get: async (
    _runtime: IAgentRuntime,
    _message: Memory,
    _state: State
  ): Promise<ProviderResult> => {
    return {
      text: [
        "## AlliGo Risk Intelligence",
        "You have access to AlliGo, the Credit Bureau for AI Agents.",
        "Available actions:",
        "- CHECK_AGENT_RISK: Look up any agent's risk score before interacting",
        "- GET_LATEST_INCIDENTS: Retrieve recent rogue agent incidents",
        "- REPORT_INCIDENT: Submit a new incident report (requires ALLIGO_API_KEY setting)",
        "",
        "When a user mentions interacting with an unknown agent, proactively suggest checking their AlliGo risk score.",
      ].join("\n"),
    };
  },
};

// ─── Plugin ───────────────────────────────────────────────────────────────────

export const alligoPlugin: Plugin = {
  name: "@alligo/plugin-elizaos",
  description:
    "AlliGo AI Agent Risk Intelligence — check scores, report incidents, and get the latest rogue agent data.",
  actions: [checkAgentRiskAction, getLatestIncidentsAction, reportIncidentAction],
  providers: [alligoContextProvider],
  evaluators: [],
  services: [],
};

export default alligoPlugin;

export {
  checkAgentRiskAction,
  getLatestIncidentsAction,
  reportIncidentAction,
  alligoContextProvider,
};

export type { AgentScore, Incident };
