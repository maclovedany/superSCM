import { redirect } from 'next/navigation';

// Task 13 — 관리자 메뉴의 "레거시 업무 플로우" 링크는 제거됐지만(lib/menu.ts) 기존 즐겨찾기·북마크가
// 이 경로로 남아 있을 수 있어 라우트는 유지한다. 신규 운영 발주계획 화면으로 보낸다.
// 레거시 프로토타입은 /workflow(참고용)에서만 접근한다.
export default function AdminWorkflowPage() {
  redirect('/procurement-plans');
}

