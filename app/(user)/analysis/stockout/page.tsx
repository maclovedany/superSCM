import AnalysisFrame from '@/components/analysis/analysis-frame';
import Badge from '@/components/ui/badge';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import KpiCard from '@/components/ui/kpi-card';
import { getStockoutKpi, getStockoutRisks } from '@/lib/scm';
import type { StockoutRisk } from '@/lib/scm-model';

export const dynamic = 'force-dynamic';
function nullableNumber(value: number | null, suffix: string, reason?: StockoutRisk['reason']) { return value === null ? <EmptyValue reasonCode={reason ?? 'CALCULATION_UNAVAILABLE'} /> : formatNumber(value, suffix); }
function RiskStatusCell({ status }: { status: StockoutRisk['riskStatus'] }) { if (status === 'CRITICAL') return <Badge status="CRITICAL" />; if (status === 'SAFE') return <Badge status="SAFE" />; return <Badge status="CALCULATION_UNAVAILABLE" />; }
function dateLabel(value: string | null) { return value ? value.replace(/^\d{4}-/, '').replace('-', '.') : <EmptyValue reasonCode="CALCULATION_UNAVAILABLE" />; }

const columns: Column<StockoutRisk>[] = [
  { key: 'itemName', label: '품목', render: (row) => <><b>{row.itemName}</b><br /><span className="muted">{row.itemId}</span></> },
  { key: 'supplierId', label: '공급처' },
  { key: 'availableQty', label: '가용재고', align: 'right', render: (row) => nullableNumber(row.availableQty, ' EA') },
  { key: 'dailyUsageAvg', label: '일평균 사용량', align: 'right', render: (row) => nullableNumber(row.dailyUsageAvg, ' EA', row.reason) },
  { key: 'stockoutDays', label: '소진예상일수', align: 'right', render: (row) => nullableNumber(row.stockoutDays, '일', row.reason) },
  { key: 'stockoutDate', label: '소진예상일', align: 'center', render: (row) => dateLabel(row.stockoutDate) },
  { key: 'plannedLeadTime', label: '계획 리드타임', align: 'right', render: (row) => nullableNumber(row.plannedLeadTime, '일', row.reason) },
  { key: 'riskStatus', label: '위험상태', align: 'center', render: (row) => <RiskStatusCell status={row.riskStatus} /> },
  { key: 'reason', label: '판정 사유', render: (row) => row.reason ? <EmptyValue reasonCode={row.reason} /> : <span className="muted">—</span> },
];

export default async function StockoutPage() {
  const [{ rows, error: rowsError }, { data: kpi, error: kpiError }] = await Promise.all([getStockoutRisks(), getStockoutKpi()]);
  const error = rowsError ?? kpiError;
  if (error) return <AnalysisFrame title="재고 소진 위험" description="가용재고와 일평균 사용량을 기준으로 계획 리드타임 내 소진 위험 품목을 확인합니다."><div className="card"><p className="text-danger">조회에 실패했습니다.</p><p className="muted">{error}</p></div></AnalysisFrame>;
  return <AnalysisFrame title="재고 소진 위험" description="가용재고와 일평균 사용량을 기준으로 계획 리드타임 내 소진 위험 품목을 확인합니다."><div className="grid grid-4"><KpiCard label="분석 품목" value={kpi?.itemCount ?? rows.length} foot="재고 소진 분석 대상" /><KpiCard label="위험 품목" value={kpi?.criticalCount ?? rows.filter((r) => r.riskStatus === 'CRITICAL').length} foot="계획 리드타임 내 소진" status="CRITICAL" /><KpiCard label="30일 이내 소진" value={kpi?.within30DaysCount ?? 0} foot="우선 확인 대상" status="WARNING" /><KpiCard label="판정 불가" value={kpi?.unknownCount ?? rows.filter((r) => r.riskStatus === 'UNKNOWN').length} foot="사용량·리드타임 확인 필요" status="CALCULATION_UNAVAILABLE" /></div><div className="section card"><div className="card-title"><div><h3>품목별 소진 위험</h3><span>소진예상일수 = 가용재고 ÷ 일평균 사용량</span></div><Badge status="SAFE">안전 {kpi?.safeCount ?? 0}건</Badge></div><DataTable columns={columns} rows={rows} rowKey={(row) => row.itemId} empty="데이터가 없습니다. Exposed schemas와 analytics.v_stockout_risk를 확인하세요." /></div></AnalysisFrame>;
}

