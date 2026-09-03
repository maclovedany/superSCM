// 정보 접근 범위 — renew.prd 4.5 ★
//
// 영업은 조달 단가 · 발주 금액 · 공급처 상세 · 리드타임 통계 · 예측 정확도를 보지 않습니다.
//
//   | 항목                      | 영업 | SCM |
//   |---------------------------|:---:|:---:|
//   | 납기 가능 여부 · ATP       |  ○  |  ○  |
//   | 예상 입고일 · 대체품       |  ○  |  ○  |
//   | 현재고 상세 (창고별)       |총량만|  ○  |
//   | 조달 단가 · 발주 금액      |  ✕  |  ○  |
//   | 공급처 상세 · 리드타임 통계|  ✕  |  ○  |
//   | 발주 추천 · 승인           |  ✕  |  ○  |
//   | 예측 정확도 지표           |  ✕  |  ○  |
//
// 막는 방법은 두 겹입니다.
//   ① analytics.v_sales_* 뷰에 그 컬럼을 애초에 두지 않습니다 (sql/23-atp-sales.sql §9)
//   ② 그래도 이 파일이 **모든 툴 결과**를 한 번 더 훑어 지웁니다
//
// ②가 왜 필요한가. 영업 사용자는 SCM 툴을 부를 수 없지만(orchestrator 가 툴 집합을
// 나눕니다), 그 판정이 한 줄만 어긋나면 단가가 그대로 답변에 실립니다. 값을 지우는
// 일은 값을 보여주는 일보다 훨씬 싸므로 두 번 합니다.
//
// ★ 숫자를 지우는 것이 왜 중요한가 — Guardrail(lib/agent/guardrail.ts)은 툴이 준
//   numbers 안의 값만 답변에 허용합니다. 뒤집으면, numbers 에 단가가 남아 있으면
//   모델이 그 숫자를 인용해도 Guardrail 이 통과시킵니다. 그래서 data 뿐 아니라
//   numbers 까지 같은 규칙으로 훑습니다.
//
// 이 파일은 순수 함수만 둡니다. Supabase 도 fetch 도 부르지 않습니다 —
// lib/agent/redact.test.ts 가 그대로 실행하고, lib/auth.ts 도 여기서 판정을 가져갑니다.
// 상대 import 에 .ts 를 붙이는 이유는 error.md #17 입니다.

/**
 * 영업 부서인가 — renew.prd 4.1 "Role 은 향후 확장".
 *
 * 지금 Role 은 ADMIN · USER 둘뿐이라 영업 구분은 `core.app_user.department` 로 합니다.
 *
 *   ★ 규칙 — department 가 '영업' 으로 시작하거나 대문자로 'SALES' 를 포함하면 영업.
 *     '영업1팀' · '영업기획' · 'Sales Planning' · 'SALES'  → true
 *     '구매팀' · 'SCM' · 'Supply Chain' · null            → false
 *
 * 같은 규칙이 DB 에도 있습니다 — `core.is_sales()` (sql/23-atp-sales.sql §1).
 * 앱 쪽 구현은 이 함수 하나뿐이고, `lib/auth.ts` 의 `isSalesUser` 가 이것을 부릅니다.
 */
export function isSalesDepartment(department: string | null | undefined): boolean {
  const value = department?.trim();
  if (!value) return false;
  return value.startsWith('영업') || value.toUpperCase().includes('SALES');
}

/**
 * 이 사용자를 영업으로 볼 것인가 — 앱 전체의 단일 판정.
 *
 * 부서만 보는 `isSalesDepartment` 와 달리 **역할을 먼저 봅니다.**
 * renew.prd 4.2 가 ADMIN 을 "모든 USER 기능" 으로 정의하므로, 관리자에게서
 * 화면·메뉴·필드를 빼앗으면 그 정의가 깨집니다. 부서가 영업인 관리자는 영업이 아닙니다.
 *
 * 화면·메뉴는 `lib/auth.ts` 의 `isSalesUser` 를 거쳐 이 함수에 옵니다.
 * 판정을 여기 한 곳에 둔 이유는, 부르는 쪽마다 역할 검사를 따로 적으면
 * 언젠가 한 곳에서 빠뜨리기 때문입니다 (실제로 STEP 17 검토에서 그렇게 발견됐습니다).
 */
export function isSalesActor(user: RedactUser): boolean {
  if (user?.role === 'ADMIN') return false;
  return isSalesDepartment(user?.department);
}

/**
 * 키 이름을 견주기 좋게 다듬습니다.
 *
 * 뷰 컬럼(`unit_price`) · 앱 필드(`unitPrice`) · Guardrail 키(`ITEM012.unit_price`) 가
 * 모두 같은 값을 가리키므로, 글자와 숫자만 남기고 소문자로 눕혀 한 번에 봅니다.
 */
function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * 이름 어디에 들어 있어도 지우는 조각.
 *
 * `unit_price` · `recommended_amount` · `supplier_name` · `champion_wape` 처럼
 * 접두사가 붙어 오는 경우가 많아 부분 일치로 봅니다.
 */
const CONTAINS: string[] = [
  // 조달 단가 · 발주 금액
  'price',
  'amount',
  'cost',
  // 공급처 상세
  'supplier',
  'country',
  // 예측 정확도 지표
  'wape',
  'mape',
  'rmse',
  'bias',
  'accuracy',
  'baselineimprovement',
  'metricvalue',
  // 예측 오차 — 안전재고의 σ 는 정확도에서 나온 값입니다
  'sigma',
];

/**
 * 이름 끝이 일치하면 지우는 조각.
 *
 * 리드타임 **통계** 를 막고 적용 중인 리드타임(`lead_time` · `lead_time_used`)은 남깁니다 —
 * renew.prd 4.5 의 "예상 입고일 ○" 을 답하려면 필요합니다.
 *
 * ★ `lead_time_confidence` 는 **막습니다.** 처음에는 27.5 의 "다섯 번 중 한 번은 지연"
 *   안내에 필요하다고 보고 남겼는데, 그 값은 `core.v_leadtime_stat` 의 표본 수에서
 *   나온 등급입니다 (n_samples >= 30 → HIGH · >= 10 → MEDIUM · 그 밖 LOW).
 *   등급을 보여 주는 것은 표본 수를 반올림해 보여 주는 것과 같고, 4.5 는 리드타임
 *   통계를 영업에게 ✕ 로 둡니다. 지연 안내는 등급이 아니라 `delivery_buffer_days`
 *   (정책값)로 합니다 — 영업에게 필요한 것은 "며칠 여유를 두고 안내하라" 이지
 *   "표본이 얼마나 쌓였나" 가 아닙니다. DB 쪽도 같이 막았습니다
 *   (sql/23 의 analytics.v_atp 가 core.is_sales() 일 때 null 을 냅니다).
 */
const ENDS_WITH: string[] = [
  'p50days',
  'p80days',
  'p90days',
  'stddays',
  'stdleadtime',
  'leadtimesd',
  'leadtimeconfidence',
  'nsamples',
  'samplecount',
  'meandays',
  'maxdays',
  'avgordertoship',
  'avgshiptoreceive',
  'mae',
];

/** 이 키를 영업에게 보이지 않는가 */
export function isRedactedKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (normalized === '') return false;
  if (CONTAINS.some((part) => normalized.includes(part))) return true;
  return ENDS_WITH.some((part) => normalized.endsWith(part));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 값을 깊이 훑어 가릴 키를 통째로 뺍니다.
 *
 * null 로 바꾸지 않고 **키 자체를 없앱니다.** null 로 두면 화면과 모델이
 * "산출할 수 없는 값" 으로 읽습니다 (design.md §8.2). 영업에게 단가는 산출할 수 없는
 * 값이 아니라 **보여 주지 않기로 한 값**이고, 둘은 다릅니다.
 */
function stripDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripDeep);
  if (!isPlainObject(value)) return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (isRedactedKey(key)) continue;
    out[key] = stripDeep(child);
  }
  return out;
}

/** stripForSales 가 받는 최소한의 사용자 모양 */
export type RedactUser = {
  role?: 'ADMIN' | 'USER' | string | null;
  department?: string | null;
} | null | undefined;

/**
 * 영업 사용자에게 보이면 안 되는 필드를 지웁니다 — renew.prd 4.5.
 *
 * 영업이 아니면 **값을 그대로 돌려줍니다** (복사도 하지 않습니다). SCM 담당자의
 * 응답 경로에 아무 비용도 얹지 않으려는 것입니다.
 *
 * ★ 관리자는 부서가 영업이어도 가리지 않습니다. 관리자는 renew.prd 4.2 로
 *   모든 USER 기능을 갖고, 승인 로그·시스템 로그까지 봅니다. 부서로 관리자의
 *   권한을 좁히면 "관리자인데 화면마다 값이 다른" 상태가 됩니다.
 */
export function stripForSales<T>(value: T, user: RedactUser): T {
  if (!isSalesActor(user)) return value;
  return stripDeep(value) as T;
}

/**
 * 툴 결과 한 덩이를 가립니다.
 *
 * data 와 numbers 를 같은 규칙으로 훑습니다. numbers 를 빠뜨리면 Guardrail 이
 * 단가를 인용한 답변을 통과시킵니다 (파일 머리 주석).
 */
export function stripToolResult<
  T extends { data: unknown; numbers: Record<string, number | null> },
>(result: T, user: RedactUser): T {
  if (user?.role === 'ADMIN') return result;
  if (!isSalesDepartment(user?.department)) return result;

  const numbers: Record<string, number | null> = {};
  for (const [key, value] of Object.entries(result.numbers)) {
    if (isRedactedKey(key)) continue;
    numbers[key] = value;
  }

  return { ...result, data: stripDeep(result.data), numbers };
}
