'use client';

// 영업 주문 등록 · 검토 요청 · 수주 확정 · 재등록 폼 — Task 5
//
// ★ 여기서 배정 가능 여부를 계산하지 않습니다. 품목 옆 주문 가능 수량은 analytics.v_order_available_stock
//   값을 보여줄 뿐이고, 실제 배정은 검토 요청 순간 DB가 재고 행을 잠근 뒤 판정합니다.
// ★ 값이 null이면 0으로 채우지 않고 사유 코드를 보입니다.

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { formatNumber } from '@/components/ui/data-table';
import EmptyValue from '@/components/ui/empty-value';
import type { OrderAvailableStockRow } from '@/lib/inventory/model';
import {
  confirmSalesOrderAction,
  copyCancelledOrderAction,
  createSalesOrderAction,
  requestOrderReviewAction,
} from '@/lib/orders/actions';
import { ALLOCATION_CHOICE_LABELS, ALLOCATION_CHOICES, type AllocationChoice, type OrderActionState } from '@/lib/orders/model';

const initialState: OrderActionState = { error: null, success: null };

const CHOICE_DESCRIPTIONS: Record<AllocationChoice, string> = {
  PARTIAL: '지금 가용재고만큼만 임시배정하고, 부족 수량은 최초 검토 요청 순번을 유지한 채 대기합니다.',
  WAIT_FULL: '한 품목이라도 부족하면 일부도 잡지 않고 요청 전체를 배정 대기로 둡니다.',
};

function FormMessage({ state }: { state: OrderActionState }) {
  return (
    <>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}
    </>
  );
}

function SubmitButton({ label, className = 'button primary' }: { label: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button className={className} type="submit" disabled={pending}>
      {pending ? '처리 중' : label}
    </button>
  );
}

type LineDraft = { key: number; itemId: string; qty: string };

export default function OrderCreateForm({ items }: { items: OrderAvailableStockRow[] }) {
  const [state, formAction] = useActionState(createSalesOrderAction, initialState);
  const [lines, setLines] = useState<LineDraft[]>([{ key: 1, itemId: '', qty: '' }]);
  const [nextKey, setNextKey] = useState(2);
  const itemById = new Map(items.map((item) => [item.itemId, item]));

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => [...current, { key: nextKey, itemId: '', qty: '' }]);
    setNextKey((current) => current + 1);
  }

  function removeLine(key: number) {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));
  }

  return (
    <form action={formAction} className="order-form">
      <div className="grid grid-2">
        <label>
          <span>고객명 <small>필수</small></span>
          <input className="form-input" name="customerName" required maxLength={200} />
        </label>
        <label>
          <span>고객코드 <small>선택 · 고객 마스터가 없어 입력한 값을 그대로 저장합니다</small></span>
          <input className="form-input" name="customerId" maxLength={100} />
        </label>
      </div>

      <fieldset className="order-lines">
        <legend>주문 품목</legend>
        {lines.map((line) => {
          const selected = itemById.get(line.itemId);
          return (
            <div className="order-line-row" key={line.key}>
              <label>
                <span>품목</span>
                <select
                  className="table-select"
                  name="itemId"
                  value={line.itemId}
                  onChange={(event) => updateLine(line.key, { itemId: event.target.value })}
                >
                  <option value="">품목 선택</option>
                  {items.map((item) => (
                    <option key={item.itemId} value={item.itemId}>{item.itemId} · {item.itemName}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>수량</span>
                <input
                  className="form-input"
                  name="qty"
                  inputMode="decimal"
                  value={line.qty}
                  onChange={(event) => updateLine(line.key, { qty: event.target.value })}
                />
              </label>
              <div className="order-line-available">
                <span className="muted">주문 가능</span>
                <b>
                  {!selected
                    ? <span className="muted">—</span>
                    : selected.availableQty === null
                      ? <EmptyValue reasonCode={selected.reasonCode ?? 'CALCULATION_UNAVAILABLE'} />
                      : formatNumber(selected.availableQty, ' EA')}
                </b>
              </div>
              <button className="button" type="button" onClick={() => removeLine(line.key)} disabled={lines.length === 1}>
                삭제
              </button>
            </div>
          );
        })}
        <div className="button-row">
          <button className="button ghost" type="button" onClick={addLine}>품목 줄 추가</button>
        </div>
      </fieldset>

      <label>
        <span>비고 <small>선택</small></span>
        <textarea className="form-input" name="note" rows={2} maxLength={1000} />
      </label>

      <p className="muted">
        등록한 주문은 작성 중(DRAFT) 상태입니다. 상세 화면에서 배정 방식을 골라 검토 요청하면 그 순간의 가용재고로
        임시배정됩니다. 위 주문 가능 수량은 참고값이며 다른 영업담당자의 요청이 먼저 처리되면 달라질 수 있습니다.
      </p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="주문 등록" /></div>
    </form>
  );
}

export function ReviewRequestForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(requestOrderReviewAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="orderId" value={orderId} />
      <fieldset className="order-choice">
        <legend>재고가 부족할 때 배정 방식 <small>필수</small></legend>
        {ALLOCATION_CHOICES.map((choice, index) => (
          <label key={choice}>
            <input type="radio" name="choice" value={choice} required={index === 0} />
            <span>
              <b>{ALLOCATION_CHOICE_LABELS[choice]}</b>
              <br />
              <span className="muted">{CHOICE_DESCRIPTIONS[choice]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <p className="muted">임시배정은 최초 검토 요청 시각부터 30일 뒤 자동 만료되며, 추가 배정이 있어도 연장되지 않습니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="검토 요청" /></div>
    </form>
  );
}

export function ConfirmOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(confirmSalesOrderAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="orderId" value={orderId} />
      <label>
        <span>최종 승인된 주문번호 <small>필수 · 증빙파일은 받지 않습니다</small></span>
        <input className="form-input" name="confirmedOrderNo" required maxLength={100} />
      </label>
      <p className="muted">확정하면 임시배정이 확정배정으로 바뀌어 30일 만료가 적용되지 않습니다. 남은 부족 수량은 기존 순번대로 대기합니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="수주 확정" /></div>
    </form>
  );
}

export function CopyOrderForm({ orderId }: { orderId: string }) {
  const [state, formAction] = useActionState(copyCancelledOrderAction, initialState);
  return (
    <form action={formAction} className="order-action-form">
      <input type="hidden" name="orderId" value={orderId} />
      <p className="muted">취소 · 만료된 주문은 복구하지 않습니다. 품목 · 수량 · 고객을 복사한 새 주문(작성 중)을 만들고 이 주문과 연결합니다.</p>
      <FormMessage state={state} />
      <div className="button-row"><SubmitButton label="새 주문으로 재등록" /></div>
    </form>
  );
}
