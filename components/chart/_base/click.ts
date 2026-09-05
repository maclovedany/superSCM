// recharts 3 의 Bar · Scatter onClick 첫 인자는 버전에 따라 행 데이터 자체이거나
// { payload: 행 } 입니다. 어느 쪽이든 행을 돌려줍니다.
export function clickedPayload<T>(entry: unknown): T | null {
  if (!entry || typeof entry !== 'object') return null;
  const wrapped = entry as { payload?: T };
  return wrapped.payload ?? (entry as T);
}

/**
 * 서버 컴포넌트는 클라이언트 차트에 함수를 넘길 수 없습니다 (React Server Components 직렬화 규칙).
 * 그래서 이동 주소는 `{id}` 자리표시자를 둔 문자열 템플릿으로 받고, 여기서 채웁니다.
 *   fillHref('/model-comparison?item={id}', 'ITEM 01') → '/model-comparison?item=ITEM%2001'
 */
export function fillHref(template: string, id: string): string {
  return template.replace('{id}', encodeURIComponent(id));
}
