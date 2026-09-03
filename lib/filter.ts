// KPI 카드 필터 — design.md §6.4
//
// 카드를 누르면 아래 목록이 그 카드의 데이터로 좁혀집니다.
// 상태를 URL 에 두는 이유 세 가지
//   1  화면이 서버 컴포넌트로 남습니다. 수만 행을 클라이언트로 내리지 않습니다
//   2  링크를 그대로 공유할 수 있습니다 ("위험 품목만 보세요")
//   3  뒤로 가기가 동작합니다

/** Next.js 15 의 page props.searchParams 모양 */
export type SearchParams = Record<string, string | string[] | undefined>;

export function readFilter(params: SearchParams | undefined, key = 'filter'): string | null {
  const value = params?.[key];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * 카드 링크 주소.
 *
 * 이미 켜진 카드를 다시 누르면 필터가 풀립니다.
 * 경로를 적지 않고 쿼리만 넘기면 현재 경로 기준으로 해석됩니다.
 */
export function filterHref(key: string, active: boolean, param = 'filter'): string {
  return active ? '?' : `?${param}=${encodeURIComponent(key)}`;
}

/** 필터 정의. 화면마다 이 배열 하나로 카드와 목록이 함께 움직입니다 */
export type FilterSpec<T> = {
  key: string;
  label: string;
  /** null 이면 전체입니다 */
  match: ((row: T) => boolean) | null;
};

export function applyFilter<T>(rows: T[], specs: FilterSpec<T>[], active: string | null): T[] {
  if (!active) return rows;
  const spec = specs.find((item) => item.key === active);
  if (!spec || !spec.match) return rows;
  return rows.filter(spec.match);
}

export function labelOf<T>(specs: FilterSpec<T>[], active: string | null): string | null {
  if (!active) return null;
  return specs.find((item) => item.key === active)?.label ?? null;
}
