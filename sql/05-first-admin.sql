-- ──────────────────────────────────────────────────────────────
-- STEP 2 · 첫 관리자 지정
--
-- 이 파일을 실행하기 "전에" 계정을 먼저 만들어야 합니다.
--
-- ── 계정 만들기 (Supabase 대시보드) ───────────────────────────
--
--   https://supabase.com/dashboard/project/zetgxrcnbyrfmwtoydxo/auth/users
--
--   1  좌측 메뉴 Authentication → Users
--   2  우측 상단 [Add user] → 드롭다운에서 "Create new user" 선택
--        · "Send invitation" 은 초대 메일을 보냅니다. 번거로우니 쓰지 않습니다.
--   3  입력창 3개를 채웁니다
--        Email Address      로그인할 이메일
--        Password           ★ 여기서 직접 정합니다. 최소 6자.
--                             Supabase 가 만들어주는 값이 아니라
--                             앞으로 로그인에 쓸 비밀번호를 내가 입력하는 칸입니다.
--        Auto Confirm User  ★ 반드시 켭니다(ON).
--                             끄면 확인 메일 링크를 눌러야만 로그인됩니다.
--                             안 누르면 로그인 화면에
--                             "이메일 인증이 완료되지 않은 계정입니다" 가 뜹니다.
--   4  [Create user] 클릭
--
-- 여기까지 하면 sql/03-auth.sql 의 트리거가 돌아
-- core.app_user 에 USER 역할로 자동 등록됩니다.
--
-- ── 그다음 아래를 실행하면 ADMIN 이 됩니다 ────────────────────
--
-- 첫 관리자만 이렇게 만듭니다. 이후 역할 변경은 /admin/users 화면에서 합니다.
-- (관리자는 자기 계정의 역할을 스스로 바꿀 수 없습니다.
--  마지막 관리자가 자신을 USER 로 내리면 되돌릴 사람이 없어지기 때문입니다.)
-- ──────────────────────────────────────────────────────────────

update core.app_user
   set role = 'ADMIN',
       name = coalesce(name, '관리자')
 where email = 'insightdany@naver.com';   -- 3번에서 입력한 이메일과 같아야 합니다

-- 확인
select email, name, role, active, last_login_at
  from core.app_user
 order by role, email;
