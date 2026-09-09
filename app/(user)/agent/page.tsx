// STEP 16 AI Agent 화면 — 6회차 슬라이드 63
//
// LLM 은 부가 계층입니다. 환경변수가 없으면 이 화면만 안내를 보이고 나머지 화면은
// 그대로 동작합니다 (슬라이드 48 · 67).

import AnalysisFrame from '@/components/analysis/analysis-frame';
import { readLlmConfig } from '@/lib/agent/llm';
import { requireUser } from '@/lib/auth';
import ChatForm from './chat-form';

export const dynamic = 'force-dynamic';

export default async function AgentPage() {
  await requireUser();
  const config = readLlmConfig();

  return (
    <AnalysisFrame
      title="AI 비서"
      description="검증된 조회 함수(Tool)만 사용해 답합니다. 답변의 모든 수치는 툴이 돌려준 값과 대조합니다."
    >
      <ChatForm configured={config.configured} missing={config.missing} />
    </AnalysisFrame>
  );
}
