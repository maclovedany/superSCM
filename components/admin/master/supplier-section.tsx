'use client';

// Task 10a — 공급처 편집. 소속 법인·활성 여부·적용 기간을 바꾼다. 과거 발주 이력이 공급처를
// 참조하므로(gap 6.1) 삭제 버튼은 두지 않는다 — 퇴출은 비활성 + 종료일이다.

import { useActionState } from 'react';
import Button from '@/components/ui/button';
import EmptyValue from '@/components/ui/empty-value';
import { upsertSupplierAction, initialMasterActionState, type MasterActionState } from '@/lib/master-actions';
import type { Supplier, SupplyEntity } from '@/lib/master-model';

function EntitySelect({ name, defaultValue, entities }: { name: string; defaultValue: string; entities: SupplyEntity[] }) {
  return (
    <select className="table-select" name={name} defaultValue={defaultValue} aria-label="소속 법인">
      <option value="">법인 선택</option>
      {entities.map((entity) => <option key={entity.entityId} value={entity.entityId}>{entity.entityId} · {entity.entityName}</option>)}
    </select>
  );
}

function SupplierRowForm({ action, pending, supplier, entities }: { action: (formData: FormData) => void; pending: boolean; supplier: Supplier; entities: SupplyEntity[] }) {
  return (
    <form action={action} className="master-row-form">
      <input type="hidden" name="supplierId" value={supplier.supplierId} />
      <input className="form-input" name="supplierName" defaultValue={supplier.supplierName} style={{ width: 120 }} aria-label={`${supplier.supplierId} 공급처명`} />
      <EntitySelect name="entityId" defaultValue={supplier.entityId ?? ''} entities={entities} />
      <input className="form-input" type="number" min={0} name="leadTimeDays" defaultValue={supplier.leadTimeDays ?? ''} placeholder="리드타임" style={{ width: 72 }} aria-label={`${supplier.supplierId} 리드타임`} />
      <select className="table-select" name="active" defaultValue={String(supplier.active)} aria-label={`${supplier.supplierId} 활성 상태`}>
        <option value="true">활성</option>
        <option value="false">비활성(퇴출)</option>
      </select>
      <input className="form-input" type="date" name="validFrom" defaultValue={supplier.validFrom ?? ''} aria-label={`${supplier.supplierId} 적용 시작일`} />
      <input className="form-input" type="date" name="validTo" defaultValue={supplier.validTo ?? ''} aria-label={`${supplier.supplierId} 적용 종료일(비활성 전환 시 필수)`} />
      <input className="form-input" name="reason" placeholder="변경 사유(필수)" required style={{ width: 160 }} aria-label={`${supplier.supplierId} 변경 사유`} />
      <Button type="submit" disabled={pending}>{pending ? '저장 중…' : '저장'}</Button>
    </form>
  );
}

export default function SupplierSection({ suppliers, entities }: { suppliers: Supplier[]; entities: SupplyEntity[] }) {
  const [state, action, pending] = useActionState<MasterActionState, FormData>(upsertSupplierAction, initialMasterActionState);

  return (
    <div className="section card">
      <div className="card-title"><div><h3>공급처</h3><span>리드타임은 예측 조정 범위의 시작 월을 정한다. 퇴출은 비활성 + 종료일로만 한다(삭제하지 않는다)</span></div></div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}

      {suppliers.length === 0 ? <p className="muted">공급처가 없습니다.</p> : (
        <div className="analysis-table-wrap">
          <table className="analysis-table">
            <thead><tr><th>공급처</th><th>출항일 규칙</th><th>편집</th></tr></thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.supplierId}>
                  <td><b>{supplier.supplierId}</b></td>
                  <td>{supplier.departureRuleCount === 0 ? <EmptyValue reasonCode="NO_DEPARTURE_RULE" /> : `${supplier.departureRuleCount}건`}</td>
                  <td><SupplierRowForm action={action} pending={pending} supplier={supplier} entities={entities} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={action} className="master-form">
        <p className="master-form-wide muted">새 공급처 추가</p>
        <label>공급처 코드<input className="form-input" name="supplierId" placeholder="예: SUP014" required /></label>
        <label>공급처명<input className="form-input" name="supplierName" required /></label>
        <label>소속 법인<EntitySelect name="entityId" defaultValue="" entities={entities} /></label>
        <label>리드타임(일)<input className="form-input" type="number" min={0} name="leadTimeDays" /></label>
        <label>활성 상태<select className="table-select" name="active" defaultValue="true"><option value="true">활성</option><option value="false">비활성</option></select></label>
        <label>적용 시작일<input className="form-input" type="date" name="validFrom" /></label>
        <label>적용 종료일<input className="form-input" type="date" name="validTo" /></label>
        <label className="master-form-wide">비고<input className="form-input" name="note" /></label>
        <label className="master-form-wide">등록 사유(필수)<input className="form-input" name="reason" required /></label>
        <div className="master-form-actions"><Button type="submit" variant="primary" disabled={pending}>{pending ? '저장 중…' : '공급처 추가'}</Button></div>
      </form>
    </div>
  );
}
