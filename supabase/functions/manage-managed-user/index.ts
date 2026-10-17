import { createClient } from 'npm:@supabase/supabase-js@2';
import { sha256Hex, signM2MToken, type M2MClaims } from '../_shared/m2m.ts';

const PROJECT_ISSUER = 'gfacilerp:jqjvzypalurnhbkqlzpx';
const AUDIENCE = 'facil-erp-account-management';
const ALLOWED_SECTORS = new Set(['suprimentos', 'orcamentos', 'ti', 'diretoria']);

type Action =
  | { action: 'create'; nome: string; email: string; setor: string }
  | { action: 'approve' | 'reset'; user_id: string }
  | { action: 'set_status'; user_id: string; status: 'aprovado' | 'bloqueado' }
  | { action: 'set_sector'; user_id: string; setor: string };

type ManagedUser = {
  id: string;
  nome: string;
  email: string;
  setor: string;
  status: 'pendente' | 'aprovado' | 'bloqueado';
  auth_user_id: string | null;
};

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  corsHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'content-type': 'application/json; charset=utf-8' },
  });
}

function getCorsHeaders(request: Request): Record<string, string> | null {
  const origin = request.headers.get('origin');
  if (!origin) return {};

  const allowedOrigins = (Deno.env.get('ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!allowedOrigins.includes(origin)) return null;

  return {
    'access-control-allow-origin': origin,
    'access-control-allow-headers': 'authorization, apikey, x-client-info, content-type',
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '600',
    vary: 'Origin',
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.action !== 'string') return null;

  if (value.action === 'create') {
    if (
      typeof value.nome !== 'string' ||
      value.nome.trim().length < 2 ||
      value.nome.trim().length > 150 ||
      typeof value.email !== 'string' ||
      value.email.trim().length > 254 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email.trim()) ||
      typeof value.setor !== 'string' ||
      !ALLOWED_SECTORS.has(value.setor)
    ) return null;
    return {
      action: 'create',
      nome: value.nome.trim(),
      email: value.email.trim().toLowerCase(),
      setor: value.setor,
    };
  }

  if (value.action === 'approve' || value.action === 'reset') {
    return isUuid(value.user_id) ? { action: value.action, user_id: value.user_id } : null;
  }

  if (value.action === 'set_status') {
    if (!isUuid(value.user_id) || (value.status !== 'aprovado' && value.status !== 'bloqueado')) return null;
    return { action: 'set_status', user_id: value.user_id, status: value.status };
  }

  if (value.action === 'set_sector') {
    if (!isUuid(value.user_id) || typeof value.setor !== 'string' || !ALLOWED_SECTORS.has(value.setor)) {
      return null;
    }
    return { action: 'set_sector', user_id: value.user_id, setor: value.setor };
  }

  return null;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

async function callFacilERP(
  payload: Record<string, unknown>,
  administratorId: string,
): Promise<{ ok: true; authUserId?: string } | { ok: false }> {
  const url = new URL(getEnv('FACILERP_MANAGEMENT_URL'));
  const productionHost = url.hostname === 'gjhnowasfdkifxriizje.supabase.co';
  const localHost = ['localhost', '127.0.0.1'].includes(url.hostname) && url.port === '54321';
  if (
    (!productionHost && !localHost) ||
    (productionHost && url.protocol !== 'https:') ||
    (localHost && url.protocol !== 'http:') ||
    url.pathname !== '/functions/v1/gfac-account-management' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('The FacilERP management endpoint must use HTTPS.');
  }

  const body = JSON.stringify(payload);
  const now = Math.floor(Date.now() / 1000);
  const claims: M2MClaims = {
    aud: AUDIENCE,
    body_sha256: await sha256Hex(body),
    exp: now + 45,
    iat: now,
    iss: PROJECT_ISSUER,
    jti: crypto.randomUUID(),
    scope: 'managed-users:write',
    sub: administratorId,
  };
  const token = await signM2MToken(claims, getEnv('GFA_CROSS_PROJECT_PRIVATE_KEY_B64'));
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body,
    signal: AbortSignal.timeout(12_000),
  });

  if (!response.ok) {
    console.error('FacilERP management endpoint rejected an operation.', {
      status: response.status,
    });
    return { ok: false };
  }

  const result: unknown = await response.json();
  if (!isRecord(result) || (result.auth_user_id !== undefined && !isUuid(result.auth_user_id))) {
    console.error('FacilERP management endpoint returned an invalid response.');
    return { ok: false };
  }
  return {
    ok: true,
    ...(typeof result.auth_user_id === 'string' ? { authUserId: result.auth_user_id } : {}),
  };
}

async function writeAudit(
  client: ReturnType<typeof createClient>,
  administratorId: string,
  action: 'criou' | 'aprovou' | 'alterou' | 'bloqueou' | 'desbloqueou' | 'solicitou_reset',
  userId: string,
  details: Record<string, unknown>,
): Promise<void> {
  const { error } = await client.from('auditoria_administrativa').insert({
    administrador_id: administratorId,
    acao: action,
    usuario_id: userId,
    detalhes: details,
  });
  if (error) {
    console.error('Failed to persist GFacilERP audit event.', { code: error.code });
    throw new Error('The administrative action could not be fully audited.');
  }
}

async function completeManagedUserOperation(
  client: ReturnType<typeof createClient>,
  administratorId: string,
  userId: string,
  operation: 'approve' | 'set_status' | 'set_sector',
  authUserId: string,
  status: 'aprovado' | 'bloqueado' | null = null,
  sector: string | null = null,
): Promise<void> {
  const { error } = await client.rpc('complete_managed_user_operation', {
    p_administrator_id: administratorId,
    p_user_id: userId,
    p_operation: operation,
    p_auth_user_id: authUserId,
    p_status: status,
    p_sector: sector,
  });
  if (error) {
    console.error('Failed to commit managed-user state and audit atomically.', {
      code: error.code,
      operation,
    });
    throw new Error('The administrative operation requires reconciliation.');
  }
}

async function findManagedUser(
  client: ReturnType<typeof createClient>,
  userId: string,
): Promise<ManagedUser> {
  const { data, error } = await client
    .from('usuarios_gerenciados')
    .select('id,nome,email,setor,status,auth_user_id')
    .eq('id', userId)
    .single();
  if (error || !data) throw new Error('Managed user not found.');
  return data as ManagedUser;
}

async function inviteManagedUser(
  client: ReturnType<typeof createClient>,
  user: ManagedUser,
  administratorId: string,
): Promise<string> {
  const result = await callFacilERP({
    action: 'invite',
    managed_user_id: user.id,
    nome: user.nome,
    email: user.email,
    setor: user.setor,
  }, administratorId);
  if (!result.ok || !result.authUserId) {
    throw new Error('The FacilERP invitation could not be completed.');
  }

  await completeManagedUserOperation(
    client,
    administratorId,
    user.id,
    'approve',
    result.authUserId,
  );
  return result.authUserId;
}

Deno.serve(async (request: Request) => {
  const corsHeaders = getCorsHeaders(request);
  if (!corsHeaders) return jsonResponse(403, { error: 'origin_not_allowed' });
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return jsonResponse(405, { error: 'method_not_allowed' }, corsHeaders);

  try {
    const contentLength = Number(request.headers.get('content-length') ?? '0');
    if (contentLength > 8_192) return jsonResponse(413, { error: 'request_too_large' }, corsHeaders);

    const authorization = request.headers.get('authorization') ?? '';
    const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!bearer) return jsonResponse(401, { error: 'unauthorized' }, corsHeaders);

    const projectUrl = getEnv('SUPABASE_URL');
    const anonKey = getEnv('SUPABASE_ANON_KEY');
    const serviceKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    const userClient = createClient(projectUrl, anonKey, {
      global: { headers: { authorization: `Bearer ${bearer}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: claimsData, error: claimsError } = await userClient.auth.getClaims(bearer);
    if (claimsError || !claimsData?.claims?.sub) {
      return jsonResponse(401, { error: 'unauthorized' }, corsHeaders);
    }
    if (claimsData.claims.aal !== 'aal2') {
      return jsonResponse(403, { error: 'mfa_required' }, corsHeaders);
    }
    const { data: authData, error: authError } = await userClient.auth.getUser();
    if (authError || !authData.user) return jsonResponse(401, { error: 'unauthorized' }, corsHeaders);

    const adminClient = createClient(projectUrl, serviceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: administrator, error: adminError } = await adminClient
      .from('administradores')
      .select('id')
      .eq('id', authData.user.id)
      .eq('ativo', true)
      .maybeSingle();
    if (adminError) {
      console.error('Failed to validate GFacilERP administrator.', { code: adminError.code });
      return jsonResponse(503, { error: 'authorization_unavailable' }, corsHeaders);
    }
    if (!administrator) return jsonResponse(403, { error: 'forbidden' }, corsHeaders);

    const { data: withinRateLimit, error: rateLimitError } = await adminClient.rpc(
      'consume_admin_rate_limit',
      {
        p_admin_id: administrator.id,
        p_limit: 10,
        p_window_seconds: 60,
      },
    );
    if (rateLimitError) {
      console.error('Failed to enforce GFacilERP administrative rate limit.', {
        code: rateLimitError.code,
      });
      return jsonResponse(503, { error: 'rate_limit_unavailable' }, corsHeaders);
    }
    if (withinRateLimit !== true) {
      return jsonResponse(429, { error: 'rate_limit_exceeded' }, {
        ...corsHeaders,
        'retry-after': '60',
      });
    }

    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > 8_192) {
      return jsonResponse(413, { error: 'request_too_large' }, corsHeaders);
    }
    let parsedBody: unknown;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch {
      return jsonResponse(400, { error: 'invalid_json' }, corsHeaders);
    }
    const action = parseAction(parsedBody);
    if (!action) return jsonResponse(400, { error: 'invalid_request' }, corsHeaders);

    if (action.action === 'create') {
      const { data: created, error: createError } = await adminClient
        .from('usuarios_gerenciados')
        .insert({
          nome: action.nome,
          email: action.email,
          setor: action.setor,
          status: 'pendente',
        })
        .select('id,nome,email,setor,status,auth_user_id')
        .single();
      if (createError || !created) {
        console.error('Failed to create pending managed user.', { code: createError?.code });
        return jsonResponse(createError?.code === '23505' ? 409 : 503, {
          error: createError?.code === '23505' ? 'user_already_exists' : 'user_creation_failed',
        }, corsHeaders);
      }
      const user = created as ManagedUser;
      try {
        await writeAudit(adminClient, administrator.id, 'criou', user.id, {
          setor: user.setor,
          status: 'pendente',
        });
      } catch {
        const { error: cleanupError } = await adminClient
          .from('usuarios_gerenciados')
          .delete()
          .eq('id', user.id);
        if (cleanupError) {
          console.error('Failed to remove an unaudited pending user.', { code: cleanupError.code });
        }
        return jsonResponse(503, { error: 'audit_unavailable' }, corsHeaders);
      }
      try {
        await inviteManagedUser(adminClient, user, administrator.id);
      } catch {
        return jsonResponse(502, {
          error: 'invite_failed_pending',
          user_id: user.id,
        }, corsHeaders);
      }
      return jsonResponse(201, { user_id: user.id, status: 'aprovado' }, corsHeaders);
    }

    const user = await findManagedUser(adminClient, action.user_id);
    if (action.action === 'approve') {
      if (user.status === 'aprovado' && user.auth_user_id) {
        return jsonResponse(200, {
          user_id: user.id,
          auth_user_id: user.auth_user_id,
          status: user.status,
        }, corsHeaders);
      }
      if (user.status !== 'pendente') return jsonResponse(409, { error: 'invalid_user_state' }, corsHeaders);
      let authUserId: string;
      try {
        authUserId = await inviteManagedUser(adminClient, user, administrator.id);
      } catch {
        return jsonResponse(502, { error: 'invite_failed_pending', user_id: user.id }, corsHeaders);
      }
      return jsonResponse(200, { user_id: user.id, auth_user_id: authUserId, status: 'aprovado' }, corsHeaders);
    }

    if (action.action === 'set_status') {
      if (!user.auth_user_id) {
        return jsonResponse(409, { error: 'invalid_user_state' }, corsHeaders);
      }
      if (user.status === action.status) {
        return jsonResponse(200, { user_id: user.id, status: user.status }, corsHeaders);
      }
      const result = await callFacilERP({
        action: 'set_status',
        managed_user_id: user.id,
        auth_user_id: user.auth_user_id,
        status: action.status,
      }, administrator.id);
      if (!result.ok) return jsonResponse(502, { error: 'facil_erp_operation_failed' }, corsHeaders);

      try {
        await completeManagedUserOperation(
          adminClient,
          administrator.id,
          user.id,
          'set_status',
          user.auth_user_id,
          action.status,
        );
      } catch {
        return jsonResponse(503, { error: 'state_reconciliation_required' }, corsHeaders);
      }
      return jsonResponse(200, { user_id: user.id, status: action.status }, corsHeaders);
    }

    if (action.action === 'set_sector') {
      if (!user.auth_user_id) {
        return jsonResponse(409, { error: 'invalid_user_state' }, corsHeaders);
      }
      if (user.setor === action.setor) {
        return jsonResponse(200, { user_id: user.id, setor: user.setor }, corsHeaders);
      }
      const result = await callFacilERP({
        action: 'set_sector',
        managed_user_id: user.id,
        auth_user_id: user.auth_user_id,
        setor: action.setor,
      }, administrator.id);
      if (!result.ok) return jsonResponse(502, { error: 'facil_erp_operation_failed' }, corsHeaders);

      try {
        await completeManagedUserOperation(
          adminClient,
          administrator.id,
          user.id,
          'set_sector',
          user.auth_user_id,
          null,
          action.setor,
        );
      } catch {
        return jsonResponse(503, { error: 'state_reconciliation_required' }, corsHeaders);
      }
      return jsonResponse(200, { user_id: user.id, setor: action.setor }, corsHeaders);
    }

    if (action.action === 'reset') {
      if (!user.auth_user_id || user.status !== 'aprovado') {
        return jsonResponse(409, { error: 'invalid_user_state' }, corsHeaders);
      }
      const result = await callFacilERP({
        action: 'reset',
        managed_user_id: user.id,
        auth_user_id: user.auth_user_id,
      }, administrator.id);
      if (!result.ok) return jsonResponse(502, { error: 'facil_erp_operation_failed' }, corsHeaders);

      await writeAudit(adminClient, administrator.id, 'solicitou_reset', user.id, {});
      return jsonResponse(200, { user_id: user.id, reset_requested: true }, corsHeaders);
    }

    return jsonResponse(400, { error: 'invalid_request' }, corsHeaders);
  } catch (error) {
    console.error('GFacilERP account-management request failed.', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return jsonResponse(500, { error: 'account_management_failed' }, corsHeaders);
  }
});
