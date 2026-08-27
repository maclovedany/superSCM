import AnalysisFrame from '@/components/analysis/analysis-frame';
import DataTable, { formatNumber, type Column } from '@/components/analysis/data-table';
import { getStockoutKpi, getStockoutRisks } from '@/lib/scm';
import type { StockoutRisk } from '@/lib/scm-model';

export const dynamic = 'force-dynamic';

const reasonLabels: Record<NonNullable<StockoutRisk['reason']>, string> = {
  NO_USAGE: '사용 이력 없음',
  NO_LEADTIME: '계획 리드타임 없음',
};

function RiskStatusCell({ status }: { status: StockoutRisk['riskStatus'] }) {
  if (status === 'CRITICAL') return <span className="tag red">위험</span>;
  if (status === 'SAFE') return <span className="tag green">안전</span>;
  return <span className="tag gray">판정불가</span>;
}

function dateLabel(value: string | null) {
  if (!value) return '—';
  return value.replace(/^\d{4}-/, '').replace('-', '.');
}

const columns: Column<StockoutRisk>[] = [
  {
    key: 'itemName',
    label: '품목',
    render: (row) => (
      <>
        <b>{row.itemName}</b>
        <br />
        <span className="muted">{row.itemId}</span>
      </>
    ),
  },
  { key: 'supplierId', label: '공급처' },
  {
    key: 'availableQty',
    label: '가용재고',
    align: 'right',
    render: (row) => formatNumber(row.availableQty, ' EA'),
  },
  {
    key: 'dailyUsageAvg',
    label: '일평균 사용량',
    align: 'right',
    render: (row) => formatNumber(row.dailyUsageAvg, ' EA'),
  },
  {
    key: 'stockoutDays',
    label: '소진예상일수',
    align: 'right',
    render: (row) => formatNumber(row.stockoutDays, '일'),
  },
  {
    key: 'stockoutDate',
    label: '소진예상일',
    align: 'center',
    render: (row) => dateLabel(row.stockoutDate),
  },
  {
    key: 'plannedLeadTime',
    label: '계획 리드타임',
    align: 'right',
    render: (row) => formatNumber(row.plannedLeadTime, '일'),
  },
  {
    key: 'riskStatus',
    label: '위험상태',
    align: 'center',
    render: (row) => <RiskStatusCell status={row.riskStatus} />,
  },
  {
    key: 'reason',
    label: '판정 사유',
    render: (row) => row.reason ? reasonLabels[row.reason] : <span className="muted">—</span>,
  },
];

export default async function StockoutPage() {
  const [{ rows, error: rowsError }, { data: kpi, error: kpiError }] = await Promise.all([
    getStockoutRisks(),
    getStockoutKpi(),
  ]);
  const error = rowsError ?? kpiError;

  if (error) {
    return (
      <AnalysisFrame
        title="재고 소진 위험"
        description="가용재고와 일평균 사용량을 기준으로 계획 리드타임 내 소진 위험 품목을 확인합니다."
      >
        <div className="card">
          <p className="text-danger">조회에 실패했습니다.</p>
          <p className="muted">{error}</p>
        </div>
      </AnalysisFrame>
    );
  }

  return (
    <AnalysisFrame
      title="재고 소진 위험"
      description="가용재고와 일평균 사용량을 기준으로 계획 리드타임 내 소진 위험 품목을 확인합니다."
    >
      <div className="grid grid-4">
        <div className="card metric">
          <div className="metric-label">분석 품목</div>
          <div className="metric-value">{kpi?.itemCount ?? rows.length}</div>
          <div className="metric-foot">재고 소진 분석 대상</div>
        </div>
        <div className="card metric">
          <div className="metric-label">위험 품목</div>
          <div className="metric-value">{kpi?.criticalCount ?? 0}</div>
          <div className="metric-foot danger">계획 리드타임 내 소진</div>
        </div>
        <div className="card metric">
          <div className="metric-label">30일 이내 소진</div>
          <div className="metric-value">{kpi?.within30DaysCount ?? 0}</div>
          <div className="metric-foot warn">우선 확인 대상</div>
        </div>
        <div className="card metric">
          <div className="metric-label">판정 불가</div>
          <div className="metric-value">{kpi?.unknownCount ?? 0}</div>
          <div className="metric-foot">사용량·리드타임 확인 필요</div>
        </div>
      </div>

      <div className="section card">
        <div className="card-title">
          <div>
            <h3>품목별 소진 위험</h3>
            <span>소진예상일수 = 가용재고 ÷ 일평균 사용량</span>
          </div>
          <span className="tag gray">안전 {kpi?.safeCount ?? 0}건</span>
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(row) => row.itemId}
          empty="데이터가 없습니다. Exposed schemas 와 analytics.v_stockout_risk 를 확인하세요."
        />
      </div>
    </AnalysisFrame>
  );
}
