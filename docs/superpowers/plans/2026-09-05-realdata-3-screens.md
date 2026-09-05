# 실데이터 전환 — Plan 3 (화면)

> 스펙 `docs/superpowers/specs/2026-09-05-realdata-cutover-design.md` §7. 구현 완료 (2026-09-05).

| 파일 | 일 |
|---|---|
| `lib/items.ts` · `items-model.ts`(+test) | `searchItems`(대표코드 · 이름 · 구코드) · `getItem`(구코드 → 대표코드) · `getDataAvailability` |
| `components/ui/item-search-panel.tsx` | GET 폼 + 결과 칩. 자바스크립트 없이 동작 |
| `components/ui/data-wait-banner.tsx` | `analytics.v_data_availability` 의 0행 종류를 문장으로 |
| `lib/machines.ts` · `machines-model.ts` | 기종 목록 · OL/실적 · BOM 표 · `v_demand_compare` |
| `app/(user)/machine-forecast/page.tsx` | 기종 차트(act · 영업 OL · SCM OL · 모델 · Champion 밴드) + 구성품 표 |
| `app/(user)/model-comparison/page.tsx` | 검색 패널 · 어떤 대표코드든 `?item=` · 종속수요 시리즈 |
| `app/(user)/forecast/page.tsx` · `lib/forecast.ts` | 검색어 · 상한 200 |
| `inventory-projection` · `what-if` | 검색 패널 + 배너 |
| 재고 없는 8화면 | `DataWaitBanner` |
| `lib/import/schema.ts` · 업로드 폼 · `lib/api/handler.ts` | DEMAND · ITEM_MASTER retired, 재고 계열 pending(501) |
| `lib/menu.ts` | `/machine-forecast` |

## 스펙과 다른 점
- 재고 전개 · 재고 소진 위험의 7화면 배너 외에 **리드타임 격차**에도 배너를 붙였습니다(리드타임 실적이 없어 0행).
