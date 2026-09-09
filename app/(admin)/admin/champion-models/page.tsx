import PageHeader from '@/components/shell/page-header';
import NoRealDataNotice from '@/components/analysis/no-realdata-notice';

export const dynamic = 'force-dynamic';

export default function Page() {
  return (
    <section className="analysis-page">
      <PageHeader eyebrow="ADMIN" title="Champion Models" description="품목별 대표 모델을 고르고 이력을 남깁니다." />
      <div className="analysis-content">
        <NoRealDataNotice
          what="Champion Models"
          missing={['검증 Actual (실적 대비 예측 오차 채점용)', '예측 실행 결과 (실데이터용 Forecast 엔진 미구축)']}
          unlocks={['품목별 Champion 선정', '모델 교체 이력 추적', '선정 근거 감사 기록']}
        />
      </div>
    </section>
  );
}
