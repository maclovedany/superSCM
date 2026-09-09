import PageHeader from '@/components/shell/page-header';
import NoRealDataNotice from '@/components/analysis/no-realdata-notice';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Forecast Models" description="예측 모델 registry 입니다." />
      <div className="analysis-content">
        <NoRealDataNotice
          what="Forecast Models"
          missing={['모델 registry (실데이터 기준 모델 정의)']}
          unlocks={['수요 유형별 모델 배정', 'Croston 계열 엔진 연결', '모델 파라미터 관리']}
        />
      </div>
    </section>
  );
}
