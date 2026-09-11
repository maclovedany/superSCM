'use client';

// Task 10a — 해외법인 편집. 기존 행은 표 안 인라인 폼으로 바로 고치고, 새 법인은 아래 폼으로
// 추가한다(stage1 §8 "해외법인을 추가할 때 관리자가 출항 준비기간을 입력·변경할 수 있어야 한다").

import { useActionState } from 'react';
import Button from '@/components/ui/button';
import EmptyValue from '@/components/ui/empty-value';
import { upsertSupplyEntityAction, initialMasterActionState, type MasterActionState } from '@/lib/master-actions';
import type { SupplyEntity } from '@/lib/master-model';

function EntityRowForm({ action, pending, entity }: { action: (formData: FormData) => void; pending: boolean; entity: SupplyEntity }) {
  return (
    <form action={action} className="master-row-form">
      <input type="hidden" name="entityId" value={entity.entityId} />
      <input type="hidden" name="countryCode" value={entity.countryCode} />
      <input className="form-input" name="entityName" defaultValue={entity.entityName} style={{ width: 96 }} aria-label={`${entity.entityId} 법인명`} />
      <input className="form-input" type="number" min={0} name="prepDays" defaultValue={entity.prepDays} style={{ width: 64 }} aria-label={`${entity.entityId} 출항 준비기간`} />
      <select className="table-select" name="active" defaultValue={String(entity.active)} aria-label={`${entity.entityId} 활성 상태`}>
        <option value="true">활성</option>
        <option value="false">비활성</option>
      </select>
      <input className="form-input" type="date" name="validFrom" defaultValue={entity.validFrom ?? ''} aria-label={`${entity.entityId} 적용 시작일`} />
      <input className="form-input" type="date" name="validTo" defaultValue={entity.validTo ?? ''} aria-label={`${entity.entityId} 적용 종료일`} />
      <input className="form-input" name="reason" placeholder="변경 사유(필수)" required style={{ width: 160 }} aria-label={`${entity.entityId} 변경 사유`} />
      <Button type="submit" disabled={pending}>{pending ? '저장 중…' : '저장'}</Button>
    </form>
  );
}

export default function SupplyEntitySection({ entities }: { entities: SupplyEntity[] }) {
  const [state, action, pending] = useActionState<MasterActionState, FormData>(upsertSupplyEntityAction, initialMasterActionState);

  return (
    <div className="section card">
      <div className="card-title"><div><h3>해외법인</h3><span>발주일 = 공급처 출항일 − 출항 준비기간. 과거 법인은 지우지 않고 active·종료일로 남긴다</span></div></div>
      {state.error ? <p className="form-error" role="alert">{state.error}</p> : null}
      {state.success ? <p className="form-success" role="status">{state.success}</p> : null}

      {entities.length === 0 ? <p className="muted">법인이 없습니다.</p> : (
        <div className="analysis-table-wrap">
          <table className="analysis-table">
            <thead><tr><th>법인</th><th>국가</th><th>활성 공급처</th><th>준비기간 등 편집</th></tr></thead>
            <tbody>
              {entities.map((entity) => (
                <tr key={entity.entityId}>
                  <td><b>{entity.entityId}</b>{entity.reasonCode === 'PREP_DAYS_UNSET' ? <><br /><EmptyValue reasonCode="PREP_DAYS_UNSET" /></> : null}</td>
                  <td>{entity.countryCode}</td>
                  <td>{entity.activeSupplierCount.toLocaleString('ko-KR')}</td>
                  <td><EntityRowForm action={action} pending={pending} entity={entity} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <form action={action} className="master-form">
        <p className="master-form-wide muted">새 해외법인 추가</p>
        <label>법인 코드<input className="form-input" name="entityId" placeholder="예: TH" required /></label>
        <label>법인명<input className="form-input" name="entityName" placeholder="예: 태국" required /></label>
        <label>국가 코드<input className="form-input" name="countryCode" placeholder="예: TH" required /></label>
        <label>출항 준비기간(일)<input className="form-input" type="number" min={0} name="prepDays" placeholder="0" /></label>
        <label>활성 상태<select className="table-select" name="active" defaultValue="true"><option value="true">활성</option><option value="false">비활성</option></select></label>
        <label>적용 시작일<input className="form-input" type="date" name="validFrom" /></label>
        <label>적용 종료일<input className="form-input" type="date" name="validTo" /></label>
        <label className="master-form-wide">비고<input className="form-input" name="note" /></label>
        <label className="master-form-wide">등록 사유(필수)<input className="form-input" name="reason" required /></label>
        <div className="master-form-actions"><Button type="submit" variant="primary" disabled={pending}>{pending ? '저장 중…' : '법인 추가'}</Button></div>
      </form>
    </div>
  );
}
