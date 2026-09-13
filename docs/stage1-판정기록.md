# Stage 1 리팩터링 — 진행 중 내린 판정 기록

> 이 문서는 2026-09-11~12 Stage 1 운영 전환 작업에서 담당자(Claude)가 내린 결정 전체입니다.
> 각 줄은 "무엇을 정했는가 — 왜 — 틀렸을 때 되돌리는 비용" 형식입니다.
> 계획: refactor_260911.md · 원안: refactor.md · 업무 규칙: stage1.md

## Rulings
Ruling: 작업 9의 품목 정책 승인 기능을 발주 계산보다 먼저 같은 작업 안에서 구현한다 — 승인되지 않은 정책으로 계산하는 모순을 방지한다 — 단계가 커지지만 단일 정책 snapshot 재현성이 생긴다.
Ruling: 이메일은 추가 SDK 없이 Resend REST 어댑터로 구현한다 — 서버 비밀키 노출을 피하고 교체 가능한 경계를 둔다 — 운영 시 Resend 환경변수 설정이 필요하다.
Ruling: 실제 Supabase 적용은 수행하지 않는다 — 사용자가 항상 SQL을 직접 입력한다고 확정했다 — 로컬에서는 SQL 정적 계약과 검증 쿼리까지만 검증한다.
Ruling: `raw.item_substitute`는 어떤 신규 조회·계산에도 연결하지 않는다 — `향후논의사항.md`의 제외 범위를 지킨다.
Ruling: `refactor.md`의 Phase 0~10 완료를 `refactor_260911.md` Task 1~13 완료로 판정한다 — 후자가 전자를 Task 단위로 다시 쓴 계획이고 이미 Task 1~3이 그 기준으로 진행됐다 — 틀리면 refactor.md 원안 대조표(§4)와 어긋난 항목을 최종 보고에서 추가 작업으로 넘긴다.
Ruling: refactor.md Phase 1 완료 기준 중 "법인 준비기간·공급처·출항일·달력 화면 수정"이 어느 Task에도 없으므로 Task 10(일정 계산이 이 값에 의존)에 관리자 마스터 편집을 추가한다 — 준비기간이 없으면 발주일 계산이 전부 PREP_DAYS_UNSET이 된다 — 틀리면 Task 10 범위가 커진다.
Ruling: 실데이터에 재고·리드타임·MOQ·단가·주문이 없으므로(메모 realdata-has-no-inventory-or-leadtime) 운영 테이블에 더미 값을 절대 넣지 않는다. 5회차 더미 `raw.inventory` 행은 상태·스냅샷 컬럼이 null이라 `INVENTORY_SCOPE_UNCLASSIFIED`로 제외되어야 한다. 행위 검증은 임시 PostgreSQL의 테스트 전용 fixture로만 한다 — "검증된 수치만 보인다"는 프로젝트 원칙 — 틀리면 화면이 한동안 전부 사유 코드로만 보인다(의도된 상태).
Ruling: Supabase 원격 적용·실계정 로그인 검수는 하지 않는다(세션 1 판정 유지). 권한 4단계 검증은 단위 테스트(메뉴·경로) + 임시 PostgreSQL에서 `auth.uid()`/JWT claim 대역으로 RLS·함수 거절을 확인하는 것으로 대체한다 — 사용자가 SQL을 직접 적용한다고 확정 — 틀리면 적용 후 실계정 검수에서 추가 결함이 나올 수 있고 이를 최종 보고에 명시한다.
Ruling: 같은 마이그레이션 파일 확장(Task 3→0400, Task 6→0600)은 허용하되 파일 전체가 재실행 안전(idempotent)해야 한다 — 아직 사용자가 신규 파일을 적용하지 않았고 Task 2~3이 같은 방식이다 — 틀리면 이미 적용된 환경에서 보정 마이그레이션이 필요하다.
Ruling (Task 9): 월평균사용량은 Champion Forecast가 학습한 것과 같은 학습 구간 사용량 계열의 최근 6개월만 쓰고 test Actual은 쓰지 않는다. 원천이 없으면 `AVG_USAGE_UNAVAILABLE` — refactor.md 열린 질문 2 — 틀리면 사용량 원천 뷰 하나만 바꾸면 된다.
Ruling (Task 9): "품절 가능성 최소"는 계획 기간 동안 예상 월말 재고가 음수가 되지 않게 하는 최소 수량(`stockout_prevention_qty`)으로 정의한다. `selected_qty = greatest(stockout_prevention_qty, dos_required_qty)`, 둘이 같으면 월말 재고금액 최소 기준으로 기록. `selection_reason`에 결정 기준(STOCKOUT_PREVENTION | DOS_TARGET | INVENTORY_VALUE_MIN) 저장 — stage1 §4 계산식 미정(refactor.md 열린 질문 3) — 틀리면 SQL 함수 한 곳의 선택식만 바꾸면 된다.
Ruling (Task 9·12): 단가는 `core.item_policy`의 승인된 단가 하나만 쓴다(표준원가/최근매입가 구분 없음). 없으면 `UNIT_PRICE_UNSET` — 열린 질문 4 — 틀리면 단가 컬럼 원천만 교체.
Ruling: 구현자·리뷰어 모델은 SQL 트랜잭션·동시성·계산 규칙이 무거운 Task 5·9는 opus, 나머지는 sonnet. 최종 전체 리뷰는 가장 강한 모델.
| 6 | 0600 확장 vs §5-6 "적용한 SQL은 수정하지 않음" | 위 idempotent Ruling |
| 9 | 평균사용량·품절가능성·단가 정의 부재 | 위 Ruling 3건 |
| 10 | 마스터 편집 부재(refactor.md Phase 1) | 위 Ruling |
| 11 | 6개 실계정 검증 요구 | 위 원격 미적용 Ruling |
Ruling: 실제 권한 집합은 테스트에서 STEP 19 SQL을 읽어 검증해 중복 상수를 만들지 않는다 — DB가 단일 권한 원천이라는 전역 규칙을 유지한다.
Ruling: 신규 경로에는 `requireAnyPermission()` 기반의 최소 서버 보호 진입 화면을 만든다 — 전체 기능은 후속 Task가 교체하되 현재 배포에서 404와 무보호 경로를 허용하지 않는다.
Ruling (Task 4 ⚠️ ATP): 영업(ATP_VIEW만 가진 사용자)은 재고 상세가 아니라 주문 가능 수량만 본다 — brief "영업은 ATP만" · 계획 Task 11 표 · stage1 §2 — ATP 전용 투영 `analytics.v_order_available_stock`(Task 5 객체명 선점, Task 5가 확장)을 만들고 `v_available_stock` 상세는 ATP_VIEW만으로 볼 수 없게 한다 — 틀리면 영업 화면 열 몇 개를 다시 여는 비용.
Ruling (Task 4 ⚠️ 창고): 분류 규칙은 창고코드+재고상태를 함께 매핑 키로 지원(창고 null = 모든 창고, 구체 규칙 우선) — stage1 §6의 서비스센터·파트너 보유는 창고 기준으로 구분될 수 있고 brief가 "원본 창고·재고상태를 매핑" — 틀리면 규칙 테이블 열 하나가 쓰이지 않을 뿐.
Ruling (Task 4 우려 a): 입고 완료(`receipt_status` 완료 + 입고일 확인) 건은 `stock_balance`를 증가시켜야 한다 — brief "stock_balance 증가 원장으로 연결" 명시, Task 6 `allocate_new_stock(p_item_id, p_receipt_id)`가 의존 — 이중 계산 방지를 위해 잔액 = 최신 정상 스냅샷 수량 + 그 스냅샷 시각 이후 입고 완료 수량(입고 건별 1회만 반영, 반영 원장으로 추적) — 틀리면 잔액 계산식 한 곳을 되돌린다.
Ruling (Task 4 우려 b): 실제 창고코드가 확인되지 않았으므로 창고 기준 규칙 seed(SERVICE_CENTER/PARTNER 예시 창고코드)는 넣지 않는다. 규칙 테이블과 우선순위 로직만 두고, stage1 §6 용어에서 온 재고상태 텍스트 seed만 유지. `docs/데이터-요청목록.md`에 창고코드 매핑 요청을 추가 — 가짜 마스터값이 실데이터를 오분류할 위험 — 틀리면 사용자가 규칙 행을 추가하면 된다.
Task 4: fix round 2 발송(위 두 Ruling) — 재리뷰 1과 병행.
Ruling (Task 5 대기열): 검토 요청 시점의 임시배정은 "그 순간의 가용재고"에서만 한다(선착순). 우선순위·최초 검토요청 시각·주문 생성 순서는 신규 입고분 자동배정(Task 6)과 수동배정의 '정상 순서' 판정에만 쓴다 — stage1 §2 42·50~57행이 대기 주문의 선점 확보를 규정하지 않음 — 틀리면 WAIT_FULL 주문이 후순위 요청에 추월당하는 결과를 되돌려야 한다.
Ruling (Task 5 만료): 주문의 임시배정 만료시각 = 최초 검토 요청 시각 + 30일, 주문 단위로 한 번만 기록하고 이후 추가 임시배정도 같은 만료시각을 쓴다. WAIT_FULL로 대기하다 나중에 배정돼도 같은 기준 — stage1 §2 43~45행 — 틀리면 만료 기준 컬럼 하나.
Ruling (Task 5 정상 순서): 수동배정의 "정상 순서"는 대상 주문보다 앞선(우선순위→최초 검토요청 시각→생성 순) 부족수량 보유 주문이 같은 품목에 없는 경우. 앞선 주문이 있으면 APPROVAL_HOLD + ALLOC_PRIORITY 승인 요청 — stage1 §2 69~72행 — 틀리면 판정 함수 한 곳.
Ruling (Task 5 수주 확정): 확정 시 기존 임시배정을 FIRM으로 전환, 남은 부족수량은 대기열에 남기고 이후 배정분은 곧바로 FIRM(만료 없음) — stage1 §2 95·97행 — 틀리면 확정 후 부족분 처리 분기 하나.
Ruling (Task 5 재등록): `copy_cancelled_order`는 CANCELLED와 EXPIRED 주문 모두에서 새 주문을 만들고 `replaces_order_id`로 연결 — stage1 §2 47~49·101~103행 — 틀리면 허용 상태 하나 제거.
Ruling (Task 5 고객): 고객 마스터가 없으므로 주문에는 고객코드·고객명 텍스트를 저장하고 가짜 고객 마스터를 만들지 않는다 — 실데이터 원칙 — 틀리면 FK 추가 마이그레이션.
Ruling (Task 5 긴급발주): Task 5는 `core.urgent_order` 테이블·`analytics.v_urgent_order`·RLS까지만, 등록 함수와 화면은 Task 11 — 계획 파일 목록이 화면을 Task 11에 둠 — 틀리면 Task 11 범위 조정.
Ruling (Task 5 우려 2, 리뷰 전 수정): 확정 전 주문 취소 함수 `core.cancel_sales_order(p_order_id, p_reason)` 추가 — 주문 소유자(ORDER_CREATE)가 CONFIRMED 전 주문을 취소, 사유 필수, TEMPORARY 해제·APPROVAL_HOLD 해제와 대기 중 ALLOC_PRIORITY 승인요청 취소(반복 알림 취소 포함)를 한 트랜잭션으로, FIRM이 있으면 거절(취소는 cancel_firm_allocation 경로) — stage1 §2 96행 "임시배정은 주문이 반려, 취소 또는 만료되면 해제" — 틀리면 함수 하나 제거.
Ruling (Task 6로 전달, 우려 3): 만료 시 TEMPORARY만 해제. 해제 후 FIRM·APPROVAL_HOLD가 남는 주문은 EXPIRED로 바꾸지 않고 유지(stage1 §2 83·97행). 남는 배정이 없으면 EXPIRED. 배정 0인 WAITING_FULL 주문도 최초 검토요청+30일에 EXPIRED로 대기열에서 제외(재진행은 새 검토요청) — 무기한 대기 방지, stage1 §2 46~48행 — 틀리면 대기 주문이 30일 후 빠지는 동작을 되돌림.
Ruling (우려 4): 우선순위 1~9·기본 5, 수주 확정은 ORDER_CREATE+주문 소유자, WAIT_FULL은 주문 전체 단위, 품목담당자 알림은 ALLOC_MANUAL 보유자 전원(품목별 담당자 지정 마스터 없음) — 수용 — 틀리면 수신자 선택 함수·기본값 변경.
Ruling (Task 5 fix1 우려 1): 만료 후 확정 차단은 "해제되지 않은 TEMPORARY 배정이 남아 있을 때"로 한정. TEMPORARY가 없고 FIRM·APPROVAL_HOLD만 남은 주문은 만료 후에도 confirm 가능(주문번호 기록, 부족분 대기 유지, 이후 배정은 FIRM) — stage1 §2 68·97행: 30일 규칙은 임시배정에만 — 틀리면 확정 가드 조건 한 줄. 재리뷰 전 보정 발송.
Ruling (Task 6 파일): 0600(2,393줄)을 더 키우지 않고 신규 `supabase/migrations/20260911000610_stage1_allocation_jobs.sql`에 만료·입고 후 배정 함수를 둔다 — 계획은 "같은 마이그레이션 확장"이지만 Task 5 리뷰가 재실행 위험(create table if not exists)과 크기를 지적 — 틀리면 파일 목록 차이만 남는다.
Ruling (Task 6 자동배정 계기): AUTO 품목 자동배정은 신규 입고 완료(Task 4 입고 원장 반영) 때만 실행한다. 만료·취소로 해제된 재고는 가용재고로만 복귀하고 대기 주문에 자동배정하지 않는다 — stage1 §2 55·62행이 "신규 재고가 입고되면"으로 한정 — 틀리면 해제 경로에서 같은 배정 함수를 한 번 더 호출하면 된다.
Ruling (Task 7 마감): 제출 마감일 = 대상월 전월 말일 − 1일, 영업일 보정 없음(stage1 §3 원문). 마감일 당일은 제출 가능, 미제출 반복 알림은 마감일 다음 날 00:00 Asia/Seoul부터 10분 단위 — stage1 §3 "마감일까지 제출하지 않은 부서" — 틀리면 시작 시각 계산 한 곳.
Ruling (Task 7 대상 부서): 제출 대상 부서 = `DEMAND_SUBMIT` 권한을 가진 활성 사용자가 있는 부서(현재 MARKETING·SERVICE). 알림 수신자는 그 부서의 DEMAND_SUBMIT 보유 활성 사용자 — 부서 마스터 별도 없음 — 틀리면 대상 부서 테이블 추가.
Ruling (Task 7 기준월): `core.planning_cycle`은 seed하지 않고 SCM 품목담당자(PLAN_CONFIRM) 또는 ADMIN이 화면에서 연다. 월별 활성 주기 1개 — 가짜 운영 데이터 금지 — 틀리면 초기 주기 1건 수동 생성.
Ruling (Task 7 파일 적재): 부서 사용자는 관리자 전용 import batch를 거치지 않는다. 파일 파싱 후 STEP 4와 같은 품목코드 정규화·검증 로직(TS 순수 함수 + DB 측 품목 매칭)을 재사용해 `core.demand_submission_line`에 행 오류로 저장 — 권한 경계 유지 — 틀리면 적재 경로만 바뀐다.
Ruling (Task 7 상태): 제출본 상태 DRAFT → SUBMITTED → (WITHDRAWN → 수정 후 SUBMITTED) → AGREED. 합의(AGREED)는 SCM 품목담당자(PLAN_CONFIRM)가 취합 화면에서 표시, 합의 후 부서 수정 잠금. 마감 후 회수하면 미제출 알림 series 재개 — refactor.md Phase 6 상태(미제출/제출/수정/합의/승인) 중 "승인"은 Task 8 수급회의 결과로 넘김 — 틀리면 상태 전이표 한 곳.
Ruling (Task 8 수주 확정 수요): `CONFIRMED_ORDER` = `status='CONFIRMED'`이고 최종 승인 주문번호가 있는 주문의 라인 요청수량. 월은 라인/주문에 필요일·납기일이 있으면 그 달, 없으면 수주 확정 시각의 Asia/Seoul 기준 월 — Task 5 우려 5(취소 주문도 주문번호 보존) — 틀리면 월 산정 기준 한 곳.
Ruling (Task 8 수급회의): `core.supply_meeting_result`는 SCM 품목담당자(PLAN_CONFIRM)가 기준월·품목·수량·승인 여부를 대리 입력(팀장 승인 없음, stage1 §5). 선택적으로 AGREED 부서 제출 라인을 근거로 연결할 수 있으나, 부서 제출 수량 자체는 집계하지 않고 승인된 회의 결과만 집계 — refactor 원칙 "제출 수요는 작업 8 확정 근거 뷰를 통과한 값만" — 틀리면 연결 컬럼만 남는다.
Ruling (Task 8 확률·파트너): 영업 확률 컬럼을 새로 만들지 않는다. 파트너 선주문 원천 테이블도 만들지 않는다(데이터 없음). 검증은 "미확정 주문 기여 0" 행위 검사 + 집계 뷰가 probability류 컬럼·레거시 테이블을 참조하지 않는다는 SQL 계약 테스트로 대체 — stage1 §2 109행·§5 — 틀리면 참고 조회용 컬럼 추가.
Ruling (Task 8 팀장 접근): 화면을 DB에 맞춘다 — SCM팀장(EVENT_ORDER_APPROVE)은 `/demand-submissions/consolidation` 읽기 전용 접근 허용(승인 전 근거 확인), 단 부서 제출 화면 전체는 열지 않도록 하위 경로 단위 권한으로 분리. 입력 폼은 권한별로 숨기고 Server Action·DB 함수 권한 검사는 그대로 — 계획 Task 11 표상 팀장은 "이벤트 승인" 담당 — 틀리면 경로 권한 한 줄 제거.
Ruling (Task 9 원천 게이트): 발주량 계산은 원천이 검증된 Forecast·사용량만 쓴다. Champion Forecast run과 6개월 평균사용량의 학습 행이 검증된 적재 배치(IMPORTED upload_batch) 등 추적 가능한 실데이터 출처를 갖지 않으면(5회차 seed 행 포함 시) 라인은 `CALCULATION_UNAVAILABLE` + `FORECAST_SOURCE_UNVERIFIED`. 출처 추적 수단이 전혀 없으면 구현자는 NEEDS_CONTEXT로 멈춘다 — 메모 realdata-has-no-inventory-or-leadtime·프로젝트 원칙 "더미 숫자가 실데이터처럼 나오면 안 된다" — 틀리면(더미도 허용) 게이트 조건 하나 제거. 결과적으로 현 배포 DB에서는 모든 라인이 계산 불가로 보이는 것이 정상.
Ruling (Task 9 분할): Task 9를 9a(품목 정책 변경 요청·ITEM_POLICY 승인·승인본 반영·item-policies 화면)와 9b(발주계획 생성·계산·확정·PURCHASE_PLAN 승인·화면)로 나눠 각각 구현·리뷰 — 계획의 "정책 승인 먼저" Ruling과 작업 크기 — 틀리면 리뷰 한 번이 두 번이 될 뿐.
Ruling (Task 9a 정책 승인): 요청 ITEM_POLICY_EDIT, 승인 ITEM_POLICY_APPROVE(요청자≠승인자). 제안값(목표 DoS·배정 방식·목표재고·단가·MOQ, pack_size·min_order_amount는 저장만)과 기존 승인값·사유를 `core.item_policy_revision`에 보관, 승인 결정 트랜잭션에서만 `core.item_policy` 운영값 반영(Task 5 ALLOC_PRIORITY와 같은 AFTER UPDATE 훅), 반려 시 운영값 불변. 운영값 직접 수정 경로는 Task 1에서 차단됨 — 계획 Task 9 계산 규칙 1~2번째 항목 — 틀리면 훅 한 곳.
Ruling (Task 9b Flex): 계획 horizon 1~6개월, 1개월차 = 기준월(출항 준비기간+선적 약 1주 < 1개월, stage1 §8). 조정 후보 = 해당 품목·월의 AGREED 부서 제출 합계(Task 7), 없으면 기준 Forecast. 1개월차 ±20%, 2~3개월차 ±30%로 기준 Forecast 대비 클램프(flex_min/max·flex_applied 저장), 4~6개월차 미적용. 승인 추가 수요(Task 8 monthly)는 클램프 후 가산 — stage1 §4·§5 "이벤트성 대량 거래는 조정 범위를 벗어날 수 있으므로 별도 추가 수요" — 틀리면 후보 원천 한 곳.
Ruling (Task 9b 재고 전개): 1개월차 시작재고 = 계획 생성 시점 가용재고(Task 4·5 뷰: 정상 − 임시 − 확정 − 승인대기). k개월차 시작 = 전월 예상 월말(발주 반영). 수요 = 클램프 수요 + 승인 추가 수요. stockout_prevention_qty = max(0, 수요 − 시작재고); dos_required_qty = max(0, 수요 + 목표DoS/30 × 평균사용량 − 시작재고); selected = greatest(둘), 같으면 INVENTORY_VALUE_MIN; final = ceil(selected / coalesce(moq,1)) × coalesce(moq,1); 예상 월말 = 시작 + final − 수요; 예상 DoS = 예상 월말 / 평균사용량 × 30(평균 0·null이면 null+사유); 예상 재고금액 = 예상 월말 × 승인 단가 — 틀리면 계산 함수 한 곳.
Ruling (Task 9b 확정 차단): 라인 중 하나라도 CALCULATION_UNAVAILABLE 또는 TARGET_DOS_UNSET이면 계획 확정 거절(사유 목록 반환). 확정 PLAN_CONFIRM → PURCHASE_PLAN 승인요청, 승인 PLAN_APPROVE 훅에서만 최종본. 계획은 생성 시 입력값을 라인에 스냅샷하고 승인본은 불변, 재계산은 새 계획 버전 — stage1 §6 "발주 확정을 차단" — 틀리면 라인 단위 제외로 완화.
Ruling (Task 9a 취소): 요청자(ITEM_POLICY_EDIT, 본인 요청)가 PENDING 정책 변경 요청을 사유와 함께 취소하는 함수 추가 — 승인요청 CANCELLED, revision CANCELLED(CHECK 포함), 반복 알림 중단, 운영값 불변, 이력 기록; 결정 훅은 CANCELLED도 처리 — stage1 §2 75~77행 반복 알림이 결정 전까지 지속되므로 실수 요청의 탈출구 필요 — 틀리면 함수 하나 제거.
Ruling: 9a 재리뷰(읽기 전용)와 9b 구현을 병행 — 파일 충돌 없음, 9b는 커밋된 9a 인터페이스만 소비. 재리뷰가 결함을 내면 9b 완료 후 9a 수정(구현자 동시 실행 금지 유지) — 틀리면 9b가 9a 수정분을 다시 반영.
Ruling (9b 우려 1): 확정 전부-아니면-전무 유지(계획 대상 = item_policy 품목 + Champion 품목) — stage1 §6 차단 규칙 — 틀리면 라인 제외(사유) 기능 추가. 최종 보고에 운영 제약으로 명시.
Ruling (9b 우려 2, 리뷰 전 수정): 원천 게이트에 Champion 선정에 쓰인 test-window 실적 행도 포함 — 더미 test actual로 채점된 Champion은 모델 선택 자체가 더미 기반 — 틀리면 게이트 범위 축소.
Ruling (9b 우려 3, 리뷰 전 수정): 계산에 쓰는 정책값(목표 DoS·단가·MOQ·목표재고)은 필드별 최신 APPROVED revision 값만 인정. 승인 이력 없는 단가 → UNIT_PRICE_UNSET, MOQ → null(계산 시 1), 목표재고 → null+사유. `analytics.v_item_policy`에 approved_* 열을 뒤에 추가(create or replace, 기존 열 순서 유지)해 9b·Task 12가 같은 값을 읽음 — 9a Ruling 5와 일관, 9a 이전 직접 입력값이 승인값처럼 쓰이는 것 방지 — 틀리면 열 원천 한 곳.
Ruling (9b 우려 4): forecast_horizon ≥ test-window 개월 + 6 필요 — 설정 전제조건으로 최종 보고의 사용자 조치에 명시, 코드 변경 없음.
Ruling (9b 우려 5): "월별 작업 중 계획 1개(DRAFT·PENDING_APPROVAL·REJECTED), 승인본은 대체되지 않음, Task 10은 is_latest_approved 사용" 해석 수용.
Ruling (9b Important 2): 입력 지문 방식 — Forecast run·Backtest(Champion 채점) 생성 시점의 학습/검증 입력 지문(행수·수량합·max loaded_at·정렬된 (item, date, qty, batch_id) md5)을 기록하고, build 시 현재 입력 지문과 대조. 지문 없는 기존 run → FORECAST_INPUT_UNTRACED(재실행 필요). 지문 일치 시 usage_history와 무관한 적재(sales_order·business_event)로 인한 generic is_stale은 게이트에서 무시(9b Minor 5 해소). 기존 run·결과는 삭제·덮어쓰지 않고 열만 추가 — 틀리면 STEP 6/7 함수 재정의 되돌림.
Ruling (9b Minor 2 → 이번 수정 포함): projected_dos_days는 반올림 없이 저장, 화면에서만 반올림 — Task 12가 이 값을 비교에 사용(load-bearing).
Ruling (9b fix1 우려 경쟁): 지문을 입력 읽기 시점이 아닌 SUCCESS 시점에 기록 → run 도중 커밋된 적재 행이 지문에 포함될 수 있음. 수용 — 그런 행도 IMPORTED 배치 출처라 더미 오염은 불가, 최신성만 약간 어긋남; 사용자 조치에 "적재와 Forecast 실행을 겹치지 말 것" 명시 — 틀리면 run 시작 시점 스냅샷으로 교체.
Ruling (9b fix1 우려 보호): 관리자가 지문 열을 SQL로 직접 덮어쓸 수 있음 — 수용(관리자 SQL 권한은 원래 전권), 보호 트리거 없음 — 틀리면 guard 트리거 추가.
Ruling (Task 10 분할): 10a = refactor.md Phase 1 누락분인 관리자 마스터 편집(법인 출항 준비기간·공급처 활성/적용기간·공급처 출항일 규칙·영업일 달력 공휴일) + 변경 이력; 10b = 발주 일정·입고 차이(plan Task 10 brief). 순차 진행 — 10b가 편집된 마스터 값을 소비 — 틀리면 리뷰 한 번 추가일 뿐.
Ruling (Task 10a 권한): 마스터 편집은 ADMIN(stage1 §8 "관리자가 출항 준비기간을 입력하고 변경"), 과거 공급처는 삭제 대신 비활성+종료일, 모든 변경은 전·후·변경자·시각·사유 이력 — refactor.md Phase 1 지킬 것 — 틀리면 권한 코드 추가.
Ruling (Task 10b 달력): 발주일·계획 입고일 모두 한국(KR) 영업일 달력 기준(발주 주체 SCM팀과 입고 창고가 국내). 해당 월 달력이 준비되지 않았으면(STEP 18 business_calendar 준비 상태) 공휴일을 추정하지 않고 CALENDAR_NOT_READY — plan Task 10 "공휴일 데이터가 없는 국가는 추정하지 않음" — 틀리면 법인 국가 달력으로 교체.
Ruling (Task 10b 대상): 최신 승인 계획(is_latest_approved)의 1개월차 라인(final_order_qty > 0)만 일정화. 품목→공급처 매핑이 없으면 SUPPLIER_UNSET으로 제외. 공급처별 출항일 = 기준월 1일 이후 첫 출항일(출항 규칙), 규칙 없음 → DEPARTURE_RULE_UNSET, 준비기간 0/미설정 → PREP_DAYS_UNSET. 묶음 키 = 출항일 ISO 주차 — stage1 §8 "매월 정해진 발주일" — 틀리면 출항일 선택식 한 곳.
Ruling (Task 10b 실제 입고일): SCM 품목담당자(PLAN_CONFIRM)가 실제 입고일을 입력(행위자·시각 기록, 수정 이력), 미입력 → 차이 null + ACTUAL_RECEIPT_UNSET. 입고 원장 자동 매칭은 하지 않음(발주번호 연결 원천 없음) — 틀리면 매칭 함수 추가.
Ruling (10a Minor → 이번 수정 포함): 출항 규칙 폼의 요일·주차 select가 선택 없이 일요일/1주차로 조용히 저장됨 — Task 10b 발주일 계산이 이 값을 소비(load-bearing) — "선택" placeholder + 서버·DB 검증으로 미선택 거절.
Ruling (10b로 전달): 같은 공급처에 한 날짜에 유효한 활성 출항 규칙이 2개 이상이면 추정하지 않고 DEPARTURE_RULE_AMBIGUOUS — 10a는 기간 겹침을 막지 않음 — 틀리면 10a에 겹침 제약 추가.
Ruling (10b 수정): 일정 생성은 최신 승인본만 허용. 더불어 같은 기준월의 이전 승인본 일정 행은 대체됨(superseded) 표시하고, 기록된 실제 입고일은 같은 품목·공급처의 새 행으로 이관(이력 보존). 입고 차이 3개 뷰는 대체되지 않은 행만 집계 — ruling 7 "같은 원천 행" 보장 — 틀리면 대체 표시·이관 로직만 제거.
Ruling (Task 11 긴급발주): 등록·상태 변경은 SCM 품목담당자(ALLOC_MANUAL), 서비스부(URGENT_ORDER_VIEW)는 조회만 — stage1 §2 36행이 서비스부를 "조회"로 한정 — 틀리면 서비스부 등록 함수 추가.
Ruling (Task 11 재고 화면): Task 4가 만든 `/inventory`(상세 표 + ATP 전용 표)와 `analytics.v_available_stock`·`v_order_available_stock`의 부서별 품목 범위를 재사용하고 같은 화면을 다시 만들지 않는다. 계획 파일 목록의 marketing/service/sales 컴포넌트는 기존 화면에서 빠진 부분만 채운다 — 중복 구현 방지 — 틀리면 컴포넌트 분리만 추가.
Ruling (Task 12 월말 재고): 월말 재고수량 = 해당 월 안에 존재하는 가장 늦은 NORMAL 분류 스냅샷(Task 4 분류 기준). 그 달에 스냅샷이 없으면 현재 잔액으로 대체하지 않고 null + MONTH_END_SNAPSHOT_MISSING — 실데이터에 재고 스냅샷이 없다는 제약, 추정 금지 — 틀리면 원천 선택식 한 곳.
Ruling (Task 12 단가·목표): 금액은 승인된 단가(v_item_policy approved_unit_price)로만 계산, 없으면 UNIT_PRICE_UNSET(총액에서 제외하고 제외 건수·사유 표시). 목표 재고는 승인된 target stock, 없으면 null + 사유. 차이 = 실적 − 목표 — 계획 Task 12 "단가 null 품목이 0으로 조용히 포함되지 않아야" — 틀리면 단가 원천 한 곳.
Ruling (Task 12 기준월): `analytics.v_current_planning_cycle`은 Task 7 활성 주기에서 기준월·상태를 내고, 열린 주기가 없으면 null + PLANNING_CYCLE_NOT_OPEN. 대시보드·상단바·사이드바의 고정 `2026.09`를 이 값으로 교체(레거시 `components/procurement-app.tsx`는 Task 13 전환 대상이므로 건드리지 않음). "현재 월"은 Asia/Seoul — 틀리면 교체 지점 하나 되돌림.
Ruling (Task 12 지표 분리): Forecast WAPE·Bias와 월말 재고 성과를 같은 KPI·같은 카드로 합치지 않는다(gap 7.7) — 평가 대상이 다름.
Ruling (Task 12 파일명): 계획의 `20260911001100_stage1_inventory_kpi.sql`은 Task 11이 선점 → `20260911001150_stage1_inventory_kpi.sql` 사용.
Ruling (fix 웨이브 우려 1 — 적용된 마이그레이션 5개 수정 허용): STEP 4·6·7·step18(적용됨) + 0850(미적용)을 직접 수정한 것을 수용한다. 조건 — (a) 이미 적용된 DB에서 재실행해도 동작 동일(widen 여부 감지 후 skip, `drop policy if exists`), (b) 어떤 파일이 바뀌었고 재적용이 필요/불필요한지 `docs/stage1-supabase-수동적용.md`에 명시, (c) 전체 파일 순서 2회 연속 적용 성공을 검증 스위트로 증명. 근거: 나중 번호 파일은 앞 파일이 실패하는 것을 되돌릴 수 없어 "보정 마이그레이션" 관례로는 해결 불가 — 틀리면 사용자가 해당 5개 파일을 재적용해야 하고, 최악의 경우 뷰 정의가 옛 열 구성으로 되돌아간다(재리뷰가 이 지점을 검증).
Ruling (우려 2·3 수용): commit_import_batch가 3개 파일에 정의돼 있어 마지막 정의(1150)까지 고쳐야 실효가 있었던 점, purchase_order도 같은 결함이었던 점, 재실행 실패가 1개가 아니라 5개 파일이었던 점 — 보고된 범위 확대를 수용(모두 같은 결함 부류).
Ruling (우려 4 수용): 동시성 검증에서 "취소가 이기는" 분기는 decide_approval이 승인 행을 먼저 잠그는 구조상 발생하지 않음 — 교착 없음·승자 1명만 증명되면 충분하고, 취소 경로 자체는 순차 시나리오로 검증.
Ruling (우려 6): `.superpowers/sdd/*.md`는 gitignore 대상이므로 fix 보고서·brief 정정은 로컬에만 남고, 커밋되는 grep glob 수정은 `refactor_260911.md`에 반영 — 계획 문서가 저장소에 있으므로 사용자에게 전달됨.
Ruling (최종): 위 문서 문장을 반드시 정정한다(STEP 4·0500 예외 명시, 단일 파일 재적용 시 나머지 체인 순서 재적용 요구). 사용자가 SQL 편집기에서 파일 하나만 다시 돌리는 것이 실제 시나리오이고, 실패 시 적재 경로가 조용히 퇴행하기 때문 — 틀리면 문서 문장 하나를 되돌리면 된다. 함께 item_policy/concurrency.sh의 무의미한 grep 단언과 migration_rerun의 사후 조건 부재도 보강(증거의 신뢰도 자체가 사용자 인계물의 일부).
Ruling: upsert 삭제 키가 (문서번호, 품목코드)로 좁아져 라인이 빠진 문서를 재업로드하면 옛 라인이 남는 새 semantics — 수용하되 함수 주석·문서에 명시(기존 동작은 다품목 손실이라 더 나빴음).
Important 3: 마이그레이션 파일 순서 전체 재실행이 0850에서 실패 — 0850:470의 v_item_policy(16열)를 0900:633이 24열로 확장, create or replace는 열 삭제 불가. 수동 적용 프로젝트에서 "전체 재실행"이 표준 복구 경로라 Ruling(재실행 안전)을 깨뜨림. 수정: 0850(및 step18)이 superset 정의 또는 drop view if exists … cascade 선행.
Task 9b: minor (plan-mandated, parked): 목표DoS ≥ 0이면 dos_required ≥ stockout_prevention이라 selection_reason STOCKOUT_PREVENTION이 선택되지 않음 — Ruling: 수량은 정확(월말 음수 방지는 DoS 충족에 포함), 라벨만 의미 약함; 최종 보고에 명시 — 틀리면 라벨 규칙 한 곳.
Ruling (Task 8 우려 1): 수급회의 입력 권한은 기존 전용 코드 `SUPPLY_MEETING_INPUT`(STEP 19, SCM_PLANNER만 보유) 사용을 수용 — 목적 전용 권한이 이미 존재, 동작 동일 — 틀리면 권한 코드 한 곳.
Ruling: `docs/데이터-요청목록.md`는 .gitignore 대상(사용자가 기획 문서를 저장소에서 제외한 결정, 커밋 e46075b 계열)이므로 강제 추가하지 않고 로컬 파일로만 갱신 — 틀리면 사용자가 git add -f 한 번.

## 무료 플랜 스케줄러 (2026-09-12 추가)

Ruling: 10분 주기 작업을 Vercel 유료 크론이 아니라 Supabase pg_cron 으로 돌린다 — 수강생이 무료 플랜에서 실습할 수 있어야 한다 — 틀리면 vercel.json 크론으로 되돌리면 된다.
Ruling: 알림 전달은 pg_cron 이 claim 하지 않고 Edge Function 이 claim→검증→발송→완료를 한 흐름으로 소유한다 — pg_net 은 비동기라 결과를 DB 로 되돌릴 수 없고, 기존 Vercel 라우트가 이미 임대·재시도까지 검증된 순서를 구현하고 있다 — 틀리면 claim 위치만 옮기면 된다.
Ruling: Resend 키가 없을 때 EMAIL 건은 영구 실패가 아니라 재시도 대상으로 처리한다. 앱 내 알림은 키와 무관하게 완료된다 — 나중에 키를 넣으면 그대로 발송되게 하려는 의도 — 다만 일회성 알림은 10·30·70·150분 재시도 후 약 2시간 30분 만에 FAILED 로 확정되므로 키는 배포와 같은 세션에 넣는다.
Ruling: `core.finish_notification` 의 max_attempts·백오프 의미는 바꾸지 않는다 — 이미 검증된 DB 계약을 스케줄러 편의로 흔들지 않는다 — 틀리면 문서의 2시간 30분 설명만 수정하면 된다.
Ruling: 발신 주소가 수신함 없는 하위 도메인이므로 선택적 `RESEND_REPLY_TO` 를 추가해 답장이 contact@upflash.co.kr 로 가게 한다 — 값이 없으면 요청 본문이 이전과 동일하다.
Ruling: service_role 에는 `core` 스키마 USAGE 만 부여한다 — core 함수가 security definer 라 raw·analytics 접근 권한은 호출자에게 불필요하고, 테이블 직접 접근 권한을 넓히지 않기 위해서다 — 틀리면 필요한 스키마를 추가로 부여하면 된다.

## 실습용 데이터 (Task 15, 2026-09-12 추가)

Ruling: 실습 데이터는 마이그레이션이 아니라 `supabase/practice-data/*.sql` 에 둔다 — 마이그레이션에 넣으면 실제 운영 배포가 스키마를 적용하는 것만으로 더미 행이 함께 설치된다 — 틀리면 파일 위치만 옮기면 된다.
Ruling: 표식은 기존 뷰에 `is_practice` 열을 덧붙이지 않고 **새 객체로만** 만든다(`core.practice_dataset`·`practice_object`·`analytics.v_practice_*`) — `create or replace view` 는 열을 뺄 수 없어(error.md #16·#24), `v_available_stock`(0500)·`v_inventory_performance`(001150)·`v_procurement_plan`(000900)에 열을 더하면 이 저장소의 표준 복구 절차인 "전체를 파일명 순서로 다시 적용"의 두 번째 회차가 그 앞 파일에서 멈춘다 — 틀리면 열을 덧붙이고 앞 파일들에 skip 가드를 넣어야 한다(적용된 파일 5개를 또 고치게 된다).
Ruling: Forecast 원천 게이트(Task 9b)를 완화하지 않는다. 대신 실습 사용 이력을 STEP 4 적재 경로로 넣어 게이트 조건을 진짜로 만족시키고, 학습 기간을 **기존 미검증 행의 마지막 날짜 다음 달부터** 실행 시점에 계산한다 — 5회차 더미 7,038행(batch_id null)이 학습 기간에 걸치면 게이트가 정상적으로 막기 때문이다 — 부작용으로 실습 기준월이 실제 달력보다 미래일 수 있고, 그것을 README·수동적용 문서에 명시했다. 틀리면(게이트를 손보는 쪽을 택하면) 프로젝트 원칙 "더미 숫자가 실데이터처럼 나오면 안 된다"가 깨진다.
Ruling: 품목코드는 `raw.dim_item` 에서 **조회해서** 쓰고 하드코딩하지 않는다 — 컨트롤러의 배포 DB 를 조회할 수 없어 실제 코드를 알 수 없고, 지어내면 실데이터와 조인이 깨지며 실습 행과 실데이터 행을 구분할 근거가 코드에 남지 않는다 — 틀리면 select 를 상수 목록으로 바꾸면 된다.
Ruling: 제거 함수는 등기부에 올라 있는 것만 지운다. 실데이터는 등기부에 없어 구조적으로 지워질 수 없고, 적재 원본은 batch_id 로만 지워 batch_id 가 null 인 행은 어떤 경우에도 걸리지 않는다 — "실수로 실데이터를 지운다"를 불가능하게 만드는 것이 이 설계의 핵심 — 틀리면 삭제 대상 선정식 한 곳.
Ruling: 사람이 이미 업무를 한 실습 품목(주문·배정·긴급발주·수급회의·이벤트 수요)은 지우지 않고 `ACTED_ON_BY_USER` 로 보고하며, 그 품목의 적재 원본과 배치까지 함께 남긴다 — 정책만 남기고 마스터 행을 지우면 "존재하지 않는 품목의 정책"이 화면에 남는다 — 틀리면 raw 삭제 필터 한 곳.
Ruling: 지우지 못한 객체의 등기는 **남긴다.** 제거 뒤에도 살아남은 실습 발주계획이 화면에서 계속 "실습용"으로 표시되어야 한다 — 제거했다는 이유로 실습 숫자가 실적처럼 보이면 안 된다 — 틀리면 등기 정리 조건 한 곳.
Ruling: 실습 제거 버튼을 화면에 두지 않는다. `/admin/practice-data` 는 조회 전용이고 제거는 문서화된 SQL 로만 한다 — 여러 표를 한꺼번에 지우는 되돌릴 수 없는 작업이 버튼 하나로 실행되면 안 된다 — 틀리면 서버 액션 하나를 추가하면 된다.
Ruling: 배너는 화면별로 해당 도메인이 실제로 영향받을 때만 띄우고, 재고 화면은 지금 사용자에게 보이는 행과 실습 품목의 교집합으로 판단한다 — 부서마다 조회 범위가 달라 전체 현황만 보고 띄우면 실습 품목이 하나도 안 보이는 화면에도 경고가 붙는다. 거짓 경고는 진짜 경고를 무디게 만든다 — 틀리면 판정 함수 한 곳.
Ruling: 실습 묶음이 바꾼 운영 마스터(법인 출항 준비기간)와 기존 활성 Forecast 설정은 `restore_payload` 에 기록해 두고 제거 시 되돌린다 — 준비기간 0 은 "아직 현업에서 못 받은 값"이라는 뜻이라, 실습값이 남으면 받지 못한 값이 받은 값처럼 보인다 — 틀리면 복원 블록 하나.

## 가용재고 Open PO 캐스트·출처 (Task 16, 2026-09-12 추가)

계획 완료 후 배포 검증에서 찾은 결함. `analytics.v_available_stock` 전체 열 조회가
`22P02 invalid input syntax for type numeric: "1,000"` 으로 죽었다. 원인은
`core.v_open_po_qty` 의 `NULLIF(발주수량,'')::numeric` 이 빈 문자열만 막고 쉼표는 그대로
넘기는 것이고, 걸린 값은 출처 없는 5회차 더미 1행(`PO20261024`, ITEM007, `'1,000'`)이다.
재고 상세 권한자의 `/inventory` 화면이 배포 후 이 오류로 죽는 상태였다.

배포 DB 측정값: `raw.purchase_order` 92행·`raw.goods_receipt` 81행 **전부** `batch_id`
null(출처 전무). `core.v_item_master` 는 실데이터 `raw.dim_item` 이 아니라 별개의 더미
마스터 `raw.item_master` 를 읽어 `ITEM001..ITEM020` 20개가 화면 품목 마스터에 들어 있다.
`core.stock_balance` 에는 그 20개가 하나도 없어 20행 전부 창고재고·가용수량이 null +
`INVENTORY_SCOPE_UNCLASSIFIED` 다. 즉 관대 파싱만 넣으면 그 20행에서 Open PO 열만 숫자가
채워진다(합계 28,800, ITEM007 은 2,400).

Ruling: 캐스트를 관용적으로 바꾸는 것과 별개로 화면이 한 행 때문에 죽는 구조 자체를 고친다 — 값 하나만 정규화하면 다음에 쉼표 든 숫자가 적재될 때 같은 화면이 또 죽는다 — 틀리면 뷰 정의 한 곳을 되돌린다.
Ruling: 파싱 수정은 필요하지만 충분하지 않다. Open PO 는 출처로 게이트한다 — 기여한 `raw.purchase_order` 행에 `batch_id` 가 없으면 `open_po_qty` 를 숫자가 아니라 null + 사유코드로 낸다. 지금은 92행 전부 출처가 없어 이 열은 실제 발주 데이터가 IMPORT 될 때까지 전부 null 이 된다 — 죽는 화면을 "지어낸 발주량 20행이 실적처럼 뜨는 화면"으로 바꾸는 것은 구속 원칙("지어낸 숫자가 실데이터처럼 보이면 안 된다")·Task 9b 원천 게이트·"실데이터에 재고·리드타임이 없다" 판정에 정면으로 어긋난다 — 틀리면 게이트 조건 한 곳을 되돌리면 되고, 그때 잃는 것은 없다(그 열은 어차피 전부 더미다).
Ruling: 게이트를 넣어도 관대 파싱은 유지한다 — 출처 있는 데이터가 들어온 뒤에도 쉼표가 올 수 있고, 게이트에 걸린 행도 집계 도중 예외를 던지면 화면이 다시 죽는다 — 틀리면 파서 호출을 하드 캐스트로 되돌린다.
Ruling: 적재 경로(`core.apply_*_from_batch`)는 화면 경로와 다르게 판단한다 — 화면은 죽으면 안 되니 관용적으로 읽되, 적재는 조용히 통과하면 안 되니 파싱 불가 시 배치를 명확한 오류로 거부한다 — 적재에서 관용적으로 넘기면 잘못된 값이 typed 테이블에 정본으로 들어앉는다 — 틀리면 함수의 파싱 방침 한 곳.
Ruling: 더미 값의 정규화는 자동 적용 마이그레이션이 아니라 되돌릴 수 있는 문서화된 스크립트로 하고, 대상은 술어(`batch_id is null` 이면서 파싱 불가)로 잡아 출처 있는 행은 절대 건드리지 않는다 — 5회차 사용량 7,038행 정리와 같은 관례(보존 + 복원 함수 + 건수 불일치 시 중단) — 틀리면 복원 함수 한 번.
Ruling: 정규식으로 SQL 본문을 판정하지 않는다 — 같은 실수를 두 번 했다(STEP 7 RMSE 버그를 "없다"고 잘못 보고, `NULLIF(...)::numeric` 를 "캐스트 없음"으로 잘못 분류). 둘 다 중첩 괄호를 넘지 못하는 문자 클래스 탓이다 — 앞으로 `pg_get_viewdef` 전문을 읽거나 정규식 없이 뽑은 참조 목록으로 판단한다 — 이 판정을 어기면 "확인했다"는 보고 자체를 신뢰할 수 없게 된다.
Ruling: SDD 원장(`.superpowers/sdd/**/progress.md`)은 gitignore 스크래치이므로 모든 판정을 이 문서에 커밋해 보존한다 — 원장이 세션 중 `rm -rf` 로 복구 불가하게 사라졌고(git 이력 0개 커밋) 이 문서만 살아남아 대비가 실제로 작동했다 — 틀리면 원장을 추적 대상으로 옮기면 된다(스크래치 diff 가 커밋에 섞인다).
Ruling: 사유코드를 위해 `analytics.v_available_stock`·`core.v_open_po_qty` 에 열을 추가하지 않는다. 출처 게이트가 걸리면 기존 `open_po_qty` 열이 그대로 null 이 되어 스키마를 넓힐 이유가 없고, 사유는 이 저장소가 이미 쓰는 "계산 불가 안내" 패턴(별도 뷰 + 안내 컴포넌트)으로 화면 수준에서 한 번 말한다 — 기록된 판정이 금지한 것은 새 **열**이고 새 **객체**는 허용한다. 열을 넣었을 때 실제로 확인된 대가는 재실행 2회차가 `20260911000500:483`(수동적용 §5 가 단독 재실행 금지로 표시한 파일)과 `0600:2287` 에서 `cannot drop columns from view` 로 멈추는 것이었다 — 이 형태면 skip 가드도, 앞 파일 재수정도 필요 없다.
Ruling: 발주수량 정규화 기계(`core.purchase_order_qty_normalized` 표와 정규화·복원 함수, `practice-data/00c`)를 전부 제거한다 — 출처 게이트가 걸리면 그 1행을 정규화해도 화면·계산이 하나도 바뀌지 않아 운영 DB 에 표면을 남길 이유가 없고, 리뷰가 "중복행이면 건수 불일치로 안전하게 중단한다"는 보장이 실제로는 작동하지 않음(건수가 그대로 맞아 조용히 통과)을 확인했으니 결함을 고치는 대신 표면을 없앤다 — 틀리면 스크립트를 다시 만들면 된다.
Ruling: 적재 경로가 파싱 불가 행을 조용히 빼는 것은 허용하지 않는다 — `core.stock_receipt_ledger` 는 append-only 이고 `recompute_stock_balance_totals` 가 `normal_qty = snapshot + sum(ledger.qty)` 로 계산하므로 빠진 입고 1건이 재고와 ATP 를 영구히 과소계상하며 사유도 남지 않는다. 업로드 검증(`lib/import/validate.ts`)이 막는다는 논거는 면제가 되지 않는다 — raw 직접 삽입 경로가 실제로 존재하고(현재 92행이 그렇게 들어왔다) 그것이 이 사고의 원인이었다 — 틀리면 예외 문구 한 곳.
Ruling: 테스트는 컬럼 프루닝을 이기는 형태로 쓴다 — 수정 전 DB 에서도 `count(*)`·필터된 count·품목별 열 조회는 전부 성공하고 `select *`(plpgsql `perform * from ...`)만 22P02 를 낸다. 즉 "조회가 된다"는 확인은 이 사고를 잡지 못한다 — 이 판정을 어기면 실패할 수 없는 테스트를 통과로 착각한다.

## 재고 화면의 표시 없는 더미 품목 (Task 17, 2026-09-12 추가)

Task 16 리뷰에서 파생된 별개 결함. 재고 화면의 기준 테이블 `core.v_item_master` 는 32개
품목인데, 실데이터 `raw.dim_item` 에도 없고 실습 등재(`analytics.v_practice_item`, 11개)도
없어 **아무 표시가 없는 5회차 더미 품목이 21개**다. `core.stock_balance` 가 붙는 10개는
전부 실데이터 품목이라, 그 21행은 창고재고·가용수량이 null + `INVENTORY_SCOPE_UNCLASSIFIED`
로 나온다.

Ruling: 이 건은 Open PO 건보다 약하다 — 21행은 정직하게 "모른다"고 말하므로 숫자를 지어내지 않고, 위반되는 것은 "가짜 품목 정체가 실제 품목 옆에 표시 없이 재고 목록으로 앉아 있다"는 쪽이다 — 그래서 Task 16 을 막지 않고 후속으로 돌린다 — 틀리면 같은 마이그레이션에 조건 하나를 더 넣으면 된다.
Ruling: 거르는 위치는 `core.v_item_master` 로 한다. 처음에는 고아 행 위험을 가정해 화면 뷰에서만 좁게 거르려 했으나, `item_id` 를 가진 core 표 19개를 전수 조사해 **더미 품목 21개를 참조하는 업무 행이 0행**임을 확인하고 그 판정을 뒤집었다 — 소비자가 뷰 13개·함수 14개로 넓어서 화면 하나만 고치면 품절위험·재고성과·배정대기·수요제출 등 나머지 뷰 12개에 그대로 남고 새 뷰를 만들 때마다 다시 새어 나온다 — 틀리면 조건을 화면 뷰로 되돌리면 된다. 증거 없이 위험을 가정해 좁은 설계를 먼저 고른 것이 실수였고 측정이 바로잡았다.
Ruling: `raw.item_master` 의 출처 없는 23행을 데이터로 회수하지 않는다 — 사용자는 더미 데이터를 "표시하고 나중에 수정할 수 있게" 하라고 했고 삭제를 요청한 바 없다. 뷰에서 거르면 화면에서는 사라지되 원본이 남아 나중에 수정·승격이 가능하다 — 틀리면 회수 스크립트를 따로 만들면 된다.
Ruling: 게이트의 안전성은 적용 전에 측정으로 확인한다 — 실습 등재 11개 전부가 `batch_id` 있는 행으로 뒷받침되어 사라지는 실습 품목이 0개이고, `stock_balance` 보유 10개도 전부 살아남으며, 정확히 표시 없는 더미 21개만 줄어드는 것을 배포 DB 에서 모사해 확인했다 — 이 확인 없이 적용하면 수업 시연이 깨질 수 있었다.
Ruling: `in_transit_qty`(`core.v_inbound_qty`)에도 Open PO 와 같은 출처 게이트를 적용한다 — 원천 `raw.shipment_log` 2,864행이 **전부 `batch_id` 없음**이고 현재 19개 품목·합계 12,137 을 실수치처럼 화면에 올린다. 캐스트 관점에서는 "대상 아님"(네이티브 numeric 이라 22P02 를 내지 않음)이지만 출처 관점에서는 동일한 결함이다 — 캐스트 안전성과 출처 신뢰성은 별개 문제이고, 전자만 보면 후자를 놓친다 — 틀리면 게이트 조건 한 곳을 되돌린다.
Ruling: 이 건은 Task 17 로 미루지 않고 진행 중인 수정 라운드에 넣는다 — 같은 결함 종류·같은 화면의 인접 열·같은 조건 한 줄·같은 마이그레이션이라, 빼면 Open PO 는 정직하게 비어 있는데 옆 열은 지어낸 숫자를 보여주는 둘 중 어느 쪽보다 나쁜 상태로 배포된다 — 범위를 좁게 유지하는 원칙보다 "한 화면 안에서 정직함이 일관될 것"이 우선한다.
Ruling: 참고 열의 사유 안내는 Open PO 와 입고예정 두 열을 하나의 상태 뷰로 함께 설명한다 — 화면이 한 번만 말하고 두 열을 모두 빈칸으로 두는 편이 열마다 다른 안내를 띄우는 것보다 읽기 쉽고 거짓 경고를 만들지 않는다 — 틀리면 뷰를 열별로 쪼개면 된다.
Ruling: 위임한 확인 항목이 답 없이 돌아오면 컨트롤러가 직접 측정한다 — 리뷰어에게 넘긴 `in_transit_qty` 출처 질문이 답변 없이 종료됐고, 그대로 뒀으면 지어낸 12,137 이 배포됐다 — "위임했다"는 것은 확인됐다는 뜻이 아니다.
Ruling: `batch_id` 는 **보편적 출처 검사가 아니다.** 실데이터(`raw.dim_item` 93,868 · `raw.fact_shipment` 103,795 · `bridge_*` 등)는 강의 SQL 로 적재돼 `batch_id` 열 자체가 없다. 따라서 게이트의 근거는 "출처 = batch_id" 가 아니라 **"적재 경로 표(import target)에만 batch_id 게이트를 적용한다"** 다 — 이 구분을 놓치면 나중에 실데이터가 들어올 때 게이트가 진짜 데이터를 숨긴다. 라운드 1 이 거는 `purchase_order`·`shipment_log` 와 Task 17 의 `item_master` 는 전부 적재 경로 표이므로 유효하다.
Ruling: 화면 주력 열(창고재고·가용수량)은 손대지 않는다 — `core.stock_balance` 10행 **전부** `source_batch_id` 를 갖고 그 배치가 `IMPORTED` 상태이며 합계 2,850 이 실제 적재로 추적되고, 출처 없는 `raw.inventory` 43행이 닿는 품목은 0개다. 즉 주력 열은 이미 정직하다 — 참고 열만 게이트하면 되고, 주력 열까지 건드리면 검증된 숫자를 잃는다.
Ruling: 숫자를 내놓는 표면은 "캐스트 안전한가"가 아니라 "출처가 있는가"로 한 번 전수 점검한다 — 같은 결함을 두 번(Open PO, 입고예정) 놓쳤고 두 번 다 "범위를 가뒀다"고 보고한 뒤 옆 열에서 나왔다. 점검 결과 raw 를 읽는 나머지 analytics 뷰는 실데이터 표를 읽어 구조적으로 안전하고, `v_usage_anomaly` 의 원천은 출처 120/120 이며, 남은 미지는 `v_leadtime_gap`·`v_stockout_risk`·`v_inventory_performance` 세 뷰의 앱 도달 가능성뿐이다 — 이 판정을 어기면 "확인했다"는 보고가 또 옆 열에서 깨진다.
Ruling: 출처 게이트만으로는 22P02 를 막을 수 없으므로 관대 파서(`core.parse_lenient_numeric`)를 함께 유지한다 — `FILTER`/`CASE`/`WHERE` 는 걸러진 행의 캐스트 표현식 평가를 막아주지 않아, 게이트를 걸어도 `'1,000'::numeric` 이 평가되어 예외가 다시 날 수 있다. 예외를 던지지 않는 파서가 유일한 구조적 보장이다 — "게이트를 넣었으니 파서는 불필요"는 틀린 판단이다.
Ruling: 출처 게이트는 발주·입고 **양쪽** CTE 에 건다 — 발주만 걸면 "검증된 발주 − 미검증 입고"가 되어 게이트 전보다 나쁜 숫자가 나온다 — 틀리면 조건 한 줄.
Ruling: 사유코드는 `OPEN_PO_SOURCE_UNVERIFIED`·`IN_TRANSIT_SOURCE_UNVERIFIED` 로 하고 **출처 게이트가 파싱 불가 사유보다 우선한다** — 출처가 없으면 파싱 여부를 따질 의미가 없고, 두 사유를 한 값에 합치면 어느 쪽인지 알 수 없다 — 틀리면 우선순위 한 줄.
Ruling(정정): `core.v_fact_shipment` 를 "저장소에 없는 배포 전용 객체"라고 적었던 것은 **틀렸다** — 리뷰어의 주장을 검증 없이 옮긴 것이고, 정본은 `supabase/realdata/03b-missing-objects.sql` 에 실제로 존재한다(2026-09-11 에 26건 중 24건을 그 파일로 편입한 조치의 일부. `docs/db-저장소-대조-2026-09-11.md`). 측정 결과 배포 객체 230개 중 마이그레이션에 없는 27개 가운데 정본이 없는 것은 `core.v_ym_calendar` 1개뿐이다. 따라서 판정은 이렇게 바뀐다: 이 뷰를 고치는 수정은 마이그레이션에서 정의를 확정하되(적용 순서가 realdata → migrations 이라 게이트 정의가 나중에 이긴다) **`03b` 쪽 정의도 같은 게이트를 갖게 함께 고친다** — `03b` 단독 재실행이 문서화된 복구 절차이므로 그대로 두면 그때 게이트가 조용히 사라진다. 조용히 되돌아가는 수정은 수정이 아니다.
Ruling(위 전제의 정정): "`03b` 단독 재실행이 게이트를 **조용히** 되돌린다"는 내 서술은 틀렸다 — 평범한 `CREATE VIEW` 는 "already exists" 로 오류를 내므로(재리뷰어 실측 22건) 조용히 되돌릴 수 없었다. **`CREATE OR REPLACE` 로 바꾼 것이 그 위험을 만들었고**, 그래서 두 계층의 정의를 같은 게이트로 맞추는 것이 필수가 되었다. 결론(양쪽을 함께 고친다)은 옳고 메커니즘이 달랐다 — 이 작업에서 내 전제가 틀린 다섯 번째 사례이며, 판정의 근거로 쓴 메커니즘은 실측으로 확인해야 한다.
Ruling: `npm test` 통과를 빌드 통과의 근거로 받지 않는다 — node 러너가 `.tsx` 를 타입체크하지 않아, 컴포넌트가 존재하지 않는 심볼을 import 해도 테스트는 423/423 통과한다. 실제로 커밋 `bbe160c` 에서 `npm run build` 가 실패한 상태로 "build clean" 보고가 올라왔다(재리뷰어 실측) — 앞으로 빌드 통과는 실행 출력이 붙어 있을 때만 인정한다.
Ruling: 사유코드는 **자기가 알 수 있는 것만** 주장한다. `IN_TRANSIT_NO_IMPORT_PATH` 하나로 "적재 경로가 없다"는 구조적 사실을 "출처 있는 행이 0건"이라는 데이터 조건에서 끌어내면, 경로가 생긴 뒤에도 거짓을 말하거나 사유가 조용히 사라진다 — 구조 조건(`core.import_target_table` 이 shipment 종류를 아는가)과 데이터 조건(`batch_id`)을 각각의 근거로 판정해 분리한다. 라벨이 알 수 없는 것을 주장하는 것은 숫자를 지어내는 것과 같은 종류의 잘못이다.
Ruling: 결함의 재현·해소 여부는 **앱 경로(실계정 로그인 + PostgREST)로만** 판정한다. 관리자(postgres) 접속으로 `analytics.v_available_stock` 전체 조회를 하면 권한 함수가 0행을 만들어 집계가 평가되지 않아 **결함이 통과한 것처럼 보인다** — 실제로 관리자 경로는 3회 모두 정상이었으나, 같은 시각 SCM_LEAD 실계정 PostgREST 조회는 `22P02 "1,000"` 으로 실패했고 참고 열만 골라도 실패했다. 이 판정 없이 관리자 결과를 근거로 삼았다면 "고쳐졌다"고 잘못 보고하고 깨진 화면을 배포했을 것이다.
Ruling: 두 숫자를 비교해 "데이터가 변했다"고 말하기 전에 **두 숫자가 같은 범위를 재는지** 확인한다 — Open PO 더미 합계를 28,800(품목 마스터와 조인된 20개 품목)과 29,000(`raw.purchase_order` 92행 전체)으로 각각 재고서 배포 데이터가 변경됐다고 오경보를 냈다. 데이터는 그대로였다(문제 행·행수·batch_id 분포 전부 동일) — 이 작업에서 같은 부류(한 번의 측정으로 결론을 말하기)의 여섯 번째 실수다.
Ruling(위 `03b` 판정의 근거 재확립 — 일곱 번째 정정): "`03b` 단독 재실행이 문서화된 복구 절차"라는 내 전제는 **근거가 없다** — `수동적용`·`realdata/00-README`·`README`·realdata README 네 곳에 언급 0건이고, `00-README` 는 `04`·`05` 만 단독 실행이 안전하다고 명시하며, `03b` 재실행은 22건 오류를 낸다(재리뷰어 실측). 두 계층 정의를 같은 게이트로 맞추는 **결론은 유지**하되 근거는 **"두 계층의 정본이 일치해야 한다"** 다 — 저장소만 보고 새 환경을 재구성하면 realdata 계층이 게이트 없는 정의를 만들고 마이그레이션 적용 전까지 그 상태가 유지되기 때문이다. 되돌림 경로는 둘 다 큰 소리로 실패하므로(`already exists` · `cannot drop columns from view`) **조용한 되돌림은 애초에 불가능했다.**
Ruling: `core.import_target_table` 의 EXECUTE 를 `authenticated` 에 부여하는 것을 허용한다(PUBLIC 회수 유지, 부여 이유를 마이그레이션 주석에 명시). 이 함수는 종류 문자열을 받아 표 이름을 돌려주는 `CASE` 매핑으로 데이터에 접근하지 않으며, 사유코드가 "shipment 적재 경로가 존재하는가"를 상수가 아니라 실제 원천에서 판정하려면 호출자가 실행할 수 있어야 한다 — 대안은 상태 뷰를 security definer 로 바꾸는 것(RLS 우회)이나 구조적 사실을 하드코딩하는 것(사유코드 판정이 금지한 것)이다 — 틀리면 EXECUTE 를 회수하고 상태 뷰에서 그 판정을 뺀다.
Ruling: 커밋 증거로 `git diff --check` 를 받지 않는다 — 공백만 검사하고 미커밋 파일을 전혀 보고하지 않는다. 실제로 `bbe160c` 가 컴포넌트를 **내용 차이 0 인 순수 rename** 으로 커밋했는데 이 검사가 "깨끗"했다. **`git status --porcelain`** 출력(비어 있음)과 `npm run build` 실행 출력을 요구한다.
Ruling: 잘못된 서술이 커밋 메시지로 이미 굳었을 때 히스토리를 다시 쓰지 않는다 — 커밋 여러 개를 리베이스하는 위험이 메시지를 고치는 이득보다 크다. 대신 이후 커밋 메시지와 보고서에 명시적 정정을 남긴다. 기록이 남는 것은 괜찮고, **틀린 채로** 남는 것이 문제다.
Ruling: `supabase/realdata/03b-missing-objects.sql` 에 `05` 식 `DROP VIEW ... CASCADE` 정리 블록을 **넣지 않는다.** 실측 근거: `DROP VIEW core.v_inbound_qty CASCADE` 는 `analytics.v_available_stock` · `v_stockout_risk` · `v_stockout_kpi` 까지 함께 지운다 — 막으려던 42P16(열이 바뀔 때 `create or replace view` 가 죽는 것)보다 훨씬 나쁘다. 대신 `03b` 머리에 "이 파일의 뷰에서 열을 바꿀 때는 42P16 을 직접 처리해야 한다(`05` 와 달리 정리 블록이 없다)"는 경고 주석을 둔다 — 나중에 "일관성을 위해 `03b` 에도 같은 블록을 넣자"는 제안이 나오면 이 판정을 먼저 읽을 것. 이 결론은 내가 해법을 미리 정하지 않고 `05` 의 실제 블록을 읽고 판단하게 했기 때문에 나왔다("같은 패턴을 넣어라"라고 지시했으면 더 나쁜 것을 넣었다).
Ruling: 상태·안내용 뷰도 앱 권한 범위를 따르게 두고, 관리자(postgres) 조회가 0행인 것을 결함으로 보지 않는다 — `analytics.v_stock_reference_source_status` 는 SCM_LEAD 1행 · SALES_REP 0행 · 관리자 0행이다. 관리자 접속은 앱 권한이 없어 `v_available_stock` 도 0행이 되며, 그래서 적용 검증 스크립트에서 이 줄이 비어 보인다(쿼리 실패가 아니다) — 검증은 언제나 앱 경로로 판정한다.
Ruling: "전체 파일 재적용"은 **마이그레이션 계층만** 재건한다 — 완전한 재구성은 `realdata`(01→07) 다음 `migrations` 순서다. 열 추가 금지 판정의 근거 자체는 유효하지만(재실행 2회차가 `0500:483`·`0600:2287` 에서 실패하는 것을 리뷰어가 실측), 그 절차를 "표준 복구 절차"로 뭉뚱그려 말한 것은 부정확했다.
Ruling(금지 판정의 예외): `core.v_fact_shipment` 에 `batch_id` 열을 **추가하는 것은 허용한다.** 열 추가 금지 판정의 대상은 재적용 2회차가 `cannot drop columns from view` 로 멈추는 것이 실측된 `analytics.v_available_stock`(0500·0600)과 `core.v_open_po_qty` 였고, 이 뷰는 그 대상이 아니다. 출처 게이트를 걸려면 하위 뷰가 `batch_id` 를 내놓아야 하며, 대안(`core.v_inbound_qty` 에서 `raw.shipment_log` 를 다시 조인)은 정본 두 곳(`realdata/03b-missing-objects.sql` 과 `migrations/20260912000800`)의 정의를 더 벌려 동기화가 깨지기 쉽다. 열은 **맨 뒤에** 붙어 기존 순서를 바꾸지 않고, 두 파일이 같은 열 구성이 되어 재적용이 대칭이다 — 잔여 위험은 `batch_id` 가 없던 더 오래된 `03b` 를 단독 재실행할 때 `create or replace` 가 열을 빼려다 실패하는 경로뿐이며, 그때는 그 경로의 최소 방어를 문서화하면 된다.
Ruling: `core.v_inbound_qty` 의 게이트는 수량만이 아니라 `earliest_eta` 까지 함께 받는다 — 출처 없는 선적의 도착 예정일을 보여주면 수량을 가려놓고 날짜로 같은 거짓을 말하는 셈이다 — 틀리면 해당 `case` 하나를 되돌린다.
Ruling: grep·정규식 판독을 근거로 "확인했다"고 말하지 않는다. 이 작업에서 같은 부류로 네 번 틀렸다 — 정규식이 중첩 괄호를 넘지 못해 2회(STEP 7 RMSE 버그, `NULLIF(...)::numeric`), 조회 출력을 끝까지 보지 않아 3회(객체 대조), 대소문자를 구분해 `batch_id IS NULL` 을 놓쳐 1회. 전부 **한 번의 조회 결과로 결론을 말한 것**이 원인이다 — 앞으로 판정 근거가 되는 확인은 `pg_get_viewdef` 전문이나 diff 전문을 읽고, 리뷰어에게도 내 판독을 근거로 쓰지 말고 독립 확인하라고 명시한다.
Ruling: `raw.shipment_log.batch_id` 는 열만 있고 **채우는 적재 경로가 존재하지 않는다**(`core.commit_import_batch` 에 shipment 분기 없음 — 배포 DB 에서 확인). 따라서 게이트를 걸면 `in_transit_qty` 는 "아직 IMPORT 안 됨"이 아니라 현재 구조로는 **영구히 빈칸**이다. 그래도 게이트를 건다 — 정직한 빈칸이 지어낸 12,137(IN_TRANSIT 117행, 2,864행 전부 출처 없음, 배포 DB 측정)보다 낫다. 대신 사유코드가 "적재 경로가 없어 채울 수 없음"을 구분해 보여야 하고, 입고예정 열을 살리려면 shipment 적재 경로가 먼저 필요하다는 사실을 `수동적용` 문서와 데이터 요청목록에 남긴다 — 사용자가 무엇을 요청해야 하는지 알아야 한다.
Ruling: 리드타임·품절위험 뷰(`v_leadtime_gap` 12행, `v_stockout_risk` 20행)는 출처가 없지만 **조치하지 않는다** — 앱에서 도달할 수 없음이 확인됐다(화면은 `NoRealDataNotice` 만 렌더하고 쿼리 호출이 없으며, 등록된 에이전트 툴 4개가 직·간접으로 읽지 않고, 남은 타입·정규화는 테스트만 부르는 죽은 코드). 2026-09-10 제거는 이 두 건에 대해 완전했다 — 도달 불가한 뷰를 고치는 것은 위험을 줄이지 않고 변경 표면만 늘린다. 이름이 같은 `v_inventory_performance` 는 다른 뷰로 교체돼 실제 스냅샷 표를 읽고 없으면 사유코드를 내므로 문제없다.
Ruling(제자리로 되돌린 기록): `docs/db-저장소-대조 §6.2` 가 이미 `core.v_fact_shipment` 의 재사용을 금지했는데 `analytics.v_available_stock` 이 재사용 중인 것은 **사실로만 기록하고 이번 범위에서 바꾸지 않는다.** 이 문장은 원래 `core.v_fact_shipment` 판정에 속했는데, 그 판정을 정정으로 교체할 때 내가 `old_string` 을 줄의 앞부분만 잡아 꼬리가 남았고 이후 추가가 그 앞에 끼어들면서 **엉뚱한 판정(grep 규율)에 접착된 채 커밋·푸시됐다.** 내용이 사라진 것은 아니지만 판정이 뒤섞였다 — 긴 줄을 부분 문자열로 교체할 때는 줄 전체를 교체 대상으로 잡는다.
Ruling: 어떤 지적이 "이미 반영돼 있었다"를 판정할 때는 **지적 시점의 HEAD 를 기준으로** 확인한다 — 지시의 결과물인 나중 커밋을 근거로 지시 전 상태를 판정하면 인과가 뒤집힌다. 이 작업에서 두 번 일어났다: (1) 라운드 2 의 입고예정 게이트 지적을 `bbe160c`(그 지시의 응답)로 확인해 "리뷰가 `f49e619` 를 본 오해"라고 결론냈으나 `f49e619` 의 게이트 줄은 0개였다, (2) 라운드 4 의 누락 2건을 `9eb6f77`(그 지시의 응답)로 확인해 "이미 있었다"고 결론냈으나 내가 검사한 `1966d9a` 의 메시지에 `f49e619` 언급은 0회였고 `9eb6f77` 의 diff 가 그 2줄을 추가했다. 두 번 모두 grep 수치 자체는 참이었고 **대상 커밋이 틀렸다.** 틀린 주장에 근거를 대고 반박하는 습관은 옳고 실제로 내 오류를 여러 번 잡았다 — 다만 "언제 무엇이 HEAD 였는지"를 함께 확인해야 한다.
Ruling: **게이트된 뷰를 "존재 판정"의 기준으로 쓰지 않는다.** 출처 게이트는 화면 표시를 좁히는 장치이고, "그 품목이 존재하는가"는 원본 표(`raw.item_master`)로 판정해야 한다. 실측 사례: Task 17 의 `core.v_item_master` 게이트가 `core.remove_practice_dataset`(`20260912000600:471`)의 존재 검사를 통과하지 못하게 만들어, **게이트로 가려진 품목의 실습 표식이 조용히 삭제되는 경로**가 생겼다(리뷰어 실측 `would_be_deleted = t`, 출처 있는 대조군 `f`). 즉 "실수로 실데이터를 지우는 것이 구조적으로 불가능해야 한다"고 설계한 제거 함수에 내 게이트가 새 구멍을 냈다. 보고서의 "실습 품목은 항상 `batch_id` 가 있다"는 **측정된 우연이지 함수가 강제하는 불변식이 아니다** — 표시를 좁히는 변경을 할 때마다 그 뷰를 존재·권한·삭제 판정에 쓰는 소비자가 있는지 전수 확인한다.
Ruling: 테스트가 운영 제약과 어긋날 때 **운영 제약을 넓히지 않는다.** `app_user_job_role_chk` 는 `SALES_REP`·`SCM_PLANNER`·`SCM_LEAD`·`BIZ_DEV`·`MARKETING`·`SERVICE`(+NULL) 만 허용하는데 픽스처가 `T5_DUAL`·`T8_DUAL_ROLE`·`T9_DUAL_ROLE`·`T9B_DUAL_ROLE` 같은 합성 이중 역할을 쓴다. 이는 **저장소 결함**이다(제약과 픽스처가 둘 다 커밋돼 어느 기계에서든 실패한다. 내가 "로컬 환경 문제"로 기울여 판단한 것은 틀렸고, `item_policy` 는 픽스처가 아니라 부트스트랩의 pg_cron 에서 죽는다). 화면·서버·DB 3중 권한 검증이 이 프로젝트의 전제이므로 테스트 편의로 그 전제를 흔들 수 없다.
Ruling(위 판정의 정정 — 완화는 애초에 불필요했다): 나는 처음에 "제약 완화를 임시 DB 안에서 한시 허용하고 픽스처 재표현은 별도 과제로 남긴다"고 판정했다. **틀렸다.** 리뷰어 실측: `core.role_permission.job_role` 은 CHECK 도 FK 도 없는 평범한 `text not null`(`20260911000200_step19_permission.sql:65-70`)이고 제약이 걸린 것은 `app_user.job_role` 뿐이다 — 즉 **이중 권한 역할을 만드는 것은 이미 스키마상 합법**이고 불법인 것은 그 합성 이름을 **사용자에게 배정**하는 것뿐이다. 위반 지점은 `item_policy/fixtures.psql:59`·`approved_demand:56`·`procurement_plan:73` 의 `app_user` INSERT **각 한 줄**이며, 합성 직책을 미사용 실직책(`BIZ_DEV`)으로 바꾸면 **제약을 전혀 건드리지 않고 세 스위트가 전부 통과한다**(리뷰어가 실행해 확인). `item_policy/scenarios.psql:104-121` 의 S6 은 "한 계정이 두 권한을 동시에 가질 때 자기 승인이 막히는가"만 단정하므로 **역할 이름은 무관**하다. 따라서 재표현은 별도 과제가 아니라 픽스처당 한 줄이고, 제약 완화 코드는 테스트 스캐폴딩에도 남기지 않는다(`sales_order_allocation` 의 `T5_DUAL` 임시 완화도 제거한다). 단 그 픽스처에는 **왜 미사용 실직책이 시험용 권한 쌍을 갖는지** 주석을 남긴다 — 없으면 다음 사람이 "왜 사업강화부가 품목 정책을 승인하나"를 묻는다.
Ruling(검증된 발견): **앱과 테스트가 같은 맹점을 공유하고 있었다.** Task 17 의 게이트가 8개 스위트(`sales_order_allocation`·`demand_submission`·`inventory_kpi`·`approved_demand`·`procurement_plan`·`urgent_order`·`item_policy`·`procurement_schedule`)를 동시에 깨뜨렸고, 그 스위트들은 주문·배정·수요제출·승인·발주계획·정책개정·긴급발주·재고 KPI 라는 핵심 업무 흐름을 **출처 없는 `raw.item_master` 행으로 시험하고 있었다.** 리뷰어가 모든 hunk 를 직접 검사해 9개 파일의 변경이 **전부 (A)**(기존 INSERT 에 `batch_id` 열·값만 추가, 단정문·기대값·행 수 변경 0건)임을 확정했으므로, 시험 의도가 틀렸던 것이 아니라 **그 의도가 코드에 표현되지 않았던 것**이다 — 검증 장치 자체가 검증되지 않은 데이터 위에 서 있을 수 있다. 앞으로 출처 게이트를 새로 걸 때는 깨지는 테스트 수를 **맹점의 크기**로 읽는다.
Ruling: 마이그레이션 간 함수 재정의는 **전문 복사**로 하고, 재정의 뒤 속성을 사후조건으로 고정한다. `CREATE OR REPLACE FUNCTION` 은 OID·소유자·ACL(권한)은 보존하지만 **`SECURITY DEFINER` 와 `SET search_path` 는 보존하지 않는다** — 새 문장이 직접 선언해야 하며, 빠뜨리면 **오류 없이 조용히** `prosecdef` t→f, `proconfig` 가 비워진다(리뷰어 실측). `core.remove_practice_dataset` 은 `authenticated` 에 execute 가 있어 invoker 로 내려앉으면 RLS 아래 `core` 쓰기가 깨진다. 인자 기본값 제거·이름 변경은 반대로 **아예 거부**되므로 조용한 중복 오버로드는 생기지 않는다. → `migration_rerun` 사후조건이 본문 텍스트·`prosecdef = true`·`proconfig` 의 `search_path` 생존을 함께 고정하며, 세 조건을 각각 깨뜨려 개별로 잡히는지 확인했다(17/1 × 3, 복원 18/18).
Ruling: 여러 파일이 함께 적용되어야 할 때 **원자성은 저장소 구조가 아니라 적용 방법에서 얻는다.** 나는 게이트와 삭제 경로 수정을 한 파일로 합치려 했으나, 그 함수는 307줄이고 이미 정의가 둘(`0400`·`0600`)이어서 합치면 **세 번째 정본**이 생긴다 — 규칙을 지키려는 선택이 그 규칙이 막으려는 다중 정본 드리프트를 키운다. 대신 `psql --single-transaction -f A -f B` 로 적용하면 두 파일이 한 트랜잭션이 된다(로컬 스크래치 DB 에서 실제 테이블로 실증: 두 파일 정상 시 함께 커밋, 두 번째 파일 실패 시 **새 세션에서 첫 파일의 테이블이 존재하지 않음**). 런북의 "파일 하나를 통째로 붙여넣기"는 사람이 SQL Editor 로 할 때의 제약이며 담당자가 psql 로 적용할 때는 해당하지 않는다.
Ruling: 검증은 **성공과 실패가 다른 관측을 내는 형태**로 만든다. 배포에서 temp 테이블로 롤백을 시험한 것이 그 위반이었다 — temp 는 세션 종료로도 사라지므로 "롤백"과 "세션 정리"를 구분할 수 없었고, 로컬 스크래치 DB 에서 실제 테이블로 다시 해 `to_regclass = f` 로 증명했다. 가드의 패턴은 내가 신경 쓰는 것을 **구별**해야 하고, 빈 grep 결과를 "없음"의 단독 증거로 쓰지 않는다.
Ruling(내가 나를 잘못 비난한 기록의 정정): 적용 직전 가드가 주석을 탐지해 적용을 중단시킨 것을 나는 "내 패턴이 구별을 못 해 낸 거짓 경보"로 적었다. **그 자기 비난은 틀렸다.** 커밋 시점별로 측정하면 `71dccc5` 에 그 문장이 **1회** 있었다 — 첫 정정이 "이전 서술은 '…'라고 적었는데 거짓이었다" 식으로 **거짓 문장을 인용**해 설명했기 때문이다(구현자 설명과 내 측정이 독립적으로 일치). 그 뒤 `6ce460b` 가 인용까지 제거해(내 중단과 재시도 **사이**에 들어왔다) 재시도 때 0회가 됐다. **정밀하게 말하면: 텍스트는 있었고, 주장은 반박되고 있었다** — 인용은 그 주장을 하지 않으므로 읽는 사람이 오해하지는 않았을 것이다. 그래서 중단은 "거짓 주장이 살아 있었기 때문"이 아니라 **보수적으로 옳았다**(결과적으로 더 나은 주석이 됐고 구현자도 동의해 재작성했다). 진짜 교훈은 이것이다 — **텍스트를 찾는 가드는 주장과 인용을 구별할 수 없다.** 발동하면 "가드가 틀렸다"거나 "거짓 주장이 살아 있다" 어느 쪽으로도 바로 가지 말고 **커밋별 상태를 확인해 어느 쪽인지 귀속**하라. 그리고 스스로의 실수 목록도 측정 없이 늘리면 기록 자체가 거짓이 된다.
Ruling: 보고와 코드 주석이 어긋날 때 **어느 쪽에도 기울지 않고 코드를 직접 읽는다.** 나는 "주석은 코드를 보고 쓰였을 테니 주석이 맞을 것"이라고 기울었고 틀렸다 — 주석이 거짓이고 보고가 맞았다(`0400` 에는 종류별 존재 검사가 없고, 그 파일의 `v_item_master` 언급은 정규화 규칙을 설명하는 주석 한 줄이다). 그 앞에서는 리뷰어의 `0400` 위험 경고를 **확인 없이 요구사항으로 승격**시켰다 — 리뷰어는 정의가 둘이라는 사실은 맞게 봤으나 `0400` 쪽에 문제의 검사가 없다는 것까지 확인하지 않았고, 나도 확인하지 않고 그 위에 규칙을 얹었다. 둘 다 코드 한 줄을 읽으면 끝나는 일이었다.

## 차트 데이터 계층 (2026-09-13 추가)

사용자 요청으로 상용 대시보드 수준의 인터랙티브 차트를 만들기로 했고, **라이브러리 없이 인라인 SVG 프리미티브**로 가기로 확정했다(근거: 라이브러리는 null 구간의 선을 이어버리는데 `v_forecast_result` 450행 중 180행에 밴드가 없고 Open PO·이동중은 전 품목 null — "없는 값을 잇지 않는다"가 이 시스템의 핵심 계약이다). 그 1단계로 데이터 뷰 3종을 만들어 적용했다(`20260912001000`, 배포 검증 완료: 수요 시계열 180행 · 출고 롤업 238행 · 사유 없는 null 0건).

Ruling: 뷰의 `security_invoker` 여부는 **"이웃이 어떤 자세인가"가 아니라 "이 뷰가 무엇을 읽고, 그 기반 표에 RLS 정책이 있는가, 그리고 나중에 생길 수 있는가"** 로 정한다. 이 한 항목에서 구현자("이웃이 definer 이니 맞춘다")·나("일괄 복구"→"분할")·리뷰어("일괄 복구") **셋이 각자 다른 근거로 틀렸고**, 실제 의존 관계를 잰 뒤에야 갈렸다 — `analytics.v_demand_series` 는 `core.forecast_result`(`is_active_user()` 정책 보유)를 직접 읽어 invoker 가 **필요**하고(비활성 계정 4행 누출 → 0행으로 실측), 출고 뷰는 definer 인 core 계층을 거쳐 오늘은 무의미하지만 **definer 뷰는 기반 표에 RLS 정책이 나중에 추가돼도 조용히 적용되지 않으므로** 현재 비용 0 인 invoker 를 택한다. 배포 현황은 analytics 뷰 71개 중 invoker 33 / definer 38 로 둘 다 정상 패턴이다.
Ruling: 분석·예측 도메인의 새 뷰에 **권한 게이트를 걸지 않는다.** 배포 실측상 분석 계열 8개 뷰(`v_forecast_result`·`v_champion_model`·`v_model_comparison_detail`·`v_ol_accuracy`·`v_shipment_trend`·`v_item_demand_profile`·`v_sku_demand_profile`·`v_usage_profile`)가 전부 게이트 없이 열려 있고 게이트가 걸린 것은 재고 계열 둘(`v_available_stock`·`v_inventory_performance`, `STOCK_VIEW_ALL`)뿐이다. 영업담당자·마케팅부가 **오늘 이미** 예측·출고를 보고 있으므로, 새 뷰만 `STOCK_VIEW_ALL`(보유 직책은 SCM_LEAD·SCM_PLANNER 둘뿐)로 좁히는 것은 보호가 아니라 **접근 회귀**다 — 재고 상세를 가리려 만든 권한을 분석 도메인에 확장하는 것은 취지가 다르다. 전용 권한(`FORECAST_VIEW`·`SHIPMENT_VIEW`) 신설도 하지 않는다: 막을 대상도 검증할 화면도 없다 — **권한 체계를 화면보다 먼저 발명하지 않는다.**
Ruling: 사유코드의 정확한 의미는 **"호출자에게 보이는 범위 안의 사실"** 이다. 뷰는 볼 수 없는 것을 셀 수 없으므로 "행이 없다"와 "행이 안 보인다"를 원리적으로 구별할 수 없다 — 실측: invoker 를 켠 상태에서 비활성 사용자에게 `PERIOD_NOT_FORECASTED` 가 뜨는데 행은 실재하고 RLS 로 가려진 것이었다. 고칠 수 없는 것은 고치는 척하지 않고 **시나리오로 고정해 "알려진 한계"로 만들고**(S13b) 뷰 주석에 범위 한정을 명시한다.
Ruling: 사유코드 판정식을 바꿀 때는 **없앤 코드가 덮던 경우에 대체 코드가 있는지 반드시 함께 확인한다.** 내가 "조인 성사로 판정하라"고만 지시해, 예측 행은 있고 값만 null 인 경우가 **사유코드 없는 null** 이 됐다(리뷰어가 합법 INSERT 한 번으로 재현). "틀린 설명을 지우는 것"과 "설명을 없애는 것"은 다르고 **후자가 더 나쁘다** — 틀린 설명은 반박이라도 되지만 빈칸은 아무 단서도 남기지 않는다. → `PREDICTED_QTY_NULL` 로 분리.
Ruling: 커밋 내용을 검증할 때는 **반드시 `git show <sha>:<path>` 로 본다.** 작업 디렉터리 파일을 읽고 커밋 내용이라고 말하지 않는다 — 실제로 그렇게 해서 "픽스처 강화가 커밋에 들어갔다"는 **틀린 보증을 상대에게 전달**했다(그때는 미커밋이었다). 이 저장소에서 트리는 계속 움직이며, 리뷰어가 네 번·내가 두 번 그 차이에 걸렸다.
Ruling: **비난은 측정으로만 한다.** 구현자가 대기 지시를 어겼다고 단정하고 제3자(리뷰어)에게까지 전했으나, 커밋 시각(08:27:08)이 내 지시 발송 창(08:24~08:27) 안에 있어 **내 메시지가 먼저 도착했음을 입증할 수 없었다.** 이는 판정기록에 이미 두 번 적어둔 "지시의 결과물로 지시 전 상태를 판정하면 인과가 뒤집힌다"를 **내가 어긴 것**이다. 대조할 수 없으면 어겼다고 말하지 않는다.
Ruling: 대기 지시는 **양쪽에 동시에 통지한다.** 구현자에게만 해제를 알리고 리뷰어에게 알리지 않아, 리뷰어가 허가된 작업을 "네 번째 위반"으로 기록하고 있었다. 그리고 리뷰어에게 **"트리가 고정됐다"고 보장하지 않는다** — 두 번 깨졌고 내가 지킬 수 있는 종류의 약속이 아니다. **커밋된 SHA 와 그 시점 `porcelain` 출력**만 전달한다.
Ruling: 리뷰가 도는 동안 구현자를 **대기**시킨다. 움직이는 트리를 리뷰하면 증거가 도착 시점에 이미 낡는다(리뷰어의 porcelain 증거가 실제로 무효가 됐고, 자기 두 명령 사이 40초 동안 대상 파일이 늘어난 것을 관측했다). 대기 중 구현자는 **커밋하지 말고 무엇을 하던 중이었는지 한 줄만** 알린다 — 완전한 침묵은 내가 상태를 몰라 또 추측하게 만들고, 추측이 위 사고를 만들었다.
Ruling: PostgREST 는 응답을 **1,000행에서 끊는다**(실측: `v_shipment_trend` 10,228행 중 1,000행). 따라서 **받은 배열의 길이를 개수로 쓰지 않는다** — 개수는 `Prefer: count=exact` 로 서버에서 받는다. 현재 `app/(user)/analysis/demand-profile/page.tsx:32` 의 KPI 카드가 "분석 품목 **1,000**"을 사실로 단언하는데 실제는 **10,228** 이고, 원인은 `lib/scm.ts:45,73` 이 `.limit()` 없이 조회하기 때문이다. `.limit()` 없는 리포지터리 13개가 같은 위험을 갖는다 — **없는 차트보다 틀린 숫자가 나쁘므로 차트보다 먼저 고친다.**

---

## 정정 덧붙임 (2026-09-13) — 위 PostgREST 판정에 대하여

위 판정을 **고치지 않고 덧붙인다.** 그때 그렇게 판단했다는 사실 자체가 기록의 값어치이고,
숫자를 소급해 바꾸면 "그때 이미 알고 있었다"는 거짓이 된다.

**① 모집단 수치가 움직였다.** 위 판정의 `10,228` 은 HOC 팬아웃 수정(`f29fd37`, 적용 기록은
`docs/stage1-supabase-수동적용.md` §15) **이전**의 값이다. 그 수정으로 팬아웃이 만든 유령
코드 30개가 사라져 **2026-09-13 재측정 기준 10,198** 이다. 판정의 논리는 그대로 성립한다 —
`analytics.v_item_demand_kpi.sum(n_items)` 가 10,198 로 뷰 행 수와 **정확히 일치**하므로
"진실은 이미 DB 에 있고 화면이 잘린 배열을 셌을 뿐"이라는 진단은 유지된다.

**② "`.limit()` 없는 리포지터리 13개가 같은 위험을 갖는다"는 과녁이 너무 넓었다.**
이후 `analytics` 뷰 74개를 전수로 세어 보니 **1,000행을 넘는 뷰는 6개뿐**이고, 그중 앱이
실제로 무바운드로 읽는 것은 **호출 지점 3곳**(`lib/scm.ts:45 · 73 · 122`)이었다. 나머지
68개 뷰는 450행 이하라 잘리지 않는다. 넓은 과녁은 리뷰를 흐리고 무관한 파일을 건드리게
한다 — 실제 수정은 그 3곳과 비서 툴에 한정했다.

**③ 화면보다 AI 비서가 더 심각했다.** 위 판정은 KPI 카드를 지목했는데, 잘린 데이터를 주로
먹는 것은 화면이 아니라 `lib/agent/tools.ts` 였다. 비서는 잘린 배열을 `filter` 해
**존재하는 품목 9,198개(90%)를 "없습니다"라고 단언**했고(`UNKNOWN_ITEM`), 잘린 배열 길이를
`total` 로 내보냈다. 사유 코드가 붙은 비서의 답은 검증된 판정처럼 보이므로, 사람이 의심할
수 있는 화면의 수보다 나쁘다.

**④ 절단은 산발적이지 않았다.** 절단 경계가 동률에 걸리지 않는다(1000위 312.0 / 1001위
311.0). 즉 숨겨진 9,198 품목은 **매번 같은 집합**이었다 — 재현 가능하게 같은 품목을 가렸다.

**⑤ 1,000행 상한은 추정이 아니라 측정이다.** 근거는 대조에 있다 — 필터 없는 10,228행 뷰가
정확히 1,000행을 돌려준 **같은 측정에서 450행·117행 뷰는 전량이 왔다.** 상한이 1,000이
아니었다면 나올 수 없는 대조다. (이 판정을 쓴 뒤 한동안 "상한을 실측하지 못했다"고 적어
두었으나, 근거는 처음부터 이 기록 안에 있었다.)

