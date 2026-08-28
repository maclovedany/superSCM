import AnalysisFrame from '@/components/analysis/analysis-frame';
import ModelComparison from '@/components/analysis/model-comparison';
import { getModelComparison } from '@/lib/scm';
export const dynamic='force-dynamic';
export default async function ModelComparisonPage(){const data=await getModelComparison();if(data.error)return <AnalysisFrame title="Model Comparison" description="저장된 검증 성능을 비교합니다."><p className="text-danger">조회 실패: {data.error}</p></AnalysisFrame>;return <AnalysisFrame title="Model Comparison" description="Forecast 재실행 없이 저장된 결과와 검증 Actual을 비교합니다."><ModelComparison {...data}/></AnalysisFrame>;}
