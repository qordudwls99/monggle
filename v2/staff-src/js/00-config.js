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
  A.supa = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
}
