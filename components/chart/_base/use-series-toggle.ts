'use client';

import { useCallback, useState } from 'react';

/** 범례 칩을 눌러 시리즈를 숨깁니다. 재조회하지 않습니다 (renew.prd 16.5) */
export function useSeriesToggle(_ids: string[]) {
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const visible = useCallback((id: string) => !hidden.has(id), [hidden]);
  return { hidden, toggle, visible };
}
