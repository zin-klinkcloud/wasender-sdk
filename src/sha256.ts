/**
 * A small HMAC-SHA256, used for webhook signatures where Web Crypto is not
 * available synchronously or at all.
 *
 * Why this exists: `crypto.subtle` is only global from Node 19 onwards, so on
 * Node 18 (which this package supports) there is no Web Crypto unless the
 * runtime was started with a flag. Importing `node:crypto` instead would make
 * the bundle unusable in the browser and on the edge, and taking a dependency
 * would break the package's zero-dependency promise. So the fallback is here,
 * implemented straight from FIPS 180-4 and RFC 2104, and checked against the
 * RFC 4231 test vectors and against Web Crypto in the test suite.
 *
 * `verifyWebhook()` prefers Web Crypto whenever the runtime has it.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98,
  0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8,
  0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819,
  0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
  0xc67178f2,
]);

const BLOCK_SIZE = 64;
const DIGEST_SIZE = 32;

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

/** SHA-256 of `message`, as 32 bytes. */
export function sha256(message: Uint8Array): Uint8Array {
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);

  // Pad to a multiple of the block size: 0x80, zeroes, then the 64-bit length.
  const length = message.length;
  const total = Math.ceil((length + 9) / BLOCK_SIZE) * BLOCK_SIZE;
  const buffer = new Uint8Array(total);
  buffer.set(message);
  buffer[length] = 0x80;
  const view = new DataView(buffer.buffer);
  view.setUint32(total - 8, Math.floor(length / 0x20000000), false);
  view.setUint32(total - 4, (length * 8) % 0x100000000, false);

  const w = new Uint32Array(64);
  for (let offset = 0; offset < total; offset += BLOCK_SIZE) {
    for (let i = 0; i < 16; i += 1) w[i] = view.getUint32(offset + i * 4, false);
    for (let i = 16; i < 64; i += 1) {
      const x = w[i - 15] as number;
      const y = w[i - 2] as number;
      const s0 = rotr(x, 7) ^ rotr(x, 18) ^ (x >>> 3);
      const s1 = rotr(y, 17) ^ rotr(y, 19) ^ (y >>> 10);
      w[i] = ((w[i - 16] as number) + s0 + (w[i - 7] as number) + s1) >>> 0;
    }

    let a = h[0] as number;
    let b = h[1] as number;
    let c = h[2] as number;
    let d = h[3] as number;
    let e = h[4] as number;
    let f = h[5] as number;
    let g = h[6] as number;
    let acc = h[7] as number;

    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const choose = (e & f) ^ (~e & g);
      const t1 = (acc + s1 + choose + (K[i] as number) + (w[i] as number)) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (s0 + majority) >>> 0;
      acc = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }

    h[0] = ((h[0] as number) + a) >>> 0;
    h[1] = ((h[1] as number) + b) >>> 0;
    h[2] = ((h[2] as number) + c) >>> 0;
    h[3] = ((h[3] as number) + d) >>> 0;
    h[4] = ((h[4] as number) + e) >>> 0;
    h[5] = ((h[5] as number) + f) >>> 0;
    h[6] = ((h[6] as number) + g) >>> 0;
    h[7] = ((h[7] as number) + acc) >>> 0;
  }

  const digest = new Uint8Array(DIGEST_SIZE);
  const out = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) out.setUint32(i * 4, h[i] as number, false);
  return digest;
}

/** HMAC-SHA256 of `message` under `key`, as 32 bytes. */
export function hmacSha256(key: Uint8Array, message: Uint8Array): Uint8Array {
  const shortened = key.length > BLOCK_SIZE ? sha256(key) : key;
  const padded = new Uint8Array(BLOCK_SIZE);
  padded.set(shortened);

  const inner = new Uint8Array(BLOCK_SIZE + message.length);
  const outer = new Uint8Array(BLOCK_SIZE + DIGEST_SIZE);
  for (let i = 0; i < BLOCK_SIZE; i += 1) {
    inner[i] = (padded[i] as number) ^ 0x36;
    outer[i] = (padded[i] as number) ^ 0x5c;
  }
  inner.set(message, BLOCK_SIZE);
  outer.set(sha256(inner), BLOCK_SIZE);
  return sha256(outer);
}

/** Lowercase hex of `bytes`. */
export function toHex(bytes: Uint8Array): string {
  let hex = '';
  for (const byte of bytes) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
