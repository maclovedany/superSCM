'use client';

// Task 10a — 영업일 달력. 공휴일은 자동 생성하지 않고 관리자가 하나씩 넣는다(§8). 국가·연·월
// 단위로 "공휴일을 다 넣었다"를 선언하면 Task 10b가 그 플래그로 준비된 달인지 판정한다.

import { useActionState } from 'react';
import Badge from '@/components/ui/badge';
import Button from '@/components/ui/button';
import {
  addBusinessHolidayAction,
  removeBusinessHolidayAction,
  setCalendarMonthReadyAction,
  initialMasterActionState,
  type MasterActionState,
} from '@/lib/master-actions';
import type { CalendarReadiness } from '@/lib/master-model';

export default function CalendarSection({ readiness }: { readiness: CalendarReadiness[] }) {
  const [addState, addAction, addPending] = useActionState<MasterActionState, FormData>(addBusinessHolidayAction, initialMasterActionState);
  const [removeState, removeAction, removePending] = useActionState<MasterActionState, FormData>(removeBusinessHolidayAction, initialMasterActionState);
  const [readyState, readyAction, readyPending] = useActionState<MasterActionState, FormData>(setCalendarMonthReadyAction, initialMasterActionState);

  return (
    <div className="section card">
      <div className="card-title"><div><h3>영업일 달력</h3><span>주말·공휴일이면 발주일·입고예정일을 이전 영업일로 당긴다. 공휴일을 임의로 추정하지 않는다</span></div></div>

      {addState.error ? <p className="form-error" role="alert">{addState.error}</p> : null}
      {addState.success ? <p className="form-success" role="status">{addState.success}</p> : null}
      <form action={addAction} className="master-form">
        <p className="master-form-wide muted">공휴일 추가</p>
        <label>국가 코드<input className="form-input" name="countryCode" placeholder="KR" defaultValue="KR" required /></label>
        <label>날짜<input className="form-input" type="date" name="calendarDate" required /></label>
        <label>공휴일 이름<input className="form-input" name="holidayName" required /></label>
        <label className="master-form-wide">등록 사유(필수)<input className="form-input" name="reason" required /></label>
        <div className="master-form-actions"><Button type="submit" variant="primary" disabled={addPending}>{addPending ? '저장 중…' : '공휴일 추가'}</Button></div>
      </form>

      {removeState.error ? <p className="form-error" role="alert">{removeState.error}</p> : null}
      {removeState.success ? <p className="form-success" role="status">{removeState.success}</p> : null}
      <form action={removeAction} className="master-form">
        <p className="master-form-wide muted">착오 등록된 공휴일 제거</p>
        <label>국가 코드<input className="form-input" name="countryCode" placeholder="KR" defaultValue="KR" required /></label>
        <label>날짜<input className="form-input" type="date" name="calendarDate" required /></label>
        <label className="master-form-wide">제거 사유(필수)<input className="form-input" name="reason" required /></label>
        <div className="master-form-actions"><Button type="submit" disabled={removePending}>{removePending ? '처리 중…' : '공휴일 제거'}</Button></div>
      </form>

      <div className="section">
        <p className="muted">달력 준비 상태 — 국가·연·월별로 "공휴일을 다 넣었다"를 표시합니다. 목록에 없는 달은 아직 준비되지 않은 것입니다.</p>
        {readiness.length === 0 ? <p className="muted">표시된 달이 없습니다.</p> : (
          <div className="analysis-table-wrap">
            <table className="analysis-table">
              <thead><tr><th>국가</th><th>연월</th><th>등록 공휴일 수</th><th>준비 상태</th><th>처리자</th></tr></thead>
              <tbody>
                {readiness.map((row) => (
                  <tr key={`${row.countryCode}-${row.calYear}-${row.calMonth}`}>
                    <td>{row.countryCode}</td>
                    <td>{row.calYear}-{String(row.calMonth).padStart(2, '0')}</td>
                    <td>{row.holidayCount.toLocaleString('ko-KR')}</td>
                    <td>{row.ready ? <Badge status="SAFE">준비 완료</Badge> : <Badge status="WARNING">미완료</Badge>}</td>
                    <td className="muted">{row.markedByName ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {readyState.error ? <p className="form-error" role="alert">{readyState.error}</p> : null}
      {readyState.success ? <p className="form-success" role="status">{readyState.success}</p> : null}
      <form action={readyAction} className="master-form">
        <p className="master-form-wide muted">달 준비 상태 표시/해제</p>
        <label>국가 코드<input className="form-input" name="countryCode" placeholder="KR" defaultValue="KR" required /></label>
        <label>연도<input className="form-input" type="number" name="calYear" placeholder="2026" required /></label>
        <label>월<input className="form-input" type="number" min={1} max={12} name="calMonth" placeholder="9" required /></label>
        <label>상태<select className="table-select" name="ready" defaultValue="true"><option value="true">준비 완료로 표시</option><option value="false">미완료로 되돌리기</option></select></label>
        <label className="master-form-wide">사유(필수)<input className="form-input" name="reason" required /></label>
        <div className="master-form-actions"><Button type="submit" disabled={readyPending}>{readyPending ? '저장 중…' : '준비 상태 저장'}</Button></div>
      </form>
    </div>
  );
}
