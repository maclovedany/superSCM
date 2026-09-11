// STEP 19 업무 권한 — refactor_260911.md Task 1
//
// ★ 판정은 DB 의 core.has_permission() 한 곳에서 합니다. 여기서는 그 결과를 들고 다니며
//   화면을 고를 뿐입니다. 같은 판정을 두 곳에서 하면 언젠가 두 답이 갈라지고,
//   그때 열리는 쪽이 사고가 됩니다.
// ★ 메뉴를 숨기는 것은 1차 방어입니다. 실제 거절은 서버 액션과 RLS 가 합니다.

export const PERMISSIONS = [
  'ORDER_CREATE',
  'ORDER_REVIEW_REQUEST',
  'ATP_VIEW',
  'ALLOC_VIEW',
  'ALLOC_PRIORITY_EDIT',
  'ALLOC_PRIORITY_APPROVE',
  'ALLOC_MANUAL',
  'ALLOC_FIRM_CANCEL',
  'ITEM_POLICY_EDIT',
  'ITEM_POLICY_APPROVE',
  'DEMAND_SUBMIT',
  'DEMAND_CONSOLIDATE',
  'SUPPLY_MEETING_INPUT',
  'EVENT_ORDER_APPROVE',
  'PLAN_CONFIRM',
  'PLAN_APPROVE',
  'STOCK_VIEW_ALL',
  'STOCK_VIEW_PAPER',
  'STOCK_VIEW_SUPPLY',
  'URGENT_ORDER_VIEW',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** 업무 경로와 진입에 필요한 anyOf 권한의 단일 정의입니다. */
export const WORK_ROUTE_PERMISSIONS = {
  '/procurement-plans': ['PLAN_CONFIRM', 'PLAN_APPROVE'],
  '/allocations': ['ALLOC_MANUAL', 'ALLOC_FIRM_CANCEL'],
  '/approvals': ['ITEM_POLICY_APPROVE', 'ALLOC_PRIORITY_APPROVE', 'EVENT_ORDER_APPROVE', 'PLAN_APPROVE'],
  '/orders': ['ORDER_CREATE', 'ORDER_REVIEW_REQUEST'],
  '/allocations/priorities': ['ALLOC_PRIORITY_EDIT'],
  '/inventory': ['STOCK_VIEW_ALL', 'STOCK_VIEW_PAPER', 'STOCK_VIEW_SUPPLY', 'ATP_VIEW'],
  // Task 7 — 부서(DEMAND_SUBMIT)는 자기 제출본을, SCM 품목담당자(PLAN_CONFIRM)·취합 담당
  // (DEMAND_CONSOLIDATE)은 전체 취합 현황을 같은 경로에서 본다(RLS가 조회 범위를 가른다).
  // Task 8 — SUPPLY_MEETING_INPUT(수급회의 결과 대리 입력)도 더한다. 실제로는 SCM_PLANNER만
  // 가지므로 PLAN_CONFIRM·DEMAND_CONSOLIDATE와 항상 함께 있지만, 권한 판정을 core.has_permission
  // 하나로 유지하기 위해 코드를 그대로 나열한다.
  '/demand-submissions': ['DEMAND_SUBMIT', 'PLAN_CONFIRM', 'DEMAND_CONSOLIDATE', 'SUPPLY_MEETING_INPUT'],
  // Task 8 fix round 1 — 확정 수요 화면은 이 하위 경로 전용 항목으로 따로 둔다(requiredPermissionsForPath는
  // 가장 긴(구체적인) 일치 경로를 고른다). core.v_approved_demand_source의 조회 권한 게이트(마이그레이션
  // 20260911000800 §4)는 이미 EVENT_ORDER_APPROVE(SCM팀장)를 포함한다 — 승인 전 문맥 확인용 읽기 전용
  // 접근이다. 팀장은 이 경로만 더 열리고 부서 제출 목록·상세(/demand-submissions, /demand-submissions/<id>)는
  // 여전히 막힌다(부모 경로 권한에 EVENT_ORDER_APPROVE가 없다). 쓰기 폼은 화면이 SUPPLY_MEETING_INPUT·
  // DEMAND_CONSOLIDATE 여부로 따로 가리므로(app/(user)/demand-submissions/consolidation/page.tsx) 팀장에게는
  // 보이지 않는다.
  '/demand-submissions/consolidation': ['DEMAND_SUBMIT', 'PLAN_CONFIRM', 'DEMAND_CONSOLIDATE', 'SUPPLY_MEETING_INPUT', 'EVENT_ORDER_APPROVE'],
} as const satisfies Record<string, readonly Permission[]>;

export function requiredPermissionsForPath(pathname: string): readonly Permission[] | null {
  const matchedPath = Object.keys(WORK_ROUTE_PERMISSIONS)
    .filter((path) => pathname === path || pathname.startsWith(`${path}/`))
    .sort((left, right) => right.length - left.length)[0] as keyof typeof WORK_ROUTE_PERMISSIONS | undefined;
  return matchedPath ? WORK_ROUTE_PERMISSIONS[matchedPath] : null;
}

export const JOB_ROLES = ['SALES_REP', 'SCM_PLANNER', 'SCM_LEAD', 'BIZ_DEV', 'MARKETING', 'SERVICE'] as const;
export type JobRole = (typeof JOB_ROLES)[number];

export const JOB_ROLE_LABELS: Record<JobRole, string> = {
  SALES_REP: '영업담당자',
  SCM_PLANNER: 'SCM 품목담당자',
  SCM_LEAD: 'SCM팀장',
  BIZ_DEV: '사업강화부',
  MARKETING: '마케팅부',
  SERVICE: '서비스부',
};

export const DEPARTMENTS = ['SCM', 'SALES', 'MARKETING', 'SERVICE', 'BIZ_DEV'] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const DEPARTMENT_LABELS: Record<Department, string> = {
  SCM: 'SCM팀',
  SALES: '영업부',
  MARKETING: '마케팅부',
  SERVICE: '서비스부',
  BIZ_DEV: '사업강화부',
};

export function isJobRole(value: unknown): value is JobRole {
  return typeof value === 'string' && (JOB_ROLES as readonly string[]).includes(value);
}

export function jobRoleLabel(value: string | null): string {
  return isJobRole(value) ? JOB_ROLE_LABELS[value] : '미지정';
}

export function departmentLabel(value: string | null): string {
  return value !== null && (DEPARTMENTS as readonly string[]).includes(value)
    ? DEPARTMENT_LABELS[value as Department]
    : '미지정';
}

/**
 * 한 사용자의 권한 집합.
 *
 * ★ ADMIN 이라고 해서 업무 권한을 자동으로 주지 않습니다. 시스템 관리와 업무 결재는
 *   다른 축입니다 (stage1 §9). 관리자가 승인까지 하려면 직책을 함께 받아야 합니다.
 */
export class PermissionSet {
  private readonly granted: ReadonlySet<string>;

  constructor(codes: readonly string[]) {
    this.granted = new Set(codes);
  }

  has(code: Permission): boolean {
    return this.granted.has(code);
  }

  hasAny(...codes: Permission[]): boolean {
    return codes.some((code) => this.granted.has(code));
  }

  list(): string[] {
    return Array.from(this.granted).sort();
  }

  get size(): number {
    return this.granted.size;
  }
}
