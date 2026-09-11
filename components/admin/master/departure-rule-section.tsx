'use client';

// Task 10a — 공급처 출항일 규칙. 생성(create)·교체(replace)는 한 폼으로, 비활성화(deactivate)는
// 행마다 버튼으로 한다. 세 인코딩(요일 / 주차 / 매월 일자)은 §8 "요일 또는 주차 규칙"을 그대로
// 반영한다 — STEP 18은 요일·매월 일자만 표현했다(week_of_month는 이 Task가 추가했다).

import { useActionState, useState } from 'react';
import Button from '@/components/ui/button';
import Badge from '@/components/ui/badge';
import {
  deactivateSupplierDepartureRuleAction,
  setSupplierDepartureRuleAction,
  initialMasterActionState,
  type MasterActionState,
} from '@/lib/master-actions';
import { departureLabel, type DepartureRuleType, type Supplier, type SupplierDeparture } from '@/lib/master-model';

const WEEKDAY_OPTIONS = ['일', '월', '화', '수', '목', '금', '토'];

export default function DepartureRuleSection({ departures, suppliers }: { departures: SupplierDeparture[]; suppliers: Supplier[] }) {
  const [setState, setAction, setPending] = useActionState<MasterActionState, FormData>(setSupplierDepartureRuleAction, initialMasterActionState);
  const [deactivateState, deactivateAction, deactivatePending] = useActionState<MasterActionState, FormData>(deactivateSupplierDepartureRuleAction, initialMasterActionState);
  const [ruleType, setRuleType] = useState<DepartureRuleType>('WEEKDAY');
  const [editing, setEditing] = useState<SupplierDeparture | null>(null);

  function startEdit(rule: SupplierDeparture) {
    setEditing(rule);
    if (rule.weekday !== null && rule.weekOfMonth) setRuleType('WEEK_OF_MONTH');
    else if (rule.weekday !== null) setRuleType('WEEKDAY');
    else setRuleType('MONTH_DAY');
  }

  return (
    <div className="section card">
      <div className="card-title"><div><h3>출항일 규칙</h3><span>출항일을 주차별로 묶어 발주한다. 규칙을 끄면(비활성화) 행은 남고 계산에서만 빠진다</span></div></div>
      {deactivateState.error ? <p className="form-error" role="alert">{deactivateState.error}</p> : null}
      {deactivateState.success ? <p className="form-success" role="status">{deactivateState.success}</p> : null}

      {departures.length === 0 ? <p className="muted">출항일 규칙이 없습니다.</p> : (
        <div className="analysis-table-wrap">
          <table className="analysis-table">
            <thead><tr><th>공급처</th><th>규칙</th><th>적용 기간</th><th>상태</th><th>액션</th></tr></thead>
            <tbody>
              {departures.map((rule) => (
                <tr key={rule.departureId}>
                  <td><b>{rule.supplierName}</b><br /><span className="muted">{rule.supplierId}</span></td>
                  <td>{departureLabel(rule)}</td>
                  <td className="muted">{rule.validFrom ?? '—'} ~ {rule.validTo ?? '—'}</td>
                  <td>{rule.active ? <Badge status="SAFE">활성</Badge> : <span className="muted">비활성</span>}</td>
                  <td>
                    <div className="master-row-form">
                      <Button type="button" onClick={() => startEdit(rule)}>수정</Button>
                      {rule.active ? (
                        <form action={deactivateAction}>
                          <input type="hidden" name="departureId" value={rule.departureId} />
                          <input type="hidden" name="reason" value={`${rule.supplierName} 규칙 비활성화`} />
                          <Button type="submit" disabled={deactivatePending}>비활성화</Button>
                        </form>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {setState.error ? <p className="form-error" role="alert">{setState.error}</p> : null}
      {setState.success ? <p className="form-success" role="status">{setState.success}</p> : null}
      <form
        key={editing?.departureId ?? 'new'}
        action={(formData) => {
          setAction(formData);
          setEditing(null);
        }}
        className="master-form"
      >
        <p className="master-form-wide muted">{editing ? `규칙 #${editing.departureId} 교체` : '새 출항일 규칙 추가'}</p>
        <input type="hidden" name="departureId" value={editing?.departureId ?? ''} />
        <label>공급처
          <select className="table-select" name="supplierId" defaultValue={editing?.supplierId ?? ''} required>
            <option value="">공급처 선택</option>
            {suppliers.map((s) => <option key={s.supplierId} value={s.supplierId}>{s.supplierId} · {s.supplierName}</option>)}
          </select>
        </label>
        <label>규칙 종류
          <select className="table-select" value={ruleType} onChange={(e) => setRuleType(e.target.value as DepartureRuleType)} name="ruleType">
            <option value="WEEKDAY">매주 요일</option>
            <option value="WEEK_OF_MONTH">매월 N번째 요일(주차)</option>
            <option value="MONTH_DAY">매월 일자</option>
          </select>
        </label>
        {ruleType !== 'MONTH_DAY' ? (
          <label>요일
            {/* fix round 1 — 빈 placeholder 옵션이 없으면 defaultValue=''가 어떤 <option>과도
                일치하지 않아 브라우저가 첫 실제 옵션(일요일)을 조용히 선택해 버린다. 명시적으로
                고르지 않으면 "선택"에 머물게 해, 안 고르고 제출하면 검증(WEEKDAY_INVALID)이 잡는다. */}
            <select className="table-select" name="weekday" defaultValue={editing?.weekday ?? ''} required>
              <option value="">선택</option>
              {WEEKDAY_OPTIONS.map((label, index) => <option key={label} value={index}>{label}요일</option>)}
            </select>
          </label>
        ) : null}
        {ruleType === 'WEEK_OF_MONTH' ? (
          <label>주차
            <select className="table-select" name="weekOfMonth" defaultValue={editing?.weekOfMonth ?? ''} required>
              <option value="">선택</option>
              {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}번째</option>)}
            </select>
          </label>
        ) : null}
        {ruleType === 'MONTH_DAY' ? (
          <label>매월 일자
            <input className="form-input" type="number" min={1} max={31} name="dayOfMonth" defaultValue={editing?.dayOfMonth ?? ''} required />
          </label>
        ) : null}
        <label>적용 시작일<input className="form-input" type="date" name="validFrom" defaultValue={editing?.validFrom ?? ''} /></label>
        <label>적용 종료일<input className="form-input" type="date" name="validTo" defaultValue={editing?.validTo ?? ''} /></label>
        <label className="master-form-wide">비고<input className="form-input" name="note" defaultValue={editing?.note ?? ''} /></label>
        <label className="master-form-wide">변경 사유(필수)<input className="form-input" name="reason" required /></label>
        <div className="master-form-actions">
          <Button type="submit" variant="primary" disabled={setPending}>{setPending ? '저장 중…' : editing ? '규칙 교체' : '규칙 추가'}</Button>
          {editing ? <Button type="button" onClick={() => setEditing(null)}>취소(새 규칙 추가로 전환)</Button> : null}
        </div>
      </form>
    </div>
  );
}
