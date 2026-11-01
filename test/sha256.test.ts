/**
 * The SDK carries its own HMAC-SHA256 because Node 18 has no global Web Crypto,
 * so it is checked against published vectors and against the platform
 * implementation, not only against itself.
 */

import { describe, expect, it } from 'vitest';
import { hmacSha256, sha256, toHex } from '../src/sha256.js';

const encoder = new TextEncoder();
const bytes = (text: string) => encoder.encode(text);
const fromHex = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));

// Node 18 has no global Web Crypto, so the cross-check tests only run where
// there is a platform implementation to compare against.
const hasWebCrypto = typeof globalThis.crypto?.subtle?.digest === 'function';

describe('sha256', () => {
  // FIPS 180-4 examples and other widely published vectors.
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    [
      'abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq',
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    ],
    ['The quick brown fox jumps over the lazy dog', 'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592'],
  ])('hashes %j', (input, expected) => {
    expect(toHex(sha256(bytes(input)))).toBe(expected);
  });

  it.skipIf(!hasWebCrypto)('handles inputs that straddle the block and padding boundaries', async () => {
    for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
      const input = new Uint8Array(length).map((_value, index) => index % 251);
      const platform = new Uint8Array(await crypto.subtle.digest('SHA-256', input as BufferSource));
      expect(toHex(sha256(input))).toBe(toHex(platform));
    }
  });
});

describe('hmacSha256', () => {
  // RFC 4231 test cases 1, 2, 3 and 6 (the last has a key longer than a block).
  it('matches the RFC 4231 vectors', () => {
    expect(toHex(hmacSha256(fromHex('0b'.repeat(20)), bytes('Hi There')))).toBe(
      'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7',
    );
    expect(toHex(hmacSha256(bytes('Jefe'), bytes('what do ya want for nothing?')))).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    expect(toHex(hmacSha256(fromHex('aa'.repeat(20)), fromHex('dd'.repeat(50))))).toBe(
      '773ea91e36800e46854db8ebd09181a72959098b3ef8c122d9635514ced565fe',
    );
    expect(
      toHex(hmacSha256(fromHex('aa'.repeat(131)), bytes('Test Using Larger Than Block-Size Key - Hash Key First'))),
    ).toBe('60e431591ee0b67f0d8a26aacbf5b77f8e0bc6213728c5140546040f0ee37f54');
  });

  it.skipIf(!hasWebCrypto)('agrees with Web Crypto on random inputs', async () => {
    for (const [secretLength, bodyLength] of [
      [1, 0],
      [16, 64],
      [64, 65],
      [100, 500],
    ]) {
      const secret = crypto.getRandomValues(new Uint8Array(secretLength as number));
      const body = crypto.getRandomValues(new Uint8Array(bodyLength as number));
      const key = await crypto.subtle.importKey('raw', secret as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, [
        'sign',
      ]);
      const platform = new Uint8Array(await crypto.subtle.sign('HMAC', key, body as BufferSource));
      expect(toHex(hmacSha256(secret, body))).toBe(toHex(platform));
    }
  });
});
