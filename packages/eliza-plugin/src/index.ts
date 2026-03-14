/**
 * AlliGo Plugin for Eliza Agents
 * 
 * Check agent risk scores before transactions
 * @see https://alligo.io
 */

// Types
export interface AlliGoConfig {
  apiKey: string;
  baseUrl?: string;
  minScore?: number;        // Minimum acceptable risk score (0-100)
  blockGrades?: string[];   // Grades to block (default: ['F'])
  timeout?: number;         // Request timeout in ms
}

export interface AgentScore {
  agentId: string;
  riskScore: number;
  grade: string;
  totalClaims: number;
  totalValueLost: number;
  openClaims: number;
  summary: string;
  lastUpdated: number;
  confidence: number;
}

export interface RiskCheckResult {
  allowed: boolean;
  score: AgentScore | null;
  reason: string;
  recommendation: string;
}

export interface Claim {
  id: string;
  agentId: string;
  agentName?: string;
  title: string;
  description: string;
  amountLost: number;
  claimType: string;
  category: string;
  severity: {
    level: string;
    score: number;
  };
  resolution: string;
  verified: boolean;
  timestamp: number;
  chain?: string;
  platform?: string;
}

const DEFAULT_BASE_URL = "https://alligo.io";
const DEFAULT_MIN_SCORE = 40;
const DEFAULT_BLOCK_GRADES = ["F"];
const DEFAULT_TIMEOUT = 5000;

/**
 * AlliGo Client for Eliza Agents
 */
export class AlliGoClient {
  private apiKey: string;
  private baseUrl: string;
  private minScore: number;
  private blockGrades: string[];
  private timeout: number;

  constructor(config: AlliGoConfig) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || DEFAULT_BASE_URL;
    this.minScore = config.minScore ?? DEFAULT_MIN_SCORE;
    this.blockGrades = config.blockGrades ?? DEFAULT_BLOCK_GRADES;
    this.timeout = config.timeout ?? DEFAULT_TIMEOUT;

    if (!this.apiKey) {
      throw new Error("AlliGo API key is required");
    }
  }

  /**
   * Get risk score for an agent
   */
  async getAgentScore(agentId: string): Promise<AgentScore | null> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}/score`;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        if (response.status === 404) {
          return null; // Agent not found
        }
        throw new Error(`AlliGo API error: ${response.status}`);
      }

      const data = await response.json() as AgentScore & { success: boolean };
      return data.success ? data : null;
    } catch (error) {
      console.error("AlliGo API error:", error);
      return null;
    }
  }

  /**
   * Get claims for an agent
   */
  async getAgentClaims(agentId: string): Promise<Claim[]> {
    const url = `${this.baseUrl}/api/agents/${encodeURIComponent(agentId)}/claims`;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return [];
      }

      const data = await response.json() as { claims?: Claim[] };
      return data.claims || [];
    } catch (error) {
      console.error("AlliGo API error:", error);
      return [];
    }
  }

  /**
   * Check if an agent is trusted
   */
  async checkAgentRisk(agentId: string): Promise<RiskCheckResult> {
    const score = await this.getAgentScore(agentId);

    // Agent not in database - unknown risk
    if (!score) {
      return {
        allowed: false,
        score: null,
        reason: "Agent not found in AlliGo database. Unknown risk profile.",
        recommendation: "Request agent registration or proceed with caution.",
      };
    }

    // Check grade
    if (this.blockGrades.includes(score.grade)) {
      return {
        allowed: false,
        score,
        reason: `Agent has grade ${score.grade} which is blocked.`,
        recommendation: "Do not transact with this agent. High risk of failure.",
      };
    }

    // Check minimum score
    if (score.riskScore < this.minScore) {
      return {
        allowed: false,
        score,
        reason: `Agent risk score ${score.riskScore} is below minimum ${this.minScore}.`,
        recommendation: "Consider additional safeguards or decline transaction.",
      };
    }

    // Check open claims
    if (score.openClaims > 0) {
      return {
        allowed: true,
        score,
        reason: `Agent has ${score.openClaims} open unresolved claims.`,
        recommendation: "Proceed with caution. Consider waiting for claim resolution.",
      };
    }

    // All checks passed
    return {
      allowed: true,
      score,
      reason: score.summary,
      recommendation: "Agent has acceptable risk profile.",
    };
  }

  /**
   * Submit a claim (for when your agent fails)
   */
  async submitClaim(claim: {
    agentId: string;
    agentName?: string;
    claimType: string;
    category: string;
    amountLost: number;
    title: string;
    description: string;
    chain?: string;
    txHash?: string;
    platform?: string;
  }): Promise<{ success: boolean; claimId?: string; error?: string }> {
    const url = `${this.baseUrl}/api/claims`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(claim),
      });

      const data = await response.json() as { success: boolean; claimId?: string; error?: string };
      return data;
    } catch (error) {
      return {
        success: false,
        error: String(error),
      };
    }
  }
}

/**
 * Eliza Plugin Integration
 * 
 * Usage in your Eliza agent:
 * 
 * ```typescript
 * import { alligoPlugin } from '@alligo/eliza-plugin';
 * 
 * export default {
 *   name: 'my-agent',
 *   plugins: [
 *     alligoPlugin({
 *       apiKey: process.env.ALLIGO_API_KEY,
 *       minScore: 50,
 *     }),
 *   ],
 * };
 * ```
 */
export function alligoPlugin(config: AlliGoConfig) {
  const client = new AlliGoClient(config);

  return {
    name: "alligo-risk-check",
    
    description: "Check agent risk scores before transactions",
    
    actions: [
      {
        name: "CHECK_AGENT_RISK",
        description: "Check if an agent is trusted based on AlliGo risk score",
        
        validate: async (runtime: any, message: any) => {
          // Always available
          return true;
        },
        
        handler: async (runtime: any, message: any) => {
          const agentId = message.content?.agentId;
          
          if (!agentId) {
            return {
              success: false,
              error: "agentId is required",
            };
          }
          
          return client.checkAgentRisk(agentId);
        },
      },
      
      {
        name: "SUBMIT_CLAIM",
        description: "Submit a claim when an agent fails",
        
        validate: async (runtime: any, message: any) => {
          return message.content?.amountLost > 0;
        },
        
        handler: async (runtime: any, message: any) => {
          return client.submitClaim(message.content);
        },
      },
    ],
    
    providers: [
      {
        name: "ALLIGO_CONTEXT",
        description: "Provides AlliGo risk context for transactions",
        
        get: async (runtime: any, message: any) => {
          const agentId = message.content?.counterparty;
          
          if (!agentId) {
            return "";
          }
          
          const result = await client.checkAgentRisk(agentId);
          
          if (!result.allowed) {
            return `⚠️ RISK ALERT: ${result.reason}\nRecommendation: ${result.recommendation}`;
          }
          
          if (result.score) {
            return `📊 AlliGo Score: ${result.score.riskScore}/100 (${result.score.grade})\n${result.reason}`;
          }
          
          return "";
        },
      },
    ],
  };
}

// Default export
export default AlliGoClient;
