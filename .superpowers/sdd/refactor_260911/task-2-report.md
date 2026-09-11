# Task 2 공통 승인 및 감사 이력 엔진 구현 보고서

## 상태

- 구현 및 로컬 검증 완료
- 시작 커밋: `aa177d4`
- 작업 위치: `/Users/danymac/Projects/superSCM`
- 작업 브랜치: `main` — 사용자가 기존 미커밋 변경을 현재 작업공간에서 이어서 커밋하도록 지정
- 커밋 메시지: `공통 승인과 감사 이력 엔진 추가`
- 사용자 소유 미추적 `summary/`, `제안.md`는 수정하거나 추적하지 않음

## 구현 내용

### 1. 공통 승인 원장과 이력

- `core.approval_request`에 네 승인 유형과 `PENDING | APPROVED | REJECTED | CANCELLED` 상태를 제한했습니다.
- 요청자·결정자 UUID와 함께 처리 당시 이름을 `requester_name`, `decider_name` 스냅샷으로 저장합니다.
- `core.approval_event`는 요청·승인·반려·취소 상태 전이를 append-only로 보관하며 UPDATE/DELETE를 트리거로 차단합니다.
- 요청과 결정 함수는 승인 원장, 승인 이벤트, `core.audit_log`를 한 함수 트랜잭션에서 함께 기록합니다.

### 2. 직접 RPC 요청 권한 우회 차단

`core.request_approval()`이 활성 사용자 여부만 보던 결함을 수정했습니다. 이제 아래 요청 권한을
`core.has_permission(permission, auth.uid())`으로 DB에서 직접 검사합니다.

| 승인 유형 | 요청 권한 | 요청 직책 | 결정 권한 |
|---|---|---|---|
| `ITEM_POLICY` | `ITEM_POLICY_EDIT` | `SCM_PLANNER` | `ITEM_POLICY_APPROVE` |
| `ALLOC_PRIORITY` | `ALLOC_MANUAL` | `SCM_PLANNER` | `ALLOC_PRIORITY_APPROVE` |
| `EVENT_ORDER` | `DEMAND_CONSOLIDATE` | `SCM_PLANNER` | `EVENT_ORDER_APPROVE` |
| `PURCHASE_PLAN` | `PLAN_CONFIRM` | `SCM_PLANNER` | `PLAN_APPROVE` |

결정 권한 매핑은 기존 값 그대로 유지했습니다. 시스템 `ADMIN` 여부는 업무 승인 권한으로 사용하지 않습니다.

### 3. 결정 입력 방어

- `APPROVED | REJECTED` 외 결정값을 거절합니다.
- 승인 ID는 canonical UUID 형태인지 확인합니다.
- 반려 의견은 trim 후 빈 문자열이면 거절합니다.
- 승인 의견의 공백 문자열은 `null`로 정규화합니다.
- Server Action은 첫 실행문에서 승인 권한 중 하나를 요구한 뒤, 검증에 통과한 값만 저장소 RPC에 전달합니다.
- DB의 `core.decide_approval()`도 정확한 유형별 결정 권한, 자기 결정 금지, PENDING 상태, 반려 의견을 다시 검사합니다.

### 4. 승인함과 이름 표시

- `analytics.v_my_approval_inbox`, `analytics.v_approval_history`는 `security_invoker = true`입니다.
- 다른 사용자의 `core.app_user` 행을 뷰에서 직접 조인하면 RLS 때문에 승인함 행 전체가 사라질 수 있어,
  요청·결정 시점 이름을 승인 원장에 저장하고 뷰에서 제공합니다.
- 기존 뷰 재적용 호환성을 위해 원래 13개 열의 순서는 유지하고 이름 두 열을 마지막에 추가했습니다.
- `/approvals`는 조회 오류와 빈 결과를 구분하고, 권한에 맞는 PENDING 요청만 표로 렌더링합니다.

## TDD RED → GREEN 증거

### Server Action 입력 계약

- RED: 결정 검증 테스트를 먼저 추가한 뒤 `node --test lib/approvals/model.test.ts` 실행
- 결과: `validateApprovalDecision` export가 없어 종료코드 1로 실패
- GREEN: enum·UUID·반려 의견 검증과 정규화를 구현
- 결과: focused 테스트 11/11 통과

### DB 직접 RPC 권한과 이름 컬럼

현재 초안 마이그레이션을 격리 DB `superscm_task2_red`에 적용한 뒤 실제 `authenticated` 역할로 호출했습니다.

- RED: `SALES_REP`가 `core.request_approval('ITEM_POLICY', ...)` 호출 시 승인 UUID가 반환되어 요청 권한 우회 재현
- RED: `information_schema.columns`에서 승인함의 `requester_name`, `decider_name` 조회 결과 0행
- GREEN: 같은 호출이 `이 승인 유형을 요청할 업무 권한이 없습니다.`와 종료코드 3(SQLSTATE 42501)로 거절
- GREEN: `SCM_PLANNER`가 네 승인 유형을 각각 요청해 UUID 4개 생성
- GREEN: `SCM_PLANNER` 요청자의 자기 결정은 `자신이 요청한 승인은 직접 결정할 수 없습니다.`로 거절
- GREEN: 빈 반려 의견은 `반려 의견은 필수입니다.`로 거절
- GREEN: 팀장 승인 후 history 뷰에서 `requester_name=김기획`, `decider_name=이팀장` 확인
- GREEN: 승인된 `EVENT001`의 `approval_event=2`, `audit_log=2` 확인
- GREEN: 수정 마이그레이션을 같은 DB에 두 번 연속 적용해 두 실행 모두 종료코드 0 확인

## 검증 결과

- `node --test lib/approvals/model.test.ts`: 11개 통과, 실패 0
- `npm test`: 105개 통과, 실패 0
- `npm run build`: 성공, 타입 검사 및 23개 페이지 생성 완료
- 로컬 PostgreSQL 행위 검증: 요청 권한·자기 결정·반려 의견·이름·이력·재실행 안전성 확인
- `git diff --check`: 최종 staging 전/후 확인

## 오류 기록

- 기존 작업자가 겪은 임시 DB 역할·`auth.uid()` 준비 오류를 `error.md` #14, #15에 보존했습니다.
- 뷰 열 중간 삽입으로 발생한 `cannot change name of view column`을 #16에 기록하고 기존 열 순서 유지로 해결했습니다.
- 괄호가 있는 App Router 경로의 zsh glob 오류를 #17에 기록하고 경로 quoting 규칙을 남겼습니다.

## 남은 우려와 적용 후 확인

- 실제 Supabase에는 마이그레이션을 적용하지 않았습니다. SQL Editor 적용 후 파일 끝의 확인 쿼리를 실행해야 합니다.
- 배포 계정의 `job_role`과 `core.role_permission`이 먼저 적용되어 있어야 요청·결정 권한이 생깁니다.
- 도메인별 승인 후 실제 품목 정책·우선 배정·이벤트 수요·발주계획에 반영하는 후처리는 Task 5/8/9 범위입니다.
- 테스트의 `MODULE_TYPELESS_PACKAGE_JSON` 경고와 build의 상위 lockfile workspace-root 경고는 기존 경고이며 실패는 아닙니다.
