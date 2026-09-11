# 알림 발송 운영 기준

## 실행 주기와 배포 조건

알림 작업은 `/api/cron/notifications`를 10분마다 호출합니다. `vercel.json`의 10분 Cron은
Vercel Pro 이상에서 운영하거나, 같은 주기를 보장하는 Supabase Cron 등 동등한 외부
스케줄러로 호출해야 합니다. Vercel Hobby에서는 이 주기를 지원하지 않으므로 그대로 배포하면
안 됩니다.

외부 스케줄러를 사용할 때도 `Authorization: Bearer <CRON_SECRET>` 또는
`x-cron-secret: <CRON_SECRET>` 헤더를 반드시 전달합니다.

## 처리 안전장치

- 한 번 실행할 때 최대 25건을 가져옵니다.
- 한 작업자의 처리 임대시간은 2분입니다.
- 임대시간 안에는 작업자 UUID와 claim token이 일치해야 완료할 수 있습니다.
- 서버가 중단되면 임대 만료 뒤 다른 작업자가 같은 알림을 회수합니다.
- 알림 한 건의 최대 시도 횟수는 기본 5회입니다.
- 일시 장애는 10분부터 늘어나는 간격으로 재예약하며, 각 실패 시도는 발송 이력에 남깁니다.
- 입력 오류와 설정 누락 같은 영구 오류는 재예약하지 않고 최종 실패로 남깁니다.
- Resend 요청은 `notification/<notification_id>` 중복 방지 키를 사용합니다.
- 외부 발송 후 데이터베이스 완료 기록까지 성공해야 Cron 성공 건수로 집계합니다.

## 운영 확인

- 관리자 화면 `/admin/notification-history`에서 시도 번호, 성공·실패, 재시도 가능 여부,
  오류 또는 외부 메시지 ID를 확인합니다.
- `PROCESSING`이 2분 이상 유지되면 다음 Cron이 자동 회수합니다.
- 같은 알림이 5회 실패하면 `FAILED`로 종료되며 자동 재시도하지 않습니다.
- 승인 대기 알림은 발송 직전에 승인 상태를 다시 확인합니다. 이미 승인·반려·취소됐거나
  series가 취소된 알림은 발송하지 않습니다.

## 서버 환경변수

- `SUPABASE_SECRET_KEY` 또는 `SUPABASE_SERVICE_ROLE_KEY`
- `CRON_SECRET`
- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`

이 값에는 `NEXT_PUBLIC_` 접두어를 붙이지 않습니다.

Resend의 중복 방지 키는 동일 요청의 재시도 중복을 줄이지만 보존 기간은 24시간입니다.
현재 최대 재시도 간격은 이 기간 안에서 끝나도록 구성되어 있습니다.

참고: https://resend.com/docs/dashboard/emails/idempotency-keys
