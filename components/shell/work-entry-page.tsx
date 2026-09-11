import PageHeader from '@/components/shell/page-header';
import Panel from '@/components/ui/panel';

export default function WorkEntryPage({ title, description, nextTask }: { title: string; description: string; nextTask: string }) {
  return (
    <section className="analysis-page">
      <PageHeader eyebrow="WORK" title={title} description={description} />
      <div className="analysis-content">
        <Panel title="후속 단계에서 구현합니다" description={nextTask}>
          <p className="muted">현재는 권한이 있는 사용자만 이 경로에 진입할 수 있습니다. 업무 데이터와 계산 기능은 후속 단계에서 연결합니다.</p>
        </Panel>
      </div>
    </section>
  );
}
