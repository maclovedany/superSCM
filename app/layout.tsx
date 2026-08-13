import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '월간 발주계획 | Procurement Planning',
  description: '기기·옵션 월간 수요확정 및 발주계획 MVP',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
