// recharts 3 의 Bar · Scatter onClick 첫 인자는 버전에 따라 행 데이터 자체이거나
// { payload: 행 } 입니다. 어느 쪽이든 행을 돌려줍니다.
export function clickedPayload<T>(entry: unknown): T | null {
  if (!entry || typeof entry !== 'object') return null;
  const wrapped = entry as { payload?: T };
  return wrapped.payload ?? (entry as T);
}
