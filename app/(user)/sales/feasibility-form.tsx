'use client';

// 빠른 확인 — renew.prd 27.5
//
//   품목 · 수량 · 납기 → [확인] → 판정 카드 → [가예약]
//
// 두 단계로 나눈 것은 일부러입니다. 확인은 읽기만 하고, 예약은 실제로 재고를 잡습니다
// (renew.prd 27.6). 한 버튼으로 묶으면 "물어보기만 했는데 재고가 잠기는" 일이 생깁니다.
//
// 계산은 하지 않습니다. 서버 액션이 core.check_order_feasibility 를 부르고,
// 이 컴포넌트는 그 결과를 그리기만 합니다 (AGENTS.md 규칙 2).

import { useActionState } from 'react';
import { CalendarCheck, Lock, TriangleAlert } from 'lucide-react';
import Badge from '@/components/ui/badge';
import EmptyValue from '@/components/ui/empty-value';
import {
  FEASIBILITY_LABEL,
  FEASIBILITY_TONE,
  type Feasibility,
} from '@/lib/atp-model';
import { checkFeasibility, reserveAllocation } from './actions';
import { EMPTY_FEASIBILITY } from './state';

function Tile({
  label,
  value,
  unit,
  note,
}: {
  label: string;
  value: number | string | null;
  unit?: string;
  note?: string | null;
}) {
  return (
    <div className="rail-tile">
      <span className="rail-tile-label">{label}</span>
      <span className="rail-tile-value">
        {value === null ? (
          <EmptyValue showLabel={false} />
        ) : (
          <>
            {typeof value === 'number' ? value.toLocaleString('ko-KR') : value}
            {unit ? <span className="t-sm text-3"> {unit}</span> : null}
          </>
        )}
      </span>
      {note && <span className="t-label text-3">{note}</span>}
    </div>
  );
}

/**
 * 판정 카드.
 *
 * 사람이 고객에게 그대로 옮겨 말할 수 있는 순서로 놓습니다 —
 * 무엇이 가능한가(status) · 얼마나(available_qty) · 언제(earliest_safe_date) ·
 * 받으면 어떻게 되나(projected_inventory_after_order).
 */
function ResultCard({ result }: { result: Feasibility }) {
  return (
    <div className="insight">
      <header className="insight-head">
        <Badge tone={FEASIBILITY_TONE[result.status]}>{FEASIBILITY_LABEL[result.status]}</Badge>
        <span className="t-code">
          {result.itemId}
          {result.itemName ? ` · ${result.itemName}` : ''}
        </span>
      </header>

      <div className="insight-body">
        <div className="rail-tiles">
          <Tile label="요청 수량" value={result.requestedQty} unit="개" />
          <Tile
            label="약속 가능 수량"
            value={result.availableQty}
            unit="개"
            note={result.bucketUntil ? `${result.bucketUntil} 까지` : '구간 밖'}
          />
          <Tile
            label="가장 이른 안전 납기"
            value={result.earliestSafeDate}
            note={
              result.deliveryBufferDays === null
                ? '여유일 정책값 없음'
                : `여유일 ${result.deliveryBufferDays}일 포함`
            }
          />
          <Tile
            label="주문 후 최저 재고"
            value={result.projectedInventoryAfterOrder}
            unit="개"
            note={result.projectionHorizonEnd ? `${result.projectionHorizonEnd} 까지` : null}
          />
          <Tile label="보호 안전재고" value={result.safetyStock} unit="개" />
          {/* 신뢰도 등급은 보여 주지 않습니다 — 표본 수에서 나온 리드타임 통계입니다
              (renew.prd 4.5). 영업에게 필요한 것은 "며칠 여유를 두고 안내하라" 이고,
              그것은 위 '가장 이른 안전 납기' 가 이미 여유일을 얹어 말합니다. */}
          <Tile label="적용 리드타임" value={result.leadTimeUsed} unit="일" />
        </div>

        <p className="t-sm text-2" style={{ marginTop: 'var(--s-3)' }}>
          즉시 {result.atpNow === null ? '—' : result.atpNow.toLocaleString('ko-KR')} · 2주 내{' '}
          {result.atp2w === null ? '—' : result.atp2w.toLocaleString('ko-KR')} · 1개월 내{' '}
          {result.atp1m === null ? '—' : result.atp1m.toLocaleString('ko-KR')}
          {result.earliestNewSupplyDate
            ? ` · 신규 발주 시 ${result.earliestNewSupplyDate}`
            : ''}
        </p>

        {result.status === 'UNKNOWN' && (
          <p className="t-sm text-3">
            판정에 필요한 데이터가 없습니다
            {result.reason ? ` (${result.reason})` : ''}. SCM 담당자에게 확인하세요.
          </p>
        )}

        <p className="t-sm text-3">
          계획 리드타임은 P80 기준입니다 — 다섯 번 중 한 번은 지연됩니다. 고객에게는 위
          &lsquo;가장 이른 안전 납기&rsquo; 로 안내하세요.
        </p>

        {result.dataSnapshotAt && (
          <p className="t-label text-3">
            데이터 기준 {new Date(result.dataSnapshotAt).toLocaleString('ko-KR')}
          </p>
        )}
      </div>
    </div>
  );
}

export default function FeasibilityForm({
  items,
}: {
  /** 품목 고르기 목록. 화면이 이미 읽은 수급 상태에서 왔습니다 */
  items: { itemId: string; itemName: string | null }[];
}) {
  const [state, action, pending] = useActionState(checkFeasibility, EMPTY_FEASIBILITY);
  const [reserve, reserveAction, reserving] = useActionState(
    reserveAllocation,
    EMPTY_FEASIBILITY,
  );

  return (
    <div style={{ display: 'grid', gap: 'var(--s-4)' }}>
      <form action={action} style={{ display: 'grid', gap: 'var(--s-4)' }}>
        <div className="grid grid-3">
          <div className="field">
            <label className="t-label" htmlFor="itemId">
              품목
            </label>
            <select id="itemId" name="itemId" className="select" defaultValue="" required>
              <option value="" disabled>
                품목을 고르세요
              </option>
              {items.map((item) => (
                <option key={item.itemId} value={item.itemId}>
                  {item.itemId}
                  {item.itemName ? ` · ${item.itemName}` : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="field">
            <label className="t-label" htmlFor="qty">
              수량
            </label>
            <input id="qty" name="qty" type="number" min={1} step={1} required />
          </div>

          <div className="field">
            <label className="t-label" htmlFor="targetDate">
              납기
            </label>
            <input id="targetDate" name="targetDate" type="date" />
          </div>
        </div>

        <div style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" className="btn primary lg" disabled={pending}>
            <CalendarCheck size={15} aria-hidden />
            {pending ? '확인하는 중…' : '확인'}
          </button>
          <span className="t-sm text-3">
            확인만 합니다. 재고를 잡지 않으므로 몇 번을 눌러도 됩니다.
          </span>
        </div>

        {state.error && (
          <p className="login-error" role="alert">
            <TriangleAlert size={14} aria-hidden />
            {state.error}
          </p>
        )}
      </form>

      {state.result && <ResultCard result={state.result} />}

      {state.result && state.input && (
        <form action={reserveAction} style={{ display: 'grid', gap: 'var(--s-3)' }}>
          <input type="hidden" name="itemId" value={state.input.itemId} />
          <input type="hidden" name="qty" value={state.input.qty} />

          <div
            style={{ display: 'flex', gap: 'var(--s-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
          >
            <div className="field" style={{ minWidth: '16rem' }}>
              <label className="t-label" htmlFor="customer">
                고객명 (선택)
              </label>
              <input id="customer" name="customer" type="text" maxLength={100} />
            </div>
            <button type="submit" className="btn secondary lg" disabled={reserving}>
              <Lock size={15} aria-hidden />
              {reserving
                ? '예약하는 중…'
                : `${state.input.qty.toLocaleString('ko-KR')}개 가예약`}
            </button>
          </div>

          <span className="t-sm text-3">
            가예약하면 이 수량이 곧바로 약속 가능 수량에서 빠져, 다른 사람이 같은 재고를 약속할 수
            없게 됩니다. 유효기간이 지나면 자동으로 풀립니다.
          </span>

          {reserve.error && (
            <p className="login-error" role="alert">
              <TriangleAlert size={14} aria-hidden />
              {reserve.error}
            </p>
          )}
          {reserve.allocationMessage && (
            <div className="insight">
              <div className="insight-head">가예약 완료</div>
              <div className="insight-body">{reserve.allocationMessage}</div>
            </div>
          )}
        </form>
      )}
    </div>
  );
}
