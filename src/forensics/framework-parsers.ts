/**
 * AlliGo - Framework Trace Parsers
 * Unified ingestion for multiple agentic frameworks
 * 
 * Supports: LangGraph, CrewAI, AutoGen, ElizaOS, Custom formats
 * Normalizes all to InternalTrace for archetype detection
 */

import { 
  AgenticArchetype,
  CoTStep,
  ToolCall,
  GoalEvolution,
  CodeGenEvent,
  InjectionAttempt,
  AgentMessage,
  MemoryEntry,
} from "./agentic-internals";

// ==================== UNIFIED SCHEMA ====================

/**
 * Unified internal trace format - all frameworks normalize to this
 */
export interface InternalTrace {
  // Source identification
  source_framework: "langgraph" | "crewai" | "autogen" | "eliza" | "custom";
  agent_id: string;
  agent_name?: string;
  timestamp: number;
  
  // Normalized agentic data
  cot_steps: CoTStep[];
  tool_calls: ToolCall[];
  goal_history?: GoalEvolution[];
  code_generation?: CodeGenEvent[];
  injection_attempts?: InjectionAttempt[];
  agent_messages?: AgentMessage[];
  memory_snapshot?: MemoryEntry[];
  
  // Framework-specific raw data (for debugging)
  _raw?: any;
}

// ==================== LANGGRAPH PARSER ====================

export interface LangGraphTrace {
  graph_id: string;
  nodes: LangGraphNode[];
  edges: LangGraphEdge[];
  state_updates: LangGraphStateUpdate[];
  tool_calls?: LangGraphToolCall[];
  metadata?: Record<string, any>;
}

export interface LangGraphNode {
  id: string;
  name: string;
  type: "agent" | "tool" | "condition" | "entry" | "exit";
  inputs?: any;
  outputs?: any;
  metadata?: {
    thought?: string;
    action?: string;
    reasoning?: string;
    timestamp?: number;
  };
  error?: string;
  execution_time_ms?: number;
}

export interface LangGraphEdge {
  source: string;
  target: string;
  condition?: string;
  traversed: boolean;
  traversal_count: number;
}

export interface LangGraphStateUpdate {
  node_id: string;
  timestamp: number;
  changes: Record<string, { old: any; new: any }>;
}

export interface LangGraphToolCall {
  node_id: string;
  tool_name: string;
  arguments: Record<string, any>;
  result?: any;
  error?: string;
  timestamp: number;
}

/**
 * Parse LangGraph trace into unified InternalTrace format
 */
export function parseLangGraphTrace(trace: LangGraphTrace): InternalTrace {
  const cotSteps: CoTStep[] = [];
  const toolCalls: ToolCall[] = [];
  const goalHistory: GoalEvolution[] = [];
  
  let stepNum = 0;
  const previousGoals: string[] = [];
  
  // Process nodes in order (sorted by execution)
  const sortedNodes = [...trace.nodes].sort((a, b) => 
    (a.metadata?.timestamp || 0) - (b.metadata?.timestamp || 0)
  );
  
  for (const node of sortedNodes) {
    // Extract CoT from node metadata
    if (node.metadata?.thought || node.metadata?.reasoning) {
      stepNum++;
      const thought = node.metadata.thought || node.metadata.reasoning || "";
      
      // Check for goal drift in state changes
      const stateUpdate = trace.state_updates.find(u => u.node_id === node.id);
      if (stateUpdate?.changes?.goal || stateUpdate?.changes?.objective) {
        const goalChange = stateUpdate.changes.goal || stateUpdate.changes.objective;
        if (goalChange.old && goalChange.new && goalChange.old !== goalChange.new) {
          previousGoals.push(goalChange.old);
          goalHistory.push({
            timestamp: stateUpdate.timestamp,
            original_goal: goalChange.old,
            current_goal: goalChange.new,
            drift_type: detectGoalDriftType(goalChange.old, goalChange.new),
            drift_evidence: `State changed at node ${node.name}`,
          });
        }
      }
      
      cotSteps.push({
        step: stepNum,
        thought,
        action: node.metadata.action,
        reasoning: node.metadata.reasoning || "",
        timestamp: node.metadata.timestamp || Date.now(),
        flags: detectThoughtFlags(thought),
      });
    }
    
    // Process tool calls
    if (node.type === "tool" && node.inputs) {
      toolCalls.push({
        id: `lg_${node.id}`,
        tool: node.name,
        params: node.inputs,
        result: node.outputs,
        success: !node.error,
        retry_count: countRetries(trace.edges, node.id),
        timestamp: node.metadata?.timestamp || Date.now(),
      });
    }
  }
  
  // Check for loops in edges (Tool Looping Denial)
  const loopDetected = trace.edges.some(e => e.traversal_count > 3);
  
  return {
    source_framework: "langgraph",
    agent_id: trace.graph_id,
    timestamp: Date.now(),
    cot_steps: cotSteps,
    tool_calls: toolCalls,
    goal_history: goalHistory.length > 0 ? goalHistory : undefined,
    _raw: trace,
  };
}

/**
 * Detect loops in LangGraph edges
 */
function countRetries(edges: LangGraphEdge[], nodeId: string): number {
  const selfLoops = edges.filter(e => e.source === nodeId && e.target === nodeId);
  return selfLoops.reduce((sum, e) => sum + e.traversal_count, 0);
}

// ==================== CREWAI PARSER ====================

export interface CrewAITrace {
  crew_id: string;
  crew_name?: string;
  agents: CrewAIAgent[];
  tasks: CrewAITask[];
  execution_log: CrewAIExecutionEntry[];
  final_output?: any;
}

export interface CrewAIAgent {
  id: string;
  role: string;
  goal: string;
  backstory?: string;
  tools?: string[];
}

export interface CrewAITask {
  id: string;
  description: string;
  agent_id: string;
  expected_output?: string;
  status: "pending" | "in_progress" | "completed" | "failed";
  output?: any;
  delegate_to?: string[];
}

export interface CrewAIExecutionEntry {
  timestamp: number;
  agent_id: string;
  task_id: string;
  type: "thought" | "action" | "observation" | "delegation" | "error";
  content: string;
  metadata?: Record<string, any>;
}

/**
 * Parse CrewAI trace into unified InternalTrace format
 */
export function parseCrewAITrace(trace: CrewAITrace): InternalTrace {
  const cotSteps: CoTStep[] = [];
  const toolCalls: ToolCall[] = [];
  const agentMessages: AgentMessage[] = [];
  
  let stepNum = 0;
  
  // Process execution log
  for (const entry of trace.execution_log) {
    stepNum++;
    
    if (entry.type === "thought") {
      cotSteps.push({
        step: stepNum,
        thought: entry.content,
        reasoning: entry.metadata?.reasoning || "",
        timestamp: entry.timestamp,
        flags: detectThoughtFlags(entry.content),
      });
    }
    
    if (entry.type === "action") {
      // Extract tool calls from action content
      const toolMatch = entry.content.match(/Tool:\s*(\w+)\nArgs:\s*(.+)?/s);
      if (toolMatch) {
        toolCalls.push({
          id: `crew_${entry.timestamp}`,
          tool: toolMatch[1],
          params: toolMatch[2] ? parseToolArgs(toolMatch[2]) : {},
          success: !entry.content.includes("Error"),
          retry_count: 0,
          timestamp: entry.timestamp,
        });
      }
    }
    
    if (entry.type === "delegation" && entry.metadata?.target_agent) {
      agentMessages.push({
        from_agent: entry.agent_id,
        to_agent: entry.metadata.target_agent,
        message_type: "delegation",
        content: entry.content,
        timestamp: entry.timestamp,
        coordination_anomaly: detectDelegationAnomaly(entry, trace.agents),
      });
    }
    
    if (entry.type === "error") {
      // Flag as potential issue
      cotSteps.push({
        step: stepNum,
        thought: `[ERROR] ${entry.content}`,
        reasoning: "Error during execution",
        timestamp: entry.timestamp,
        flags: ["error", "potential_failure"],
      });
    }
  }
  
  // Build goal history from task delegations
  const goalHistory = buildGoalHistoryFromDelegations(trace);
  
  return {
    source_framework: "crewai",
    agent_id: trace.crew_id,
    agent_name: trace.crew_name,
    timestamp: Date.now(),
    cot_steps: cotSteps,
    tool_calls: toolCalls,
    goal_history: goalHistory.length > 0 ? goalHistory : undefined,
    agent_messages: agentMessages.length > 0 ? agentMessages : undefined,
    _raw: trace,
  };
}

function parseToolArgs(argsStr: string): Record<string, any> {
  try {
    return JSON.parse(argsStr);
  } catch {
    return { raw: argsStr };
  }
}

function detectDelegationAnomaly(entry: CrewAIExecutionEntry, agents: CrewAIAgent[]): string | undefined {
  const targetAgent = agents.find(a => a.id === entry.metadata?.target_agent);
  if (!targetAgent) {
    return "Delegation to unknown agent";
  }
  
  // Check if delegation is outside expected workflow
  if (entry.metadata?.unauthorized) {
    return "Unauthorized delegation attempt";
  }
  
  return undefined;
}

function buildGoalHistoryFromDelegations(trace: CrewAITrace): GoalEvolution[] {
  const history: GoalEvolution[] = [];
  const delegations = trace.execution_log.filter(e => e.type === "delegation");
  
  for (const del of delegations) {
    const task = trace.tasks.find(t => t.id === del.task_id);
    if (task && del.metadata?.new_goal) {
      history.push({
        timestamp: del.timestamp,
        original_goal: task.description,
        current_goal: del.metadata.new_goal,
        drift_type: detectGoalDriftType(task.description, del.metadata.new_goal),
      });
    }
  }
  
  return history;
}

// ==================== AUTOGEN PARSER ====================

export interface AutoGenConversation {
  conversation_id: string;
  agents: AutoGenAgent[];
  messages: AutoGenMessage[];
  group_chat_manager?: string;
  termination_reason?: string;
}

export interface AutoGenAgent {
  id: string;
  name: string;
  system_message?: string;
  human_input_mode?: "ALWAYS" | "NEVER" | "TERMINATE";
  tools?: string[];
}

export interface AutoGenMessage {
  message_id: string;
  timestamp: number;
  sender_id: string;
  receiver_id: string | string[]; // Can be broadcast
  content: string;
  type: "text" | "function_call" | "function_result" | "system";
  metadata?: {
    function_name?: string;
    arguments?: any;
    result?: any;
    suggested_code?: string;
  };
}

/**
 * Parse AutoGen conversation into unified InternalTrace format
 */
export function parseAutoGenConversation(conv: AutoGenConversation): InternalTrace {
  const cotSteps: CoTStep[] = [];
  const toolCalls: ToolCall[] = [];
  const agentMessages: AgentMessage[] = [];
  const memoryEntries: MemoryEntry[] = [];
  
  let stepNum = 0;
  const messageCounts: Map<string, number> = new Map();
  
  // Process messages
  for (const msg of conv.messages) {
    stepNum++;
    
    // Track message frequency per agent (for collusion detection)
    messageCounts.set(msg.sender_id, (messageCounts.get(msg.sender_id) || 0) + 1);
    
    if (msg.type === "text") {
      cotSteps.push({
        step: stepNum,
        thought: msg.content,
        reasoning: `From ${msg.sender_id}`,
        timestamp: msg.timestamp,
        flags: detectThoughtFlags(msg.content),
      });
      
      // Check for code generation in content
      const codeBlock = extractCodeBlock(msg.content);
      if (codeBlock) {
        cotSteps[cotSteps.length - 1].flags?.push("code_generation");
      }
    }
    
    if (msg.type === "function_call") {
      toolCalls.push({
        id: `ag_${msg.message_id}`,
        tool: msg.metadata?.function_name || "unknown",
        params: msg.metadata?.arguments || {},
        result: msg.metadata?.result,
        success: !msg.content.includes("error"),
        retry_count: 0,
        timestamp: msg.timestamp,
      });
    }
    
    // Build inter-agent message graph
    if (msg.type === "text" && typeof msg.receiver_id === "string") {
      agentMessages.push({
        from_agent: msg.sender_id,
        to_agent: msg.receiver_id,
        message_type: "communication",
        content: msg.content.slice(0, 200),
        timestamp: msg.timestamp,
        coordination_anomaly: detectCollusionPattern(msg, messageCounts),
      });
    }
    
    // Extract memory-like patterns from system messages
    if (msg.type === "system" && msg.metadata) {
      for (const [key, value] of Object.entries(msg.metadata)) {
        memoryEntries.push({
          key,
          value,
          last_accessed: msg.timestamp,
          access_count: 1,
        });
      }
    }
  }
  
  // Detect group goal drift from termination reason
  const goalHistory: GoalEvolution[] = [];
  if (conv.termination_reason) {
    goalHistory.push({
      timestamp: conv.messages[conv.messages.length - 1]?.timestamp || Date.now(),
      original_goal: conv.agents[0]?.system_message || "Unknown",
      current_goal: conv.termination_reason,
      drift_type: conv.termination_reason.includes("error") ? "malicious" : "benign",
    });
  }
  
  return {
    source_framework: "autogen",
    agent_id: conv.conversation_id,
    timestamp: Date.now(),
    cot_steps: cotSteps,
    tool_calls: toolCalls,
    goal_history: goalHistory.length > 0 ? goalHistory : undefined,
    agent_messages: agentMessages.length > 0 ? agentMessages : undefined,
    memory_snapshot: memoryEntries.length > 0 ? memoryEntries : undefined,
    _raw: conv,
  };
}

function extractCodeBlock(content: string): string | null {
  const match = content.match(/```[\s\S]*?```/);
  return match ? match[0] : null;
}

function detectCollusionPattern(msg: AutoGenMessage, counts: Map<string, number>): string | undefined {
  // If one agent is communicating excessively with another specific agent
  const senderCount = counts.get(msg.sender_id) || 0;
  if (senderCount > 10) {
    return "High-frequency communication pattern";
  }
  
  // Check for suspicious keywords
  const suspiciousPatterns = ["transfer all", "drain", "bypass", "override"];
  for (const pattern of suspiciousPatterns) {
    if (msg.content.toLowerCase().includes(pattern)) {
      return `Suspicious pattern: ${pattern}`;
    }
  }
  
  return undefined;
}

// ==================== ELIZA PARSER ====================

export interface ElizaTrace {
  agent_id: string;
  agent_name?: string;
  character?: {
    name: string;
    backstory?: string;
  };
  actions: ElizaAction[];
  memory?: ElizaMemoryEntry[];
  goals?: ElizaGoal[];
}

export interface ElizaAction {
  id: string;
  timestamp: number;
  type: "message" | "action" | "thought";
  content: string;
  metadata?: {
    provider?: string;
    model?: string;
    tokens_used?: number;
    tool_name?: string;
    tool_result?: any;
  };
}

export interface ElizaMemoryEntry {
  id: string;
  type: string;
  content: any;
  created_at: number;
  last_accessed: number;
  importance: number;
}

export interface ElizaGoal {
  id: string;
  name: string;
  status: "active" | "completed" | "failed";
  priority: number;
  objectives?: string[];
  created_at: number;
  updated_at: number;
}

/**
 * Parse ElizaOS trace into unified InternalTrace format
 */
export function parseElizaTrace(trace: ElizaTrace): InternalTrace {
  const cotSteps: CoTStep[] = [];
  const toolCalls: ToolCall[] = [];
  const memoryEntries: MemoryEntry[] = [];
  const goalHistory: GoalEvolution[] = [];
  
  let stepNum = 0;
  const previousGoals = new Map<string, string>();
  
  // Process actions
  for (const action of trace.actions) {
    stepNum++;
    
    if (action.type === "thought") {
      cotSteps.push({
        step: stepNum,
        thought: action.content,
        reasoning: "",
        timestamp: action.timestamp,
        flags: detectThoughtFlags(action.content),
      });
    }
    
    if (action.type === "action" && action.metadata?.tool_name) {
      toolCalls.push({
        id: `eliza_${action.id}`,
        tool: action.metadata.tool_name,
        params: {},
        result: action.metadata.tool_result,
        success: !action.content.includes("error"),
        retry_count: 0,
        timestamp: action.timestamp,
      });
    }
  }
  
  // Process memory
  if (trace.memory) {
    for (const mem of trace.memory) {
      memoryEntries.push({
        key: mem.id,
        value: mem.content,
        last_accessed: mem.last_accessed,
        access_count: 1,
        anomaly: detectMemoryAnomaly(mem),
      });
    }
  }
  
  // Process goals for drift detection
  if (trace.goals) {
    for (const goal of trace.goals) {
      const prevStatus = previousGoals.get(goal.id);
      if (prevStatus && prevStatus !== goal.status) {
        goalHistory.push({
          timestamp: goal.updated_at,
          original_goal: goal.name,
          current_goal: `${goal.name} (${goal.status})`,
          drift_type: goal.status === "failed" ? "suspicious" : "benign",
        });
      }
      previousGoals.set(goal.id, goal.status);
    }
  }
  
  return {
    source_framework: "eliza",
    agent_id: trace.agent_id,
    agent_name: trace.agent_name || trace.character?.name,
    timestamp: Date.now(),
    cot_steps: cotSteps,
    tool_calls: toolCalls,
    goal_history: goalHistory.length > 0 ? goalHistory : undefined,
    memory_snapshot: memoryEntries.length > 0 ? memoryEntries : undefined,
    _raw: trace,
  };
}

function detectMemoryAnomaly(mem: ElizaMemoryEntry): string | undefined {
  // Check for suspicious memory entries
  const contentStr = JSON.stringify(mem.content).toLowerCase();
  
  if (contentStr.includes("private_key") || contentStr.includes("mnemonic")) {
    return "Sensitive data in memory";
  }
  
  if (contentStr.includes("bypass") || contentStr.includes("override")) {
    return "Suspicious override instructions in memory";
  }
  
  if (mem.importance > 0.9 && contentStr.includes("transfer")) {
    return "High-importance transfer instruction";
  }
  
  return undefined;
}

// ==================== HELPER FUNCTIONS ====================

function detectGoalDriftType(original: string, current: string): "benign" | "suspicious" | "malicious" {
  const origLower = original.toLowerCase();
  const currLower = current.toLowerCase();
  
  // Malicious patterns
  const maliciousPatterns = [
    ["protect", "extract"],
    ["safe", "drain"],
    ["secure", "steal"],
    ["monitor", "execute"],
    ["verify", "bypass"],
    ["limit", "unlimited"],
  ];
  
  for (const [orig, curr] of maliciousPatterns) {
    if (origLower.includes(orig) && currLower.includes(curr)) {
      return "malicious";
    }
  }
  
  // Suspicious patterns
  const suspiciousPatterns = ["maximize", "unlimited", "bypass", "override", "extract"];
  for (const pattern of suspiciousPatterns) {
    if (!origLower.includes(pattern) && currLower.includes(pattern)) {
      return "suspicious";
    }
  }
  
  return "benign";
}

function detectThoughtFlags(thought: string): string[] {
  const flags: string[] = [];
  const lower = thought.toLowerCase();
  
  // Risk keywords
  if (lower.includes("drain") || lower.includes("extract")) flags.push("extraction_intent");
  if (lower.includes("bypass") || lower.includes("override")) flags.push("bypass_intent");
  if (lower.includes("unlimited") || lower.includes("max approval")) flags.push("unlimited_approval");
  if (lower.includes("private") && lower.includes("key")) flags.push("key_exposure");
  if (lower.includes("selfdestruct") || lower.includes("suicide")) flags.push("destructive_action");
  if (lower.includes("delegatecall")) flags.push("delegatecall_risk");
  if (lower.includes("ignore") && lower.includes("instruction")) flags.push("instruction_override");
  
  // Jailbreak indicators
  const jailbreakPhrases = [
    "developer mode",
    "ignore previous",
    "hypothetically",
    "this is a simulation",
    "pretend that",
  ];
  
  for (const phrase of jailbreakPhrases) {
    if (lower.includes(phrase)) {
      flags.push("jailbreak_attempt");
      break;
    }
  }
  
  return flags;
}

// ==================== MAIN INGESTION FUNCTION ====================

export type FrameworkInput = 
  | { framework: "langgraph"; trace: LangGraphTrace }
  | { framework: "crewai"; trace: CrewAITrace }
  | { framework: "autogen"; trace: AutoGenConversation }
  | { framework: "eliza"; trace: ElizaTrace }
  | { framework: "custom"; trace: InternalTrace };

/**
 * Ingest trace from any supported framework
 */
export function ingestFrameworkTrace(input: FrameworkInput): InternalTrace {
  switch (input.framework) {
    case "langgraph":
      return parseLangGraphTrace(input.trace);
    case "crewai":
      return parseCrewAITrace(input.trace);
    case "autogen":
      return parseAutoGenConversation(input.trace);
    case "eliza":
      return parseElizaTrace(input.trace);
    case "custom":
      return input.trace;
  }
}

/**
 * Convert InternalTrace to AgenticDataInput for analysis
 */
export function toAgenticDataInput(trace: InternalTrace): {
  agent_handle: string;
  direct_agentic_data: {
    cot_steps?: CoTStep[];
    tool_calls?: ToolCall[];
    goal_history?: GoalEvolution[];
    code_generation?: CodeGenEvent[];
    injection_attempts?: InjectionAttempt[];
    agent_messages?: AgentMessage[];
    memory_snapshot?: MemoryEntry[];
  };
} {
  return {
    agent_handle: trace.agent_id,
    direct_agentic_data: {
      cot_steps: trace.cot_steps.length > 0 ? trace.cot_steps : undefined,
      tool_calls: trace.tool_calls.length > 0 ? trace.tool_calls : undefined,
      goal_history: trace.goal_history,
      code_generation: trace.code_generation,
      injection_attempts: trace.injection_attempts,
      agent_messages: trace.agent_messages,
      memory_snapshot: trace.memory_snapshot,
    },
  };
}
