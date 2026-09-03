// AI Agent — renew.prd 26장
//
// 화면과 다음 단계는 여기서 가져다 씁니다.
//   STEP 17  영업 툴 6종 (lib/agent/tools-sales.ts) · 정보 접근 범위 (lib/agent/redact.ts)
//   STEP 18  simulateScenario 를 replaceTool 로 갈아 끼웁니다

export { readLlmConfig, chatCompletion, DEFAULT_BASE_URL, type LlmConfig } from './llm.ts';
export {
  ANSWER_JSON_SCHEMA,
  ANSWER_SCHEMA_TEXT,
  cannotAnswer,
  parseAgentAnswer,
  type AgentAnswer,
  type AgentEvidence,
} from './schema.ts';
export {
  allTools,
  findTool,
  registerTool,
  replaceTool,
  groupOf,
  toOpenAiTools,
  toolsFor,
  type AgentTool,
  type ToolContext,
  type ToolGroup,
  type ToolResult,
  type ToolRole,
} from './tools.ts';
export { SALES_TOOLS, SALES_TOOL_NAMES, registerSalesTools } from './tools-sales.ts';
export {
  isRedactedKey,
  isSalesDepartment,
  stripForSales,
  stripToolResult,
  type RedactUser,
} from './redact.ts';
export {
  collectToolNumbers,
  extractNumbers,
  offendingMessage,
  verifyAnswer,
  type NumberToken,
  type Verification,
} from './guardrail.ts';
export {
  groupFor,
  runAgent,
  systemPrompt,
  MAX_TOOL_ROUNDS,
  RUN_TIMEOUT_MS,
  type AgentUser,
  type GuardrailTrace,
  type RunAgentResult,
  type ToolTraceEntry,
} from './orchestrator.ts';
export {
  getMessages,
  listConversations,
  newConversationId,
  saveTurn,
  titleOf,
  type ConversationSummary,
  type StoredMessage,
} from './conversation.ts';
