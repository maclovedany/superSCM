import { Check, Database, FileCog, Layers3, ListChecks, Settings2, SlidersHorizontal } from 'lucide-react';
import StepFrame from './step-frame';

const masters = [['품목·기종', '기기 · 옵션 · 부품 · 소모품', Database], ['BOM·Common품', '기종별 구성과 공용 관계', Layers3], ['장착율·사용량', '3/6/12개월 기준', SlidersHorizontal], ['MOQ·발주단위', '최소발주 수량 단위', ListChecks], ['Lead Time', 'Supplier·공급지역별', Settings2], ['Flexibility Rule', '전월 ±20% · 전전월 ±30%', FileCog]] as const;

export default function MasterStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  return <StepFrame onNext={onNext} onBack={onBack} nextLabel="발주량 계산으로 이동"><div className="page-heading"><div><div className="eyebrow">03 / MASTER DATA</div><h2>마스터 검증</h2><p>계산에 필요한 품목·BOM·장착율·구매조건이 준비되어 있는지 확인합니다.</p></div><span className="tag blue">검증 화면</span></div>
    <div className="grid grid-3">{masters.map(([title, desc, Icon], index) => <div className="card flow-card" key={title}><div className="flow-icon"><Icon size={16} /></div><h3>{title}</h3><p>{desc}</p><div style={{ marginTop: 15 }}><span className={`tag ${index === 4 ? 'amber' : 'green'}`}>{index === 4 ? '입력 필요' : <><Check size={11} /> 준비됨</>}</span></div></div>)}</div>
    <div className="section grid grid-2"><div className="card"><div className="card-title"><h3>검증 체크리스트</h3><span>계산 전 필수조건</span></div><div className="checklist">{['품목·기종 코드 존재', 'BOM·필수 옵션 관계 존재', '장착율·평균 사용량 존재', 'MOQ·발주단위 존재', 'Supplier별 Lead Time 존재', '단가·통화 존재'].map((item, i) => <div className="check-row" key={item}><div className="check-label"><span className={`check-icon ${i === 4 ? 'pending' : ''}`}>{i === 4 ? <Settings2 size={12} /> : <Check size={12} />}</span>{item}</div><span className={`tag ${i === 4 ? 'amber' : 'green'}`}>{i === 4 ? '확인 필요' : '통과'}</span></div>)}</div></div><div className="card"><div className="card-title"><h3>마스터 관리 방식</h3><span>Phase 2에서 연결</span></div><div className="callout blue"><FileCog size={16} /><div><strong>직접 입력 + Excel/CSV 업로드</strong>샘플 데이터가 준비되면 실제 마스터를 등록하고, 유효기간·중복·누락 검증을 연결합니다.</div></div><button className="button ghost" disabled style={{ marginTop: 15 }}><UploadIcon /> Excel 업로드는 다음 단계</button></div></div>
  </StepFrame>;
}

function UploadIcon() { return <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 3v12m0-12 4 4m-4-4L8 7M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" /></svg>; }
