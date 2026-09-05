import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // 파일 업로드가 Server Action 을 지나갑니다. 기본 1MB 로는 부족합니다.
    // Vercel 서버리스는 요청 본문을 4.5MB 로 제한하므로, 그보다 큰 파일은
    // 운영에서 Storage 직접 업로드로 바꿔야 합니다 (renew.prd 33.2).
    serverActions: { bodySizeLimit: '25mb' },
    // 방금 본 화면으로 되돌아갈 때 서버를 다시 부르지 않고 30초 동안은 클라이언트 캐시를 씁니다.
    // Next 15 기본값은 0(매번 서버)입니다. Server Action 의 revalidatePath 는 이 캐시도 비웁니다.
    staleTimes: { dynamic: 30, static: 180 },
  },
};

export default nextConfig;
