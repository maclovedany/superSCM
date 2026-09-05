// (user) 화면 공통 로딩 상태 — 전환 즉시 뼈대를 보이고, 데이터가 오면 화면으로 바뀝니다.
import PageSkeleton from '@/components/ui/page-skeleton';

export default function Loading() {
  return <PageSkeleton />;
}
