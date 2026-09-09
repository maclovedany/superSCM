# 기기·옵션 월간 발주계획 MVP

PRD 기준 1단계 로컬 웹 프로토타입입니다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

## 현재 단계

현재는 전체 업무 흐름을 확인하기 위한 Phase 1 화면입니다.

```text
전체 현황
→ 수요 확정
→ 재고·공급
→ 마스터 검증
→ 발주량 계산
→ 보고자료
```

화면에는 업무 단계, 입력 항목, 계산 결과 구조, 예외 검토, 보고자료 미리보기를 대표 샘플값으로 표시합니다.

## 다음 구현 단계

- SQLite 저장 및 발주계획 생성/조회
- 화면 직접 입력 및 Excel/CSV 업로드
- 실제 발주량 계산 서비스
- 수동 조정 이력
- Excel/PDF 보고서 다운로드

## Supabase 클라우드 연결

현재 프로젝트에는 Supabase 브라우저/서버 클라이언트와 수요확정 핵심 스키마 마이그레이션이 포함되어 있습니다.

1. Supabase Dashboard에서 프로젝트를 생성합니다.
2. 프로젝트의 URL과 Publishable key를 확인합니다.
3. 로컬에서 `.env.example`을 `.env.local`로 복사하고 값을 입력합니다.

```bash
cp .env.example .env.local
```

4. 개발 서버를 실행한 뒤 연결 상태를 확인합니다.

```bash
curl http://localhost:3000/api/health/supabase
```

5. Supabase CLI로 프로젝트를 연결한 후 마이그레이션을 배포합니다.

```bash
supabase login
supabase link --project-ref <project-ref>
supabase db push
```

마이그레이션 파일은 `supabase/migrations/`에 있으며, 현재 수요확정 기능에 필요한 `planning_runs`, `ol_demand`, `sfdc_pipeline`, `bulk_deals`, `historical_actuals`, `demand_confirmations` 테이블을 생성합니다. 원격 데이터베이스는 Dashboard에서 직접 수정하지 않고 마이그레이션 파일로 관리합니다.

## 참고

샘플 데이터가 제공되면 화면의 대표값을 실제 데이터 구조와 계산 기준에 맞춰 교체합니다.
