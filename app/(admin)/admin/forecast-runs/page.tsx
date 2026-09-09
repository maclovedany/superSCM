import PageHeader from '@/components/shell/page-header';
import ForecastRunTrigger from '@/components/admin/forecast-run-trigger';
import Panel from '@/components/ui/panel';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import { getForecastRuns } from '@/lib/scm';

export const dynamic = 'force-dynamic';

function statusTone(status: 'RUNNING' | 'SUCCESS' | 'FAILED') { return status === 'SUCCESS' ? 'SAFE' : status === 'FAILED' ? 'CRITICAL' : 'WARNING' as const; }

export default async function ForecastRunsPage() {
  const { rows, error } = await getForecastRuns();
  return <section className="analysis-page"><PageHeader eyebrow="ADMIN" title="Forecast Runs" description="저장된 SQL Baseline 결과를 실행 단위로 관리합니다." /><Panel title="새 Forecast 실행" description="활성 설정과 활성 SQL 모델의 버전을 snapshot으로 저장합니다."><ForecastRunTrigger /></Panel><Panel title="실행 이력" description="최근 50건">{error ? <><p className="text-danger">실행 이력을 조회하지 못했습니다.</p><p className="muted">{error}</p></> : <div className="analysis-table-wrap"><table className="analysis-table"><thead><tr><th>Run ID</th><th>상태</th><th>실행 시간</th><th>모델</th><th>SKU</th><th>결과 행</th><th>Data Snapshot</th><th>Stale</th><th>실행자</th></tr></thead><tbody>{rows.map((row) => <tr key={row.runId}><td><code>{row.runId}</code></td><td><Badge status={statusTone(row.status)}>{row.status}</Badge></td><td>{row.durationMs === null ? <EmptyValue reasonCode="RUNNING" /> : `${row.durationMs}ms`}</td><td>{row.nModels}</td><td>{row.nItems}</td><td>{row.nRows}</td><td>{row.dataSnapshotAt ?? <EmptyValue reasonCode="SNAPSHOT_UNAVAILABLE" />}</td><td><Badge status={row.isStale ? 'WARNING' : 'SAFE'}>{row.isStale ? 'STALE' : 'CURRENT'}</Badge></td><td>{row.triggeredEmail ?? '—'}</td></tr>)}</tbody></table></div>}</Panel></section>;
}
