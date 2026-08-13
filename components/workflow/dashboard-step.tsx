import { ArrowRight, CheckCircle2, CircleDollarSign, FileText, PackageCheck, Plus, Sparkles, TriangleAlert } from 'lucide-react';
import type { StepId } from '@/components/procurement-app';

export default function DashboardStep({ onStart, onOpenStep }: { onStart: () => void; onOpenStep: (id: StepId) => void }) {
  const openCard = (id: StepId) => ({
    role: 'button',
    tabIndex: 0,
    onClick: () => onOpenStep(id),
    onKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        onOpenStep(id);
      }
    },
  });

  return <>
    <div className="page-heading"><div><div className="eyebrow">PLANNING RUN / 2026.09</div><h2>월간 발주계획 현황</h2><p>수요 확정부터 보고자료 생성까지, 이번 달 업무 진행상태를 한눈에 확인합니다.</p></div><div className="button-row"><button className="button" onClick={() => onOpenStep('report')}><FileText size={14} /> 보고자료 미리보기</button><button className="button primary" onClick={onStart}><Plus size={14} /> 새 발주계획 시작</button></div></div>
    <div className="grid grid-4">
      <div className="card metric metric-interactive" {...openCard('report')}><div className="metric-label">당월 총 발주금액</div><div className="metric-value">₩107.2M</div><div className="metric-foot good">전월 대비 +8.4%</div><span className="metric-hint">금액 상세 보기 <ArrowRight size={11} /></span></div>
      <div className="card metric metric-interactive" {...openCard('demand')}><div className="metric-label">수요 확정 상태</div><div className="metric-value">진행 중</div><div className="metric-foot">OL 검증 완료 · 회의 확정 대기</div><span className="metric-hint">수요 상세 보기 <ArrowRight size={11} /></span></div>
      <div className="card metric metric-interactive" {...openCard('calculation')}><div className="metric-label">발주량 예외</div><div className="metric-value">2<span style={{ fontSize: 15, fontWeight: 600 }}>건</span></div><div className="metric-foot warn">Flex 1 · MOQ 1</div><span className="metric-hint">예외 상세 보기 <ArrowRight size={11} /></span></div>
      <div className="card metric metric-interactive" {...openCard('report')}><div className="metric-label">보고자료</div><div className="metric-value">준비 중</div><div className="metric-foot">계산 완료 후 생성 가능</div><span className="metric-hint">보고자료 보기 <ArrowRight size={11} /></span></div>
    </div>
    <div className="section grid grid-2">
      <div className="card"><div className="card-title"><h3>프로세스 준비상태</h3><span>Phase 1 preview</span></div><div className="checklist">
        {[['수요 자료 취합 및 검증', true], ['수급회의 결과 반영', false], ['전월말 재고·Open PO 입력', false], ['기기·옵션 발주량 계산', false], ['보고자료 생성', false]].map(([label, done]) => <div className="check-row" key={label as string}><div className="check-label"><span className={`check-icon ${done ? '' : 'pending'}`}>{done ? <CheckCircle2 size={12} /> : <TriangleAlert size={12} />}</span>{label as string}</div><span className={`tag ${done ? 'green' : 'amber'}`}>{done ? '완료' : '대기'}</span></div>)}
      </div></div>
      <div className="card"><div className="card-title"><h3>이번 달 업무 진입</h3><span>2026년 09월</span></div><div className="callout blue"><Sparkles size={17} /><div><strong>전체 플로우를 먼저 확인하세요</strong>각 단계는 현재 개괄 화면으로 연결되어 있습니다. 실제 입력·계산·저장은 다음 구현 단계에서 활성화됩니다.</div></div><button className="button primary" style={{ marginTop: 16 }} onClick={onStart}>수요 확정부터 시작 <ArrowRight size={14} /></button></div>
    </div>
    <div className="section"><div className="section-heading"><h3>발주계획 목록</h3><span>최근 작성 순</span></div><div className="table-wrap"><table><thead><tr><th>계획명</th><th>기준월도</th><th>현재 단계</th><th>최종 수정</th><th className="num">총 발주금액</th><th>상태</th></tr></thead><tbody><tr><td><b>2026년 09월 정기 발주</b></td><td>2026.09</td><td>수요 확정</td><td>오늘 09:42</td><td className="num">₩107,240,000</td><td><span className="tag blue">작성 중</span></td></tr><tr><td><b>2026년 08월 정기 발주</b></td><td>2026.08</td><td>보고자료</td><td>2026.07.28</td><td className="num">₩98,940,000</td><td><span className="tag green">완료</span></td></tr></tbody></table></div></div>
  </>;
}
