import AnalysisFrame from '@/components/analysis/analysis-frame';
import DataTable, { formatNumber, type Column } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import { getLeadtimeGap } from '@/lib/scm';
import type { LeadtimeGap } from '@/lib/scm-model';

export const dynamic = 'force-dynamic';

function nullableNumber(value: number | null, suffix: string) { return value === null ? <EmptyValue reasonCode="CALCULATION_UNAVAILABLE" /> : formatNumber(value, suffix); }
function GapCell({ row }: { row: LeadtimeGap }) { if (row.gap === null) return <EmptyValue reasonCode="CALCULATION_UNAVAILABLE" />; const tone = row.gap > 0 ? 'text-danger' : 'text-good'; const sign = row.gap > 0 ? '+' : ''; return <span className={tone}>{sign}{formatNumber(row.gap, '일')}</span>; }

const columns: Column<LeadtimeGap>[] = [
  { key: 'supplier', label: '공급처' }, { key: 'country', label: '국가' },
  { key: 'masterLeadTime', label: '마스터', align: 'right', render: (r) => nullableNumber(r.masterLeadTime, '일') },
  { key: 'sampleCount', label: '표본수', align: 'right', render: (r) => r.sampleCount.toLocaleString() },
  { key: 'actualAverage', label: '실적평균', align: 'right', render: (r) => nullableNumber(r.actualAverage, '일') },
  { key: 'p80', label: 'P80', align: 'right', render: (r) => nullableNumber(r.p80, '일') },
  { key: 'gap', label: '격차', align: 'right', render: (r) => <GapCell row={r} /> },
];

export default async function LeadtimePage() {
  const { rows, error } = await getLeadtimeGap();
  if (error) return <AnalysisFrame title="리드타임 격차" description="공급처별 마스터 리드타임과 실제 실적을 비교합니다."><div className="card"><p className="text-danger">조회에 실패했습니다.</p><p className="muted">{error}</p></div></AnalysisFrame>;
  const nLonger = rows.filter((r) => r.gap !== null && r.gap > 0).length;
  const nLowSample = rows.filter((r) => r.sampleCount < 10).length;
  return <AnalysisFrame title="리드타임 격차" description="마스터 리드타임과 실제 실적 P80을 비교해 계획이 현실보다 짧게 잡혀 있는 공급처를 찾습니다."><div className="grid grid-3"><div className="card metric"><div className="metric-label">공급처</div><div className="metric-value">{rows.length}</div><div className="metric-foot">사용 중인 생산법인</div></div><div className="card metric"><div className="metric-label">실제가 더 김</div><div className="metric-value">{nLonger}</div><div className="metric-foot warn">격차 &gt; 0인 공급처</div></div><div className="card metric"><div className="metric-label">표본 부족</div><div className="metric-value">{nLowSample}</div><div className="metric-foot">표본 10건 미만</div></div></div><div className="section card"><div className="card-title"><div><h3>공급처별 리드타임</h3><span>격차 = P80 − 마스터</span></div></div><DataTable columns={columns} rows={rows} rowKey={(r, i) => `${r.supplier}-${i}`} empty="데이터가 없습니다. Exposed schemas와 analytics.v_leadtime_gap을 확인하세요." /></div></AnalysisFrame>;
}

