import { createClient } from 'npm:@supabase/supabase-js@2';

const MATEYOU_SUB_PATTERN = /^usr_[a-f0-9]{36}$/;

function allowedOrigins(): string[] {
  return (Deno.env.get('MONGGLE_ALLOWED_ORIGINS') || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') || '';
  const allowed = allowedOrigins();
  const selected = allowed.includes(origin) ? origin : allowed[0] || '';
  return {
    ...(selected ? { 'Access-Control-Allow-Origin': selected } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(
  req: Request,
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(req),
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

function mateYouSubject(user: {
  identities?: Array<{
    provider?: string;
    identity_data?: Record<string, unknown>;
  }>;
}): string | null {
  const identity = user.identities?.find((item) =>
    item.provider === 'custom:mateyou' || item.provider === 'mateyou'
  );
  const subject = identity?.identity_data?.sub;
  return typeof subject === 'string' && MATEYOU_SUB_PATTERN.test(subject)
    ? subject
    : null;
}

Deno.serve(async (req) => {
  const headers = corsHeaders(req);
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers });
  }
  if (req.method !== 'POST') {
    return json(req, { error: 'METHOD_NOT_ALLOWED' }, 405);
  }

  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) {
    return json(req, { error: 'UNAUTHORIZED' }, 401);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const entitlementUrl = Deno.env.get('MATEYOU_ENTITLEMENT_URL');
  const serviceToken = Deno.env.get('MATEYOU_ENTITLEMENT_SERVICE_TOKEN');

  if (
    !supabaseUrl || !anonKey || !serviceRoleKey ||
    !entitlementUrl || !serviceToken
  ) {
    console.error('MateYou entitlement sync environment is incomplete');
    return json(req, { error: 'SERVICE_NOT_CONFIGURED' }, 503);
  }

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  const user = userData.user;

  if (userError || !user) {
    return json(req, { error: 'UNAUTHORIZED' }, 401);
  }

  const subject = mateYouSubject(user);
  if (!subject) {
    return json(req, { error: 'MATEYOU_IDENTITY_REQUIRED' }, 403);
  }

  let entitlementResponse: Response;
  try {
    entitlementResponse = await fetch(entitlementUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({ sub: subject }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (error) {
    console.error('MateYou entitlement request failed', error);
    return json(req, { error: 'ENTITLEMENT_UNAVAILABLE' }, 503);
  }

  if (!entitlementResponse.ok) {
    console.error(
      'MateYou entitlement request rejected',
      entitlementResponse.status,
    );
    return json(req, { error: 'ENTITLEMENT_UNAVAILABLE' }, 503);
  }

  const payload = await entitlementResponse.json() as {
    sub?: unknown;
    entitlements?: unknown;
    is_partner_plus?: unknown;
    checked_at?: unknown;
  };

  if (payload.sub !== subject || !Array.isArray(payload.entitlements)) {
    console.error('MateYou entitlement response was invalid');
    return json(req, { error: 'ENTITLEMENT_INVALID' }, 502);
  }

  const entitlements = payload.entitlements
    .filter((item): item is string => typeof item === 'string')
    .slice(0, 20);
  const identity = user.identities?.find((item) =>
    item.provider === 'custom:mateyou' || item.provider === 'mateyou'
  );
  const identityData = identity?.identity_data || {};
  const displayName = [
    identityData.name,
    identityData.full_name,
    user.user_metadata?.name,
    user.user_metadata?.full_name,
  ].find((value) => typeof value === 'string') as string | undefined;
  const avatarUrl = [
    identityData.picture,
    identityData.avatar_url,
    user.user_metadata?.picture,
    user.user_metadata?.avatar_url,
  ].find((value) => typeof value === 'string') as string | undefined;
  const email = typeof user.email === 'string' ? user.email : null;

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: upsertError } = await admin
    .from('mateyou_profiles')
    .upsert({
      user_id: user.id,
      mateyou_sub: subject,
      display_name: displayName?.slice(0, 120) || null,
      email,
      avatar_url: avatarUrl?.slice(0, 2_000) || null,
      is_partner_plus: payload.is_partner_plus === true,
      entitlements,
      entitlement_checked_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'user_id',
    });

  if (upsertError) {
    console.error('MateYou profile upsert failed', upsertError);
    return json(req, { error: 'PROFILE_SYNC_FAILED' }, 500);
  }

  return json(req, {
    ok: true,
    is_partner_plus: payload.is_partner_plus === true,
    entitlements,
  });
});
