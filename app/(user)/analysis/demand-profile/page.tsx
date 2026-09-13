import AnalysisFrame from '@/components/analysis/analysis-frame';
import DemandProfileTable from '@/components/analysis/demand-profile-table';
import ChartEmpty from '@/components/charts/chart-empty';
import DemandSeriesChart from '@/components/charts/demand-series-chart';
import ShipmentItemChart from '@/components/charts/shipment-item-chart';
import EmptyValue from '@/components/ui/empty-value';
import KpiCard from '@/components/ui/kpi-card';
import PracticeDataBanner from '@/components/ui/practice-banner';
import { getDemandSeries, getShipmentMonthlyByItem } from '@/lib/analytics/repository';
import { demandSeriesItems } from '@/lib/charts/demand-series';
import { demandProfileKpiCounts } from '@/lib/demand-profile';
import { getPracticeDataStatus, getPracticeItemIds } from '@/lib/practice/repository';
import { getItemDemandKpi, getItemDemandProfiles } from '@/lib/scm';

export const dynamic = 'force-dynamic';

const TITLE = '수요 패턴';
const DESCRIPTION = '출고 실적으로 품목의 수요 성격을 분류합니다. 관측 6개월 미만은 유형을 추정하지 않습니다.';

export default async function DemandProfilePage({
  searchParams,
}: {
  searchParams: Promise<{ shipItem?: string }>;
}) {
  const params = await searchParams;
  const shipItem = typeof params.shipItem === 'string' && params.shipItem.trim() !== '' ? params.shipItem.trim() : null;

  const [
    { rows, total, error },
    { rows: kpiRows },
    { rows: seriesRows, error: seriesError },
    { status: practiceStatus },
    practiceItemIds,
  ] = await Promise.all([
    getItemDemandProfiles(),
    getItemDemandKpi(),
    getDemandSeries(),
    getPracticeDataStatus(),
    getPracticeItemIds(),
  ]);

  // ★ 품목 지정 조회다 — v_shipment_monthly_item 은 102,765행(2026-09-13 실측)이라 필터 없는
  //   조회를 애초에 제공하지 않는다. 품목을 고르기 전에는 조회 자체를 하지 않는다.
  const shipment = shipItem === null ? { rows: [], error: null } : await getShipmentMonthlyByItem(shipItem);

  if (error) {
    return (
      <AnalysisFrame title={TITLE} description={DESCRIPTION}>
        <div className="card">
          <p className="text-danger">조회에 실패했습니다.</p>
          <p className="muted">{error}</p>
        </div>
      </AnalysisFrame>
    );
  }

  // ★ 세 카드는 모두 집계 뷰 analytics.v_item_demand_kpi 에서 옵니다 — 같은 줄의 수를 서로
  //   다른 것에서 세면 분모가 분자보다 작아집니다. 예전에는 "분석 품목" 만 받아 온 배열의
  //   길이(1,000행에서 잘린 값)였습니다. 합산은 lib/demand-profile.ts 가 합니다.
  const { itemCount, croston, unknown } = demandProfileKpiCounts(kpiRows);
  const dataAsOf = rows.find((row) => row.dataAsOf)?.dataAsOf ?? '—';

  const countOrEmpty = (value: number | null) =>
    value === null ? <EmptyValue reasonCode="COUNT_UNAVAILABLE" /> : value.toLocaleString('ko-KR');

  // ★ v_demand_series 의 품목이 **전부 실습 품목**이면 실습 배너를 함께 보인다.
  //   실측 2026-09-13: 이 뷰의 품목 10개가 모두 analytics.v_practice_item(11개)에 있고,
  //   아래 표(v_item_demand_profile 10,198품목)와는 **겹치는 품목이 하나도 없다.**
  //   숫자가 보이는 화면에는 그 출처가 함께 있어야 한다(lib/practice/model.ts).
  const seriesItems = demandSeriesItems(seriesRows);
  const seriesIsPractice =
    seriesItems.length > 0 && seriesItems.every((item) => practiceItemIds.has(item.itemId));
  const showSeriesPractice = seriesIsPractice && practiceStatus !== null && practiceStatus.hasPracticeData;

  return (
    <AnalysisFrame title={TITLE} description={DESCRIPTION}>
      <div className="grid grid-4">
        <KpiCard label="분석 품목" value={countOrEmpty(itemCount)} foot="출고 실적이 있는 품목" />
        <KpiCard label="Croston 후보" value={countOrEmpty(croston)} foot="INTERMITTENT · LUMPY" status="WARNING" />
        <KpiCard label="유형 판정 불가" value={countOrEmpty(unknown)} foot="관측 기간 부족" status="CALCULATION_UNAVAILABLE" />
        <KpiCard label="데이터 기준월" value={dataAsOf} foot="출고 실적 최종월" status="SAFE" />
      </div>

      <div className="section card">
        <div className="card-title">
          <div>
            <h3>수요 실적 vs 예측</h3>
            <span>Champion 모델 예측과 p80 · p90 구간. 값이 없는 달은 선을 잇지 않습니다.</span>
          </div>
        </div>
        {showSeriesPractice && practiceStatus !== null ? <PracticeDataBanner status={practiceStatus} /> : null}
        {seriesIsPractice ? (
          <p className="muted">
            이 차트의 품목은 실습 묶음의 품목이며, <b>아래 품목별 수요 성격 표에는 들어 있지 않습니다</b> — 두 표는 서로 다른
            품목 집합입니다.
          </p>
        ) : null}
        {seriesError ? (
          <p className="text-danger">수요 시계열을 불러오지 못했습니다: {seriesError}</p>
        ) : (
          <DemandSeriesChart points={seriesRows} />
        )}
      </div>

      <div className="section card">
        <div className="card-title">
          <div>
            <h3>품목별 출고 추이</h3>
            <span>품목코드를 지정해야 조회합니다. 출고 기록이 없는 달은 선을 잇지 않습니다.</span>
          </div>
        </div>
        {/* ★ 서버 컴포넌트로 두려고 GET 폼을 쓴다. 목록에 없는 코드도 직접 칠 수 있다 —
            거르기를 DB 가 하므로 받아 온 1,000행 밖의 품목도 조회된다. */}
        <form className="chart-controls" method="get">
          <label htmlFor="shipItem">품목코드</label>
          <input
            id="shipItem"
            name="shipItem"
            className="form-input"
            list="demand-profile-item-codes"
            defaultValue={shipItem ?? ''}
            placeholder="예: VC7161"
          />
          <datalist id="demand-profile-item-codes">
            {rows.map((row) => (
              <option key={row.itemCode} value={row.itemCode} />
            ))}
          </datalist>
          <button className="button primary" type="submit">
            조회
          </button>
        </form>
        {shipItem === null ? (
          <ChartEmpty message="품목코드를 지정하면 월별 출고 추이를 그립니다." />
        ) : shipment.error ? (
          <p className="text-danger">품목별 출고를 불러오지 못했습니다: {shipment.error}</p>
        ) : (
          <ShipmentItemChart rows={shipment.rows} itemCode={shipItem} />
        )}
      </div>

      <DemandProfileTable rows={rows} total={total} />
    </AnalysisFrame>
  );
}
