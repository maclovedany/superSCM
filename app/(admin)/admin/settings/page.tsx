import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';

export default function AdminSettingsPage() {
  return <section className="analysis-page"><PageHeader eyebrow="ADMIN" title="시스템 설정" description="공급망 운영 기준과 화면 설정을 관리합니다." /><Panel title="준비 중"><p className="muted">관리자 기능은 다음 단계에서 연결됩니다.</p></Panel></section>;
}

