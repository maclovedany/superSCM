// 분석 화면(/analysis/*) 공통 껍데기입니다.
//
// 화면을 추가할 때 이 파일은 고치지 않습니다.
// 탭 목록은 components/analysis/analysis-tabs.tsx 한 곳에만 있습니다.

import type { ReactNode } from 'react';
import Link from 'next/link';
import AnalysisTabs from '@/components/analysis/analysis-tabs';

export default function AnalysisLayout({ children }: { children: ReactNode }) {
  return (
    <div className="analysis-shell">
      <header className="analysis-topbar">
        <Link href="/" className="analysis-home">← 발주계획</Link>
        <AnalysisTabs />
      </header>
      {children}
    </div>
  );
}
