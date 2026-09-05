'use client';

// 업로드 화면 본체 — renew.prd 8.1
//
// 파일 선택 → 파싱·검증(서버) → 미리보기 → 확인 → 적재
// 검증 결과를 보기 전에는 적재 버튼이 뜨지 않습니다.

import { useActionState, useState } from 'react';
import { CheckCircle2, FileUp, TriangleAlert, UploadCloud } from 'lucide-react';
import Panel from '@/components/ui/panel';
import Badge from '@/components/ui/badge';
import { analyzeUpload, cancelImport, confirmImport } from './actions';
import { EMPTY_COMMIT, EMPTY_PREVIEW } from './state';
import { AVAILABLE_DATA_TYPES, DATA_TYPES, DATA_TYPE_AVAILABILITY, TABLE_SPECS, availabilityNote } from '@/lib/import/schema';
import type { DataType } from '@/lib/import/types';

export default function UploadForm({ targetColumnsByType }: { targetColumnsByType: Record<string, string[]> }) {
  const [preview, analyze, analyzing] = useActionState(analyzeUpload, EMPTY_PREVIEW);
  const [commit, doCommit, committing] = useActionState(confirmImport, EMPTY_COMMIT);
  const [cancel, doCancel, cancelling] = useActionState(cancelImport, EMPTY_COMMIT);
  const [dataType, setDataType] = useState<DataType>(AVAILABLE_DATA_TYPES[0] ?? 'EVENT');
  const [mode, setMode] = useState('append');
  const [filename, setFilename] = useState('');

  const spec = TABLE_SPECS[dataType];
  const done = commit.message || cancel.message;
  const staged = preview.batchId && !done;

  return (
    <>
      <Panel title="1. 파일 올리기">
        <form action={analyze} style={{ display: 'grid', gap: 'var(--s-5)' }}>
          <div className="grid grid-3">
            <div className="field">
              <label className="t-label" htmlFor="dataType">
                데이터 종류
              </label>
              <select
                id="dataType"
                name="dataType"
                className="select"
                value={dataType}
                onChange={(event) => setDataType(event.target.value as DataType)}
              >
                {DATA_TYPES.map((type) => (
                  <option key={type} value={type} disabled={DATA_TYPE_AVAILABILITY[type] !== 'active'}>
                    {TABLE_SPECS[type].label}
                    {DATA_TYPE_AVAILABILITY[type] === 'retired' ? ' — 실데이터 경로로 대체' : DATA_TYPE_AVAILABILITY[type] === 'pending' ? ' — 형식 확정 대기' : ''}
                  </option>
                ))}
              </select>
            </div>

            {availabilityNote(dataType) && (
              <p className="t-sm text-2" style={{ gridColumn: '1 / -1', margin: 0 }}>{availabilityNote(dataType)}</p>
            )}

            <div className="field">
              <label className="t-label" htmlFor="mode">
                적재 방식
              </label>
              <select
                id="mode"
                name="mode"
                className="select"
                value={mode}
                onChange={(event) => setMode(event.target.value)}
              >
                <option value="append">추가 — 기존 유지 + 신규 추가</option>
                <option value="upsert">갱신 — 키가 같으면 바꾸고 없으면 추가</option>
                <option value="replace" disabled={!spec.periodField}>
                  기간 교체 — 대상 기간 삭제 후 적재
                </option>
              </select>
            </div>

            <div className="field">
              <label className="t-label" htmlFor="file">
                파일
              </label>
              <label className="dropzone" htmlFor="file">
                <UploadCloud size={16} aria-hidden />
                <span className="t-sm">{filename || 'CSV · Excel · JSON 을 선택하세요'}</span>
                <input
                  id="file"
                  name="file"
                  type="file"
                  accept=".csv,.txt,.xlsx,.xls,.json"
                  onChange={(event) => setFilename(event.target.files?.[0]?.name ?? '')}
                  style={{ display: 'none' }}
                />
              </label>
            </div>
          </div>

          {mode === 'replace' && spec.periodField && (
            <div className="grid grid-2">
              <div className="field">
                <label className="t-label" htmlFor="periodFrom">
                  삭제할 기간 시작 ({spec.periodField})
                </label>
                <input id="periodFrom" name="periodFrom" type="date" required />
              </div>
              <div className="field">
                <label className="t-label" htmlFor="periodTo">
                  삭제할 기간 종료
                </label>
                <input id="periodTo" name="periodTo" type="date" required />
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
            <button type="submit" className="btn primary lg" disabled={analyzing}>
              <FileUp size={15} aria-hidden />
              {analyzing ? '검증하는 중…' : '검증하기'}
            </button>
            <span className="t-sm text-3">
              적재 대상 — <span className="t-code">raw.{spec.targetTable}</span> ·{' '}
              {targetColumnsByType[dataType]?.length ?? 0}개 컬럼
            </span>
          </div>

          {preview.error && (
            <p className="login-error" role="alert">
              <TriangleAlert size={14} aria-hidden />
              {preview.error}
            </p>
          )}
        </form>
      </Panel>

      {staged && preview.counts && (
        <>
          <Panel title="2. 검증 결과" actions={<span className="t-code">{preview.batchId}</span>}>
            <div className="grid grid-kpi" style={{ marginBottom: 'var(--s-5)' }}>
              <Count label="전체" value={preview.counts.total} />
              <Count label="정상" value={preview.counts.success} tone="safe" />
              <Count label="경고" value={preview.counts.warning} tone="warn" />
              <Count label="오류" value={preview.counts.error} tone="crit" />
            </div>

            <h3 className="t-h3" style={{ marginBottom: 'var(--s-3)' }}>
              컬럼 매핑
            </h3>
            <div className="mapping-list">
              {preview.columns.map((column) => (
                <span key={column} className="mapping-item">
                  <b>{column}</b>
                  <span className="text-3">→</span>
                  {preview.mapping[column] ? (
                    <span className="t-code">{preview.mapping[column]}</span>
                  ) : (
                    <span className="text-3">사용 안 함</span>
                  )}
                </span>
              ))}
            </div>

            {preview.issues.length > 0 && (
              <>
                <h3 className="t-h3" style={{ margin: 'var(--s-5) 0 var(--s-3)' }}>
                  오류 상세 <span className="text-3">(최대 50건)</span>
                </h3>
                <div className="alert-list">
                  {preview.issues.map((issue, index) => (
                    <div
                      key={`${issue.rowNumber}-${issue.code}-${index}`}
                      className={`alert-row ${issue.severity === 'ERROR' ? 'crit' : 'warn'}`}
                    >
                      <div className="alert-row-head">
                        <span className="alert-row-type">
                          {issue.rowNumber === 0 ? '파일' : `${issue.rowNumber}행`}
                        </span>
                        <Badge tone={issue.severity === 'ERROR' ? 'crit' : 'warn'}>{issue.code}</Badge>
                      </div>
                      <p className="alert-row-body">{issue.message}</p>
                    </div>
                  ))}
                </div>
              </>
            )}
          </Panel>

          <Panel title="3. 적재">
            <p className="t-sm text-2" style={{ marginBottom: 'var(--s-4)' }}>
              오류가 있는 행은 적재하지 않습니다. 임의로 보정하지 않으므로, 고쳐서 다시 올려야 합니다.
              지금 적재하면 <b>{preview.counts.success.toLocaleString()}행</b>이 들어갑니다.
            </p>
            <div style={{ display: 'flex', gap: 'var(--s-2)', alignItems: 'center' }}>
              <form action={doCommit}>
                <input type="hidden" name="batchId" value={preview.batchId ?? ''} />
                <button
                  type="submit"
                  className="btn primary lg"
                  disabled={committing || preview.counts.success === 0}
                >
                  {committing ? '적재하는 중…' : `${preview.counts.success.toLocaleString()}행 적재`}
                </button>
              </form>
              <form action={doCancel}>
                <input type="hidden" name="batchId" value={preview.batchId ?? ''} />
                <button type="submit" className="btn secondary lg" disabled={cancelling}>
                  취소
                </button>
              </form>
              {preview.counts.error > 0 && (
                <a className="btn outlined lg" href={`/api/import/errors/${preview.batchId}`}>
                  오류 {preview.counts.error}건 내려받기
                </a>
              )}
            </div>
            {commit.error && (
              <p className="login-error" role="alert" style={{ marginTop: 'var(--s-4)' }}>
                <TriangleAlert size={14} aria-hidden />
                {commit.error}
              </p>
            )}
          </Panel>
        </>
      )}

      {done && (
        <div className="insight">
          <div className="insight-head">
            <CheckCircle2 size={14} aria-hidden />
            완료
          </div>
          <div className="insight-body">
            {commit.message ?? cancel.message} 적재 이력은{' '}
            <a href="/admin/data/history" style={{ color: 'var(--info-fg)' }}>
              적재 이력
            </a>{' '}
            에서 확인하고 되돌릴 수 있습니다.
          </div>
        </div>
      )}
    </>
  );
}

function Count({ label, value, tone }: { label: string; value: number; tone?: 'safe' | 'warn' | 'crit' }) {
  const color =
    tone === 'safe'
      ? 'var(--safe-fg)'
      : tone === 'warn'
        ? 'var(--warn-fg)'
        : tone === 'crit'
          ? 'var(--crit-fg)'
          : 'var(--text-1)';
  return (
    <div className="rail-tile">
      <span className="rail-tile-label">{label}</span>
      <span className="rail-tile-value" style={{ color }}>
        {value.toLocaleString()}
      </span>
    </div>
  );
}
