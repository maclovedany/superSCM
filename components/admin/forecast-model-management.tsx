'use client';

import { useActionState } from 'react';
import Button from '@/components/ui/button';
import Badge from '@/components/ui/badge';
import type { ForecastModelConfig } from '@/lib/scm-model';
import { updateForecastModelAction, type ForecastActionState } from '@/app/(admin)/admin/forecast-runs/actions';

const initialState: ForecastActionState = { error: null, success: null };

export default function ForecastModelManagement({ rows }: { rows: ForecastModelConfig[] }) {
  const [state, action, pending] = useActionState(updateForecastModelAction, initialState);
  return <>{state.error ? <p className="form-error" role="alert">{state.error}</p> : null}{state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    <div className="analysis-table-wrap"><table className="analysis-table"><thead><tr><th>모델명</th><th>Family</th><th>Engine</th><th>Version</th><th>적용 수요 유형</th><th>Parameters</th><th>상태</th></tr></thead><tbody>{rows.map((row) => <tr key={row.modelId}><td><strong>{row.modelName}</strong><br /><span className="muted">{row.modelId}</span></td><td>{row.family}</td><td>{row.engine}</td><td>{row.version}</td><td>{row.applicableDemandType.join(', ') || '—'}</td><td><code>{JSON.stringify(row.parameters)}</code></td><td><form action={action} className="user-edit-form"><input type="hidden" name="modelId" value={row.modelId} /><select className="table-select" name="enabled" defaultValue={String(row.enabled)} aria-label={`${row.modelName} 상태`}><option value="true">Enabled</option><option value="false">Disabled</option></select><Badge status={row.enabled ? 'SAFE' : 'CALCULATION_UNAVAILABLE'}>{row.enabled ? '사용' : '중지'}</Badge><Button type="submit" disabled={pending}>{pending ? '저장 중…' : '저장'}</Button></form></td></tr>)}</tbody></table></div>
  </>;
}
