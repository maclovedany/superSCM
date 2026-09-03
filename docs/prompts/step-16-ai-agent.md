# STEP 16 구현 지시서 — AI Agent (Tool Calling · Guardrail)

> 먼저 `docs/prompts/_공통규칙.md`. STEP 9~14 의 lib 함수(`lib/inventory.ts` · `lib/recommendation.ts` · `lib/backtest.ts` · `lib/forecast.ts` · `lib/alerts.ts` · `lib/scm.ts`)를 **그대로** 툴로 감쌉니다. 각 보고서의 인터페이스 절을 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 16** 입니다. renew.prd 26장.

```
User → LLM Intent → Tool Calling → Backend Function → Structured Result → LLM Explanation
```

**LLM 은 숫자를 계산하지 않습니다.** 툴은 **화면이 쓰는 것과 동일한 lib 함수**를 호출합니다 (PRD 32: 두 경로에서 다른 숫자가 나오면 신뢰가 무너진다). LLM 이 죽어도 나머지 화면은 그대로 돕니다 (PRD 31.4).

읽을 PRD 장: **26(AI Agent 전체) · 32(설계 원칙) · 31.4 · 4.5(정보 접근 범위)**.

## 확정된 설계 (대화에서 결정됨 — 바꾸지 마세요)

- **OpenAI 호환 API 를 fetch 로 직접 호출**합니다. SDK 를 설치하지 않습니다. 이유: 2단계(고객사 사내 vLLM/Ollama)에서 base URL 만 바꿔 같은 코드를 쓰기 위해서입니다.
- 환경변수: `OPENAI_BASE_URL`(기본 `https://api.openai.com/v1`) · `OPENAI_API_KEY` · `OPENAI_MODEL`. 셋 중 하나라도 없으면 `configured: false` — 화면은 "AI 가 설정되지 않았습니다" 를 보이고 나머지는 정상.
- 엔드포인트: `POST {base}/chat/completions` · `tools` (function calling) · `tool_choice: 'auto'` · 최종 답변은 `response_format: { type: 'json_schema', json_schema: … , strict: true }` 로 Structured Outputs. 일부 호환 서버는 `json_schema` 를 지원하지 않으므로 400 이면 `{ type: 'json_object' }` + 프롬프트 안의 스키마 설명으로 1회 재시도.
- 툴 루프 최대 6회. 타임아웃 60초 (`AbortController`).

## 만들 것

### 1. `lib/agent/` (신규 폴더)

```
lib/agent/llm.ts          fetch 래퍼. chatCompletion({ messages, tools?, responseFormat? }) → { message, toolCalls, usage } · configured 판정 · 오류를 throw 하지 않고 { error } 로
lib/agent/schema.ts       최종 응답 JSON 스키마 (renew.prd 26.4):
                            { answer: string, verdict: string|null, evidence: [{ label, value: number|string|null, unit?, source_tool, reason? }],
                              data_as_of: string|null, risk: 'SAFE'|'WARNING'|'CRITICAL'|'CALCULATION_UNAVAILABLE'|null,
                              recommended_action: string|null, cannot_answer: boolean, cannot_answer_reason: string|null }
lib/agent/tools.ts        툴 레지스트리 ★ — 10종 (renew.prd 26.2 SCM 담당자용). 각 툴 = { name, description(한국어), parameters(JSON Schema), roles: ('ADMIN'|'USER')[], run(args, ctx) → Promise<ToolResult> }
                            getDemandForecast(itemId, period?)     lib/forecast.getForecastDetail + lib/override.getConsensus
                            getForecastAccuracy(itemId)            lib/backtest.getItemPerformance + getChampions
                            getInventoryProjection(itemId)         lib/inventory.getInventoryProjection
                            getStockoutRisk(itemId?)               lib/scm.getStockoutRisks (itemId 없으면 위험·주의만 상위 20)
                            getLeadtimeStats(supplierId?)          lib/inventory.getLeadtimePolicies
                            getSafetyStock(itemId)                 lib/recommendation.getSafetyStocks (필터)
                            calcOrderQuantity(itemId)              lib/recommendation.getSkuDetail (뷰가 이미 계산한 값)
                            getOpenPO(itemId?)                     lib/dashboard.getOpenPoRisk 또는 lib/inventory 의 입고예정 (있는 함수 재사용. 없으면 lib/inventory 에 getOpenPo(itemId?) 를 추가 — analytics 뷰 필요하면 sql/22 가 아니라 이 단계 SQL 없이 기존 v_inventory_projection 의 receipt 를 씁니다)
                            getAlerts(filter?)                     lib/alerts.getAlerts
                            simulateScenario(params)               STEP 18 이 채웁니다. 여기서는 등록만 하고 run 은 { error: 'STEP 18 에서 제공' } — 툴 목록에서는 숨깁니다 (enabled: false)
                          ToolResult = { ok: boolean, data: unknown, numbers: Record<string, number|null>, dataAsOf: string|null, reason?: string }
                            ★ numbers 는 "이 툴이 돌려준 모든 수치" 의 평평한 사전 — Guardrail 이 여기서만 수치를 허용합니다
lib/agent/guardrail.ts    renew.prd 26.3 후처리 검증 — 순수 함수 (테스트 대상)
                            extractNumbers(text): 답변 문장 속 숫자(천단위 쉼표 · 소수 · % · 일/개/원 단위 허용)를 뽑음
                            verifyAnswer(answer, toolNumbers): 답변의 각 숫자가 툴 numbers 값(허용 오차: 반올림 1자리 · 백분율 변환 ×100) 중 하나와 일치하는지.
                              불일치 숫자가 있으면 { ok:false, offending:[…] } → 오케스트레이터가 1회 재생성 요청("다음 숫자는 툴 결과에 없습니다: … 툴 값만 쓰세요") 후에도 실패하면 답변을 버리고 "산출할 수 없음" 응답
                            연도·기간·품목코드 안의 숫자(ITEM012 · 2026-09)는 제외
lib/agent/orchestrator.ts runAgent({ question, user, history }) → { answer(JSON), toolTrace: [{ name, args, ok, ms }], error }
                            시스템 프롬프트(한국어): 역할 · "숫자를 계산하지 말 것 · 툴 값만 인용 · 데이터 기준시각 명시 · 데이터가 없으면 추측하지 말고 cannot_answer" · renew.prd 26.4 답변 구성(판단 · 근거 · 기준시각 · Risk · 권고)
                            role 별 툴 집합: tools.ts 의 roles 로 필터 — 서버에서 (PRD 26.2 "Role 에 따라 호출 가능한 Tool 집합")
                            툴 호출마다 로그 core.agent_log 에 남깁니다 (아래 SQL)
lib/agent/index.ts        export
```

### 2. `sql/22-agent.sql`

> SQL 번호표(확정): 15 재고전개 · 16 안전재고/발주 · 17 가상운영 · 18 Override · 19 승인 · 20 Alert · 21 Dashboard · **22 Agent** · 23 ATP/영업 · 24 What-If · 25 Python 모델 · 26 API · 27 운영

```
core.agent_conversation   conversation_id text PK · user_id · user_email · started_at · last_at · title
core.agent_message        id bigserial · conversation_id · role('user'|'assistant'|'tool') · content text · answer jsonb · tool_trace jsonb · usage jsonb · guardrail jsonb · created_at
analytics.v_agent_usage   일별 호출 수 · 평균 툴 수 · guardrail 실패 수 (관리자 로그용)
RLS: 본인 대화만 select/insert, 관리자 전부 select
```

### 3. 화면 `app/(user)/agent/page.tsx` — `Planned` 교체 (+ `chat-form.tsx` · `actions.ts` · `state.ts`)

- 서버 컴포넌트가 최근 대화(`?c=`)를 읽어 메시지 목록을 그리고, 하단에 클라이언트 폼(질문 입력 · 전송). 액션 `ask(prev, formData)`: `requireUser()` → `runAgent` → 메시지 저장 → revalidate. 스트리밍 없음(단순).
- 답변 렌더링: `answer` 본문 + 근거 타일(`.rail-tiles` 재사용: label · value · source_tool) + Risk 배지 + 권고 + "데이터 기준 {data_as_of}" + 접힌 툴 호출 목록(`<details>`: 이름 · 소요 ms)
- `cannot_answer` 이면 `EmptyValue` 톤의 회색 카드로 사유
- 예시 질문 칩 6개 (renew.prd 26.5) — 누르면 입력창에 채움 (클라이언트)
- AI 미설정이면 화면 상단 InsightBanner 로 안내 + 폼 비활성
- 대화 목록 사이드 패널(최근 10)

### 4. 우측 레일 연결

- `components/ui/ai-rail.tsx` (신규, 서버 컴포넌트): props `itemId` — SKU Detail 과 재고전개 화면 오른쪽에 두는 레일 (design.md §6.11). LLM 을 호출하지 않고 **정적**: 뷰가 준 explanation 과 근거 타일 + [이 품목에 대해 묻기] 링크 → `/agent?q=…`. (LLM 을 페이지 렌더에 넣으면 31.4 위반.) STEP 10 의 SKU Detail 페이지에 `grid-rail` 로 붙입니다 (레이아웃 변경 최소).
- `components/shell/topbar.tsx` 의 "AI Agent" 칩을 `/agent` 링크로 활성화 (disabled 제거).

### 5. 테스트 (핵심)

- `lib/agent/guardrail.test.ts`: 숫자 추출 · 일치 판정 · 품목코드/날짜 제외 · 백분율 변환 · 불일치 검출. 10건 이상.
- `lib/agent/tools.test.ts`: 툴 10종의 name 유일 · parameters 가 JSON Schema object · roles 비어있지 않음 · USER 집합 ⊂ ADMIN 집합.
- `lib/agent/llm.test.ts`: 환경변수 없을 때 configured=false · 응답 파싱(모의 JSON) — fetch 를 주입 가능하게 만들어 실제 네트워크 없이.

### 6. 환경

`.env.local.example` 에 `OPENAI_BASE_URL=https://api.openai.com/v1` · `OPENAI_API_KEY=` · `OPENAI_MODEL=` 추가. README 성격의 주석: 2단계에서는 base URL 을 사내 vLLM 으로.

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] 툴 10종이 lib 함수만 호출한다 (supabase 직접 호출 0건 — `grep -n "createSupabaseServerClient" lib/agent/` 는 대화 저장용 1곳만)
- [ ] Guardrail 테스트가 불일치 숫자를 잡는다
- [ ] 환경변수 없이 build · 화면 정상
- [ ] Role 별 툴 필터가 서버(orchestrator)에서 적용된다

## 인터페이스 (다음 단계)

- `lib/agent/tools.ts` 의 `registerTool()` 또는 배열 export — STEP 17 이 영업 툴 6종을, STEP 18 이 simulateScenario 를 추가합니다.
- `runAgent` 시그니처.

## 보고서

`.superpowers/sdd/step/task-16-report.md`. 메뉴 `/agent` ready.
