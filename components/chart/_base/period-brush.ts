// 기간 브러시 — 시계열 차트 아래에 붙는 구간 선택.
//
// recharts 는 <Brush> 가 차트의 직접 자식이어야 알아봅니다. 감싼 컴포넌트는 무시되므로
// 여기서는 props 만 만들고, 각 차트가 `<Brush {...props} />` 를 직접 씁니다.
// 점이 8개 미만이면 브러시가 오히려 방해라 null 을 돌려줍니다 (spec §5).

import { CHART_TOKENS } from '@/lib/chart-colors';

export const BRUSH_MIN_POINTS = 8;

export function brushProps(count: number) {
  if (count < BRUSH_MIN_POINTS) return null;
  return {
    dataKey: 'period' as const,
    height: 22,
    travellerWidth: 8,
    stroke: CHART_TOKENS.axis,
    fill: 'rgba(0,0,0,0.02)',
  };
}
