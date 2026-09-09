import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';

export default function AdminDemandPage() {
  return <section className="analysis-page"><PageHeader eyebrow="ADMIN" title="수요 관리" description="수요 데이터 관리 화면의 공통 진입점입니다." /><Panel title="준비 중"><p className="muted">관리자 기능은 다음 단계에서 연결됩니다.</p></Panel></section>;
}

