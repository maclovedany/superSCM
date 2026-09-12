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
