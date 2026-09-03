# STEP 19 구현 지시서 — External API (Inbound · Outbound) + API Key

> 먼저 `docs/prompts/_공통규칙.md`. STEP 4 의 `lib/import/*`(검증 파이프라인)를 **수정 없이 재사용**합니다. 조회 API 는 STEP 9~14 의 analytics 뷰를 lib 함수로 읽습니다.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 19** 입니다. renew.prd 9장. 외부 시스템(ERP 등)이 데이터를 넣고(Inbound 11) 결과를 가져갑니다(Outbound 7). API Key 는 해시로만 저장하고 원문은 생성 시 1회만 보여줍니다.

읽을 PRD 장: **9(External API 전체) · 8.3(Validation) · 31.1(보안)**.

## 만들 것

### 1. `sql/26-api.sql`

> SQL 번호표(확정): 22 Agent · 23 ATP/영업 · 24 What-If · 25 Python 모델 · **26 API** · 27 운영. 머리말: "sql/25 까지 먼저 실행".

```
core.api_key
  key_id text PK ('key_' + 12자) · integration_name text not null · key_hash text not null unique(sha256 hex) · key_prefix text(앞 8자, 화면 식별용) ·
  scope text[] not null · active boolean default true · created_by · created_at · expires_at · last_used_at · revoked_at
  scope 6종: demand:write · inventory:write · purchase_order:write · forecast:read · recommendation:read · alert:read

core.api_log
  id bigserial · key_id · method · path · status int · duration_ms int · received int · accepted int · rejected int · batch_id · ip text · at timestamptz default now()

core.api_key_authenticate(p_hash text)     security definer · anon 실행 허용 (Route Handler 는 세션 없음)
  returns table (key_id text, integration_name text, scope text[], ok boolean, message text)
  · active 이고 revoked_at null 이고 (expires_at null or > now()) → ok. last_used_at 갱신
core.api_key_create(p_integration_name, p_scope text[], p_expires_at, p_hash, p_prefix)   관리자 · 원문은 앱이 만들고 해시만 넘김
core.api_key_revoke(p_key_id)              관리자
core.api_log_write(p jsonb)                anon 실행 허용 · insert only
core.api_import_commit(p_batch_id text, p_key_id text)   security definer · anon 실행 허용 ·
  → core.import_commit 은 is_admin() 을 검사하므로 API 가 못 부릅니다. 이 래퍼가 (batch 의 uploader_email 이 'api:'||p_key_id 인지 확인 후) import_commit 의 본문을 재사용하도록
    import_commit 을 `core.import_commit_internal(p_batch_id)` (권한 검사 없음, 호출자 검사 없음, revoke from all) 로 분리하고
    기존 `core.import_commit` 은 is_admin 검사 후 internal 을 부르게 바꿉니다 (sql/09 수정 대신 이 파일에서 `create or replace` 로 덮어씁니다. sql/09 머리에 주석 한 줄 "최종 정의는 sql/26-api.sql")
  · 그리고 api 용 staging insert 도 RLS 를 통과해야 합니다: `core.api_stage_batch(p jsonb)` security definer 로 upload_batch · import_staging · validation_error 를 대신 insert

analytics.v_api_key    (key_hash 제외) · analytics.v_api_log (최근 1000) · analytics.v_api_kpi
```

권한: api_key/api_log 테이블 자체는 authenticated 관리자만 select. 함수는 위에 적은 대로 `grant execute to anon, authenticated` (authenticate · log_write · stage_batch · import_commit) — **anon 이 부를 수 있는 함수는 인자로 받은 해시/키를 검사하는 것 외에 아무 것도 노출하지 않는지** 주석으로 확인.

### 2. `lib/api/` (신규)

```
lib/api/auth.ts        Bearer 토큰 → sha256 → rpc api_key_authenticate → { key, scope } | 401. requireScope(key, 'demand:write')
lib/api/keys.ts        createApiKey(name, scope, expiresAt) → { plaintext(1회), keyId } — 원문 = 'sk_scm_' + 32 bytes base64url (crypto.randomBytes) · 해시 sha256 · revokeApiKey · listApiKeys · getApiLogs · getApiKpi
lib/api/inbound.ts     ★ 파일 업로드와 같은 파이프라인: 요청 body { mode, strict, data[] } →
                         rows = data (이미 컬럼명이 논리 필드명이므로 mapping 은 항등 + TABLE_SPECS 의 aliases 로 보정) →
                         loadValidationContext(dataType) → validate(...) → strict 이고 오류 있으면 전량 거부(적재 없음) →
                         api_stage_batch(source_type='API', uploader_email='api:'+keyId, filename=null) → api_import_commit →
                         응답 { batch_id, received, accepted, rejected, errors:[{ index, field, message }] }  (renew.prd 9.1 형식 그대로)
                         멱등성: 같은 요청 반복 시 upsert 모드는 키로 중복 없음. append 모드는 (dataType, keyFields) 로 이미 있는 행을 validate 의 DUPLICATE 와 별개로 "이미 적재됨" 으로 거부 —
                           이를 위해 loadValidationContext 에 기존 키 집합을 넣을 수 없으므로(수만 행), `Idempotency-Key` 헤더를 받아 core.api_log 에 (key_id, idempotency_key) 가 있으면 이전 응답을 그대로 돌려줍니다 (api_log 에 idempotency_key · response jsonb 컬럼 추가)
lib/api/outbound.ts    각 GET 의 데이터 조립 — lib/forecast · inventory · scm · recommendation · alerts 의 기존 함수를 부릅니다. 페이징 limit(기본 100 · 최대 1000) · offset
lib/api/ratelimit.ts   키별 분당 60 회 — 메모리 Map (서버리스라 인스턴스별. 주석으로 한계 명시) · 초과 시 429
lib/api/openapi.ts     OpenAPI 3.1 문서 객체 (경로 18개 · 스키마 · 보안) — `/api/v1/openapi.json` 이 돌려줌
```

### 3. Route Handlers `app/api/v1/…` (renew.prd 9.1 · 9.2 그대로)

```
POST items · suppliers · demand-history · inventory · purchase-orders · receipts · open-po · events · sales-order
POST bulk/demand-history · bulk/inventory       (같은 처리 · 본문 크기 상한만 다름 25MB)
  dataType 매핑: items→ITEM_MASTER · suppliers→SUPPLIER_MASTER · demand-history→DEMAND · inventory→INVENTORY ·
                 purchase-orders→PURCHASE_ORDER · receipts→RECEIPT · open-po→RECEIPT(status 로 구분 — TABLE_SPECS 에 없으면 PURCHASE_ORDER 로 두고 보고서에 적음) ·
                 events→EVENT · sales-order→SALES_ORDER
  scope: demand:write(demand-history · events · sales-order) · inventory:write(inventory · items · suppliers) · purchase_order:write(purchase-orders · receipts · open-po)
GET forecast/{itemId} · inventory-projection/{itemId} · stockout-risk/{itemId} · order-recommendation/{itemId} · leadtime/{supplierId} · atp?item_id=&qty=&date= · alerts
  scope: forecast:read(forecast · leadtime) · recommendation:read(inventory-projection · stockout-risk · order-recommendation · atp) · alert:read(alerts)
  atp 는 STEP 17 의 lib/atp.ts 가 있으면 그것을, 없으면 501 { message: 'STEP 17' }
GET openapi.json (인증 없음)
```

모든 핸들러: `lib/api/auth.ts` → scope → ratelimit → 처리 → `api_log_write`. 오류 형식 `{ error: { code, message } }`. `middleware.ts` 의 `PUBLIC_PATHS` 에 `/api/v1` 추가 (세션 리다이렉트 제외 — 인증은 핸들러가 함).

### 4. 관리자 화면

- `app/(admin)/admin/api/keys/page.tsx` — `Planned` 교체: 키 목록(이름 · 접두어 · scope 배지 · 만료 · 마지막 사용 · 상태) + 생성 폼(이름 · scope 체크 6 · 만료일) → 생성 직후 **원문을 한 번만** 보여주는 패널("이 창을 닫으면 다시 볼 수 없습니다") + [폐기] 버튼(danger · confirm). 액션에 audit `API_KEY_CREATE` / `API_KEY_REVOKE` (원문은 절대 로그에 남기지 않음)
- `app/(admin)/admin/api/logs/page.tsx` (신규): 최근 호출 표 + KPI(오늘 호출 · 4xx · 5xx · 적재 행)
- `app/(admin)/admin/api/docs/page.tsx` (신규): openapi.json 을 읽어 경로별 표로 렌더 (외부 Swagger UI 를 CDN 으로 넣지 않습니다 — 순수 표) + `curl` 예시 코드 블록
- 메뉴: 컨트롤러가 등록 (보고서에 href 3개)

### 5. 테스트

- `lib/api/auth.test.ts` 해시 · Bearer 파싱 · scope 판정
- `lib/api/inbound.test.ts` 응답 조립(validate 결과 → { received, accepted, rejected, errors }) · strict 판정 — 순수 부분만
- `lib/api/openapi.test.ts` 경로 18개 존재 · 각 경로에 security 있음

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] `lib/import/validate.ts` · `schema.ts` 를 수정하지 않았다 (`git diff --stat lib/import` 비어 있음)
- [ ] 키 원문이 DB · 로그 · 감사로그 어디에도 저장되지 않는다
- [ ] 부분 성공 + strict 전량 거부 + Idempotency-Key 재요청 동일 응답
- [ ] 인증 없는 요청 401 · scope 없는 요청 403 · 초과 429

## 보고서

`.superpowers/sdd/step/task-19-report.md`.
