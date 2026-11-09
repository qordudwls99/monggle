import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// 설정: 운영 staff.html 과 같은 Supabase 공개 값 (anon key 는 이미 공개돼 있어요)
{
  const CONFIG = {
    SUPABASE_URL:      'https://izpotztbvjazfvcntqyh.supabase.co',
    SUPABASE_ANON_KEY: 'sb_publishable_ToHVeUEnJVmlHCcu_-QcnQ_ofP55Q_N',
  };
  const VAPID_PUBLIC = 'BIGMR24JXMJI0jjsqGLmUfR-IT2ry-BBHf3KoNqijazAHB91X2Gw1Lm_P3Ou7Jd0R1XQgzrZjNmdjQ1vrY7Zwrs';

  const A = window.App = window.App || {};
  A.CONFIG = CONFIG;
  A.VAPID_PUBLIC = VAPID_PUBLIC;
  A.MATEYOU_ON = true;    // 메이트유로 로그인 버튼
  A.MATEYOU_APP = true;   // 휴대폰에서 메이트유 앱(mateyou://)으로 열기. 앱 업데이트(EAS Update)가 나간 걸 사장님이 확인 (2026-11-09)
  A.supa = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}
