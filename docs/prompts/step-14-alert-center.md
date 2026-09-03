# STEP 14 구현 지시서 — Alert Center + 백그라운드 스캔

> 먼저 `docs/prompts/_공통규칙.md`. STEP 9(`v_stockout_risk` · `v_inventory_projection`) · 10(`v_purchase_recommendation`) · 12(`v_override_excess`) · 13(`v_approval`) 산출물을 전제로 합니다. 각 보고서의 인터페이스 절을 읽으세요.

## 무엇을 만들 것인가

SuperSCM 의 **STEP 14** 입니다. 탐지 룰 12종으로 Alert 를 만들고, 우선순위로 정렬해 보여주고, 담당자가 확인(acknowledge)합니다. 스케줄러가 주기적으로 전체 SKU 를 스캔합니다.

읽을 PRD 장: **24(Alert Center 전체)**.

## 만들 것

### 1. `sql/20-alert.sql`

```
core.alert
  alert_id bigserial PK ·
  type text not null   (아래 12종 코드) · severity text check in ('CRITICAL','WARNING','INFO') ·
  item_id · supplier_id ·
  reason text(한국어 한 줄) · impact text · recommended_action text ·
  metrics jsonb(룰이 본 숫자들) ·
  priority_score numeric(정렬용) ·
  detected_at timestamptz default now() · last_seen_at timestamptz · resolved_at timestamptz ·
  acknowledged_by uuid · acknowledged_email text · acknowledged_at timestamptz ·
  fingerprint text not null   (type + item_id/supplier_id — 같은 알림을 매 스캔마다 새로 만들지 않기 위한 키)
  partial unique index (fingerprint) where resolved_at is null

탐지 룰 12종 (renew.prd 24.1) — core.scan_alerts() 안의 CTE 로 각각 한 덩어리. 임계값은 core.policy_config 에서 읽고, 없는 키는 이 파일에서 시드합니다:
  ALERT_ACCURACY_WAPE_MAX 0.30 · ALERT_DEMAND_SPIKE_SIGMA 2 · ALERT_LEADTIME_DETERIORATION_DAYS 7 ·
  ALERT_OVERRIDE_REPEAT_COUNT 3 · ALERT_INQUIRY_SPIKE_RATIO 2 · ALERT_SOFT_ALLOC_EXPIRY_DAYS 2 · ALERT_PO_DELAY_DAYS 0

  STOCKOUT_RISK            v_stockout_risk.risk_status = 'WARNING'                          WARNING
  ORDER_TOO_LATE           risk_status = 'CRITICAL'                                          CRITICAL
  EXCESS_INVENTORY         months_of_supply > EXCESS_STOCK_MONTHS (전개 끝까지 여유이면 months_of_supply = 전개 개월 수)   INFO
  DEMAND_SPIKE             최근 확정 실적 달(core.v_usage_monthly 최신 달)이 그 달 consensus 의 P90 밖 또는 AI ± spike_sigma×sigma 밖   WARNING
  FORECAST_OUTLIER         v_ai_forecast 의 어느 기간 예측이 학습 구간 최대의 3배 초과 또는 음수                    WARNING
  OPEN_PO_DELAY            core.v_fact_shipment IN_TRANSIT 이고 due_date + PO_DELAY_DAYS < current_date            WARNING
  LEADTIME_DETERIORATION   공급처 최근 90일 완료 선적 평균 lt_total − effective_lead_time > DETERIORATION_DAYS       WARNING (supplier 단위)
  FORECAST_ACCURACY_DROP   champion_model.wape > ACCURACY_WAPE_MAX                                                   INFO
  EXCESSIVE_OVERRIDE       v_override_excess.n_recent_90d >= OVERRIDE_REPEAT_COUNT                                    INFO
  DELIVERY_PROMISE_RISK    raw.sales_order CONFIRMED 의 due_date 이전에 전개 재고가 음수                              CRITICAL
  SOFT_ALLOC_EXPIRING      core.soft_allocation RESERVED 이고 valid_until − current_date <= SOFT_ALLOC_EXPIRY_DAYS   INFO
  INQUIRY_SPIKE            core.sales_inquiry 가 아직 없으므로(STEP 17) — 테이블 존재를 to_regclass 로 확인해 없으면 건너뜁니다. 있으면 최근 7일 문의 수 > 이전 4주 주평균 × INQUIRY_SPIKE_RATIO   INFO

  priority_score (renew.prd 24.3 — 단가 · 결품 영향도 · 남은 시간):
    severity 가중(CRITICAL 100 · WARNING 50 · INFO 10)
    + coalesce(unit_price × 일평균수요, 0) 의 로그 스케일 (ln(1+x)×5)
    + 남은 시간 가중: stockout_days 가 있으면 greatest(0, 60 − stockout_days)
    숫자 세 개는 이 파일 머리에 상수로 두되 "정렬 가중치 — 정책값 아님" 주석

core.scan_alerts()
  returns table (n_new int, n_updated int, n_resolved int, message text) · security definer
  · 호출 권한: core.is_admin() 또는 (STEP 8 의 is_admin 확장으로) 직접 접속. Cron 은 아래 Route Handler 가 서비스 토큰으로 rpc 를 부르므로 함수 안에서 p_token 검사는 하지 않습니다 — 대신 Route Handler 가 CRON_SECRET 을 검사합니다.
    ★ 문제: Route Handler 는 로그인 세션이 없어 is_admin() 이 false 입니다. 해결: `core.scan_alerts(p_secret text default null)` 로 두고
      `p_secret = current_setting('app.cron_secret', true)` 이면 통과시킵니다. 관리자는 `select set_config(...)` 없이 is_admin() 으로 통과.
      `app.cron_secret` 은 사용자가 `alter database postgres set app.cron_secret = '...'` 로 한 번 설정합니다 (파일 머리 주석에 안내).
  · 12 룰의 결과를 하나로 모아 fingerprint 기준 upsert: 있으면 last_seen_at · metrics · priority 갱신(n_updated), 없으면 insert(n_new)
  · 이번 스캔에 안 잡힌 미해결 알림은 resolved_at = now() (n_resolved)

core.acknowledge_alert(p_alert_id bigint)   로그인 사용자 누구나. acknowledged_* 채움

analytics.v_alert            core.alert + item_name + supplier_name + type_label(한국어) + is_acknowledged + age_hours · 미해결만
analytics.v_alert_history    해결된 것 포함 최근 500
analytics.v_alert_kpi        n_open · n_critical · n_warning · n_info · n_unacknowledged · last_scan_at (core.alert 의 max(last_seen_at))
```

권한: 공통 패턴. `scan_alerts` · `acknowledge_alert` 는 `grant execute to authenticated` (+ anon 은 revoke). Route Handler 는 **로그인 없는 anon 세션**으로 rpc 를 부르므로 `scan_alerts` 만 `grant execute to anon` 도 필요합니다 — 대신 함수 안에서 p_secret 검사가 유일한 문입니다. 이 점을 파일 주석에 명시.

### 2. `lib/alerts.ts`

`getAlerts()` · `getAlertHistory()` · `getAlertKpi()` · `ALERT_TYPE_LABEL`(12종 한국어) · `SEVERITY_TONE`(CRITICAL→crit · WARNING→warn · INFO→info).

### 3. 스케줄러

- `app/api/cron/scan-alerts/route.ts` — `GET`. `Authorization: Bearer ${CRON_SECRET}` 검사(없거나 다르면 401). `createSupabaseServerClient()` 로 `schema('core').rpc('scan_alerts', { p_secret: CRON_SECRET })`. 결과 JSON.
- `vercel.json` 에 `"crons": [{ "path": "/api/cron/scan-alerts", "schedule": "0 */6 * * *" }]`
- `middleware.ts` 의 `PUBLIC_PATHS` 에 `/api/cron` 추가 (이 파일은 다른 단계도 고칩니다 — 한 줄만 더하세요)
- `.env.local.example` 에 `CRON_SECRET=`
- 관리자 수동 스캔: `/alerts` 화면의 [지금 스캔] 폼(관리자만) → 액션에서 `requireAdminOrThrow()` 후 rpc `scan_alerts` (p_secret 없이 — is_admin 통과)

### 4. 화면 `app/(user)/alerts/page.tsx` — `Planned` 교체

- KPI: 미해결 · 위험 · 주의 · 정보 · 미확인 — 각 필터 (severity 필터와 acknowledged 필터는 같은 `filter` 파라미터의 서로 다른 key)
- 목록: `components/ui/alert-row.tsx` 를 씁니다(design.md §6.9). 각 행: 유형 라벨 · 품목/공급처(mono) · reason · impact · recommended_action · 시각 · [확인] 버튼(폼) · 품목이 있으면 [상세] 링크 → `/purchase-recommendation/[itemId]`
- `AlertRow` 에 actions slot 이 없으면 `actions?: ReactNode` prop 을 추가합니다 (컴포넌트 수정 허용, 기존 사용처 호환)
- 정렬: priority_score desc
- 관리자 패널: [지금 스캔] + 마지막 스캔 시각 + 결과 메시지
- 하단: 해결된 알림 이력 (접힌 패널이 아니라 별도 Panel, 50건)

### 5. 테스트

`lib/alerts.test.ts` 라벨 12종 존재 · 정규화. use-server 테스트.

### 6. 인터페이스 (다음 단계)

- `analytics.v_alert` · `v_alert_kpi` (STEP 15 대시보드 · 16 `getAlerts` 툴 · 19 `/api/v1/alerts`)

## 완료 판정

- [ ] tsc · test · build · grep
- [ ] 12 룰이 `scan_alerts` 안에 전부 있고 각각 주석으로 PRD 24.1 의 조건을 인용한다
- [ ] 임계값이 policy_config 에서 온다 (정렬 가중치 상수 3개 제외)
- [ ] Route Handler 가 CRON_SECRET 없이는 401
- [ ] 같은 알림이 스캔마다 중복 생성되지 않는다 (fingerprint)

## 보고서

`.superpowers/sdd/step/task-14-report.md`. 메뉴 `/alerts` ready.
