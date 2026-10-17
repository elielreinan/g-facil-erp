import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { sha256Hex, signM2MToken, type M2MClaims } from '../_shared/m2m.ts';

const PROJECT_ISSUER = 'gfacilerp:jqjvzypalurnhbkqlzpx';
const AUDIENCE = 'facil-erp-account-management';
const ALLOWED_SECTORS = new Set(['suprimentos', 'orcamentos', 'ti', 'diretoria']);

type Action =
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
type Json = string | number | boolean | null | { [key: string]: Json } | Json[];
type JsonObject = { [key: string]: Json };
type Table<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};
type Database = {
  public: {
    Tables: {
      administradores: Table<
        { id: string; nome: string; ativo: boolean; criado_em: string },
        { id: string; nome: string; ativo?: boolean; criado_em?: string }
      >;
      usuarios_gerenciados: Table<
        {
          id: string;
          auth_user_id: string | null;
          nome: string;
          email: string;
          setor: string;
          status: 'pendente' | 'aprovado' | 'bloqueado';
          criado_em: string;
          atualizado_em: string;
        },
        {
          id?: string;
          auth_user_id?: string | null;
          nome: string;
          email: string;
          setor: string;
          status?: 'pendente' | 'aprovado' | 'bloqueado';
          criado_em?: string;
          atualizado_em?: string;
        }
      >;
      auditoria_administrativa: Table<
        {
          id: string;
          administrador_id: string;
          acao: string;
          usuario_id: string | null;
          detalhes: Json;
          criado_em: string;
        },
        {
          id?: string;
          administrador_id: string;
          acao: string;
          usuario_id?: string | null;
          detalhes?: Json;
          criado_em?: string;
        }
      >;
    };
    Views: Record<string, never>;
    Functions: {
      begin_admin_idempotent_request: {
        Args: {
          p_administrator_id: string;
          p_idempotency_key: string;
          p_request_hash: string;
        };
        Returns: Array<{
          outcome: string;
          response_status: number | null;
          response_body: Json | null;
        }>;
      };
      complete_admin_idempotent_request: {
        Args: {
          p_administrator_id: string;
          p_idempotency_key: string;
          p_request_hash: string;
          p_response_status: number;
          p_response_body: Json;
        };
        Returns: undefined;
      };
      complete_managed_user_operation: {
        Args: {
          p_administrator_id: string;
          p_user_id: string;
          p_operation: string;
          p_auth_user_id: string;
          p_status: string | null;
          p_sector: string | null;
        };
        Returns: undefined;
      };
      consume_admin_rate_limit: {
        Args: { p_admin_id: string; p_limit: number; p_window_seconds: number };
        Returns: boolean;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
type AdminClient = SupabaseClient<Database, 'public'>;
type ParsedRequest = { idempotencyKey: string; action: Action };
type IdempotencyDecision =
  | { outcome: 'started'; requestHash: string }
  | { outcome: 'in_progress' | 'conflict'; requestHash: string }
  | { outcome: 'completed'; requestHash: string; responseStatus: number; responseBody: JsonObject };

function jsonResponse(
  status: number,
  body: JsonObject,
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

function isJson(value: unknown): value is Json {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJson);
  return isRecord(value) && Object.values(value).every(isJson);
}

function isJsonObject(value: unknown): value is JsonObject {
  return isRecord(value) && Object.values(value).every(isJson);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseManagementAction(value: unknown): Action | null {
  if (!isRecord(value) || typeof value.action !== 'string') return null;

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

function parseAction(value: unknown): ParsedRequest | null {
  if (!isRecord(value) || !isUuid(value.idempotency_key)) return null;
  const { idempotency_key: idempotencyKey, ...actionPayload } = value;
  const action = parseManagementAction(actionPayload);
  return action ? { idempotencyKey, action } : null;
}

function getEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Missing required server configuration: ${name}`);
  return value;
}

async function beginIdempotentRequest(
  client: AdminClient,
  administratorId: string,
  idempotencyKey: string,
  action: Action,
): Promise<IdempotencyDecision> {
  const requestHash = await sha256Hex(JSON.stringify(action));
  const { data, error } = await client.rpc('begin_admin_idempotent_request', {
    p_administrator_id: administratorId,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
  });
  if (error) {
    console.error('Failed to claim GFacilERP idempotent operation.', { code: error.code });
    throw new Error('Idempotency protection is unavailable.');
  }
  const result = Array.isArray(data) ? data[0] : null;
  if (
    !isRecord(result) ||
    typeof result.outcome !== 'string' ||
    !['started', 'in_progress', 'conflict', 'completed'].includes(result.outcome)
  ) {
    throw new Error('GFacilERP returned an invalid idempotency result.');
  }
  if (result.outcome === 'completed') {
    if (
      typeof result.response_status !== 'number' ||
      !isJsonObject(result.response_body)
    ) {
      throw new Error('GFacilERP returned an invalid cached response.');
    }
    return {
      outcome: 'completed',
      requestHash,
      responseStatus: result.response_status,
      responseBody: result.response_body,
    };
  }
  if (result.outcome === 'started') return { outcome: 'started', requestHash };
  if (result.outcome === 'in_progress' || result.outcome === 'conflict') {
    return { outcome: result.outcome, requestHash };
  }
  throw new Error('GFacilERP returned an invalid idempotency outcome.');
}

async function completeIdempotentRequest(
  client: AdminClient,
  administratorId: string,
  idempotencyKey: string,
  requestHash: string,
  responseStatus: number,
  responseBody: JsonObject,
): Promise<void> {
  const { error } = await client.rpc('complete_admin_idempotent_request', {
    p_administrator_id: administratorId,
    p_idempotency_key: idempotencyKey,
    p_request_hash: requestHash,
    p_response_status: responseStatus,
    p_response_body: responseBody,
  });
  if (error) {
    console.error('Failed to persist GFacilERP idempotent response.', { code: error.code });
    throw new Error('The operation result could not be safely recorded.');
  }
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
  client: AdminClient,
  administratorId: string,
  action: 'criou' | 'aprovou' | 'alterou' | 'bloqueou' | 'desbloqueou' | 'solicitou_reset',
  userId: string,
  details: JsonObject,
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
  client: AdminClient,
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
  client: AdminClient,
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
    const userClient = createClient<Database>(projectUrl, anonKey, {
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

    const adminClient = createClient<Database>(projectUrl, serviceKey, {
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
    if (
      isRecord(parsedBody) &&
      typeof parsedBody.action === 'string' &&
      ['create', 'approve', 'reset'].includes(parsedBody.action)
    ) {
      return jsonResponse(503, { error: 'email_actions_unavailable' }, corsHeaders);
    }
    const parsedRequest = parseAction(parsedBody);
    if (!parsedRequest) return jsonResponse(400, { error: 'invalid_request' }, corsHeaders);
    const { action, idempotencyKey } = parsedRequest;
    const idempotency = await beginIdempotentRequest(
      adminClient,
      administrator.id,
      idempotencyKey,
      action,
    );
    if (idempotency.outcome === 'conflict') {
      return jsonResponse(409, { error: 'idempotency_key_reused' }, corsHeaders);
    }
    if (idempotency.outcome === 'in_progress') {
      return jsonResponse(409, { error: 'operation_in_progress' }, corsHeaders);
    }
    if (idempotency.outcome === 'completed') {
      return jsonResponse(idempotency.responseStatus, idempotency.responseBody, corsHeaders);
    }

    const respond = async (status: number, body: JsonObject) => {
      await completeIdempotentRequest(
        adminClient,
        administrator.id,
        idempotencyKey,
        idempotency.requestHash,
        status,
        body,
      );
      return jsonResponse(status, body, corsHeaders);
    };

    try {
      const user = await findManagedUser(adminClient, action.user_id);
      if (action.action === 'set_status') {
        if (action.status === 'aprovado' && user.status === 'pendente') {
          return await respond(503, { error: 'email_actions_unavailable' });
        }
        if (!user.auth_user_id) {
          return await respond(409, { error: 'invalid_user_state' });
        }
        if (user.status === action.status) {
          return await respond(200, { user_id: user.id, status: user.status });
        }
        const result = await callFacilERP({
          action: 'set_status',
          managed_user_id: user.id,
          auth_user_id: user.auth_user_id,
          status: action.status,
        }, administrator.id);
        if (!result.ok) return await respond(502, { error: 'facil_erp_operation_failed' });

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
          return await respond(503, { error: 'state_reconciliation_required' });
        }
        return await respond(200, { user_id: user.id, status: action.status });
      }

      if (action.action === 'set_sector') {
        if (!user.auth_user_id) {
          return await respond(409, { error: 'invalid_user_state' });
        }
        if (user.setor === action.setor) {
          return await respond(200, { user_id: user.id, setor: user.setor });
        }
        const result = await callFacilERP({
          action: 'set_sector',
          managed_user_id: user.id,
          auth_user_id: user.auth_user_id,
          setor: action.setor,
        }, administrator.id);
        if (!result.ok) return await respond(502, { error: 'facil_erp_operation_failed' });

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
          return await respond(503, { error: 'state_reconciliation_required' });
        }
        return await respond(200, { user_id: user.id, setor: action.setor });
      }

      return await respond(400, { error: 'invalid_request' });
    } catch (error) {
      console.error('GFacilERP idempotent operation failed.', {
        error: error instanceof Error ? error.name : 'unknown',
      });
      return await respond(500, { error: 'account_management_failed' });
    }
  } catch (error) {
    console.error('GFacilERP account-management request failed.', {
      error: error instanceof Error ? error.name : 'unknown',
    });
    return jsonResponse(500, { error: 'account_management_failed' }, corsHeaders);
  }
});
