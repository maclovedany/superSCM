import { ArrowLeft, ArrowRight } from 'lucide-react';

export default function StepFrame({ children, onNext, onBack, nextLabel = '다음 단계' }: { children: React.ReactNode; onNext: () => void; onBack: () => void; nextLabel?: string }) {
  return <><div>{children}</div><div className="step-footer"><span>현재는 전체 플로우 확인용 프로토타입입니다.</span><div className="button-row"><button className="button" onClick={onBack}><ArrowLeft size={14} /> 이전 단계</button><button className="button primary" onClick={onNext}>{nextLabel} <ArrowRight size={14} /></button></div></div></>;
}
