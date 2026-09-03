import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // 파일 업로드가 Server Action 을 지나갑니다. 기본 1MB 로는 부족합니다.
    // Vercel 서버리스는 요청 본문을 4.5MB 로 제한하므로, 그보다 큰 파일은
    // 운영에서 Storage 직접 업로드로 바꿔야 합니다 (renew.prd 33.2).
    serverActions: { bodySizeLimit: '25mb' },
  },
};

export default nextConfig;
