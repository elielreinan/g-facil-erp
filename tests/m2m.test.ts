import { beforeAll, describe, expect, it } from 'vitest';
import {
  sha256Hex,
  signM2MToken,
  verifyM2MToken,
  type M2MClaims,
} from '../supabase/functions/_shared/m2m';

let privateKeyBase64: string;
let publicKeyBase64: string;

function toBase64(value: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(value)));
}

function toBase64Url(value: unknown): string {
  return btoa(JSON.stringify(value))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '');
}

describe('M2M token helpers', () => {
  beforeAll(async () => {
    const keyPair = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const [privateKey, publicKey] = await Promise.all([
      crypto.subtle.exportKey('pkcs8', keyPair.privateKey),
      crypto.subtle.exportKey('spki', keyPair.publicKey),
    ]);
    privateKeyBase64 = toBase64(privateKey);
    publicKeyBase64 = toBase64(publicKey);
  });

  it('signs and verifies valid M2M claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims: M2MClaims = {
      aud: 'facil-erp-account-management',
      body_sha256: await sha256Hex('{"action":"test"}'),
      exp: now + 45,
      iat: now,
      iss: 'gfacilerp:test',
      jti: crypto.randomUUID(),
      scope: 'managed-users:write',
      sub: crypto.randomUUID(),
    };
    const token = await signM2MToken(claims, privateKeyBase64);

    await expect(verifyM2MToken(token, publicKeyBase64)).resolves.toEqual(claims);
  });

  it('rejects malformed tokens, altered claims, and invalid public keys', async () => {
    const now = Math.floor(Date.now() / 1000);
    const claims: M2MClaims = {
      aud: 'facil-erp-account-management',
      body_sha256: await sha256Hex('{"action":"test"}'),
      exp: now + 45,
      iat: now,
      iss: 'gfacilerp:test',
      jti: crypto.randomUUID(),
      scope: 'managed-users:write',
      sub: crypto.randomUUID(),
    };
    const token = await signM2MToken(claims, privateKeyBase64);
    const [header, , signature] = token.split('.');
    const alteredPayload = toBase64Url({ ...claims, scope: 'admin:all' });

    await expect(verifyM2MToken('not-a-token', publicKeyBase64)).resolves.toBeNull();
    await expect(
      verifyM2MToken(`${header}.${alteredPayload}.${signature}`, publicKeyBase64),
    ).resolves.toBeNull();
    await expect(verifyM2MToken(token, 'not-a-valid-public-key')).resolves.toBeNull();
  });
});
