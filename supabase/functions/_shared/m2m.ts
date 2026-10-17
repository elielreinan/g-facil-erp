const encoder = new TextEncoder();

export type M2MClaims = {
  aud: string;
  body_sha256: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  scope: string;
  sub: string;
};

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function decodeKey(value: string): Uint8Array {
  return Uint8Array.from(atob(value.trim()), (character) => character.charCodeAt(0));
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function signM2MToken(
  claims: M2MClaims,
  privateKeyBase64: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'pkcs8',
    decodeKey(privateKeyBase64),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const header = base64UrlEncode(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })));
  const payload = base64UrlEncode(encoder.encode(JSON.stringify(claims)));
  const signingInput = `${header}.${payload}`;
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    encoder.encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyM2MToken(
  token: string,
  publicKeyBase64: string,
): Promise<M2MClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header: unknown;
  let claims: unknown;
  let signature: Uint8Array;
  try {
    header = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[0])));
    claims = JSON.parse(new TextDecoder().decode(base64UrlDecode(parts[1])));
    signature = base64UrlDecode(parts[2]);
  } catch {
    return null;
  }
  if (
    !header ||
    typeof header !== 'object' ||
    (header as Record<string, unknown>).alg !== 'RS256' ||
    (header as Record<string, unknown>).typ !== 'JWT' ||
    !claims ||
    typeof claims !== 'object'
  ) {
    return null;
  }

  const parsed = claims as Partial<M2MClaims>;
  if (
    typeof parsed.aud !== 'string' ||
    typeof parsed.body_sha256 !== 'string' ||
    typeof parsed.exp !== 'number' ||
    typeof parsed.iat !== 'number' ||
    typeof parsed.iss !== 'string' ||
    typeof parsed.jti !== 'string' ||
    typeof parsed.scope !== 'string' ||
    typeof parsed.sub !== 'string'
  ) {
    return null;
  }

  const key = await crypto.subtle.importKey(
    'spki',
    decodeKey(publicKeyBase64),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signature,
    new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  return valid ? (parsed as M2MClaims) : null;
}
