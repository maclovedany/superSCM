import type { Metadata } from 'next';
import './globals.css';
import '../styles/shell.css';
import '../styles/components.css';
import '../styles/chart.css';

export const metadata: Metadata = {
  title: 'SuperSCM',
  description: '수요 예측 · 재고 전개 · 발주 추천 SCM 의사결정 플랫폼',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <head>
        {/* Inter 에는 한글 글리프가 없어 Pretendard 를 함께 씁니다 (design.md §4.1) */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="preconnect" href="https://cdn.jsdelivr.net" />
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap"
        />
      </head>
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
