import crypto from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const DEV_FALLBACK_QR_SECRET = 'pisp-dev-fallback-qr-key-do-not-use-in-prod';
const EPHEMERAL_PROD_QR_SECRET = crypto.randomBytes(32).toString('hex');

function getQrSecret(): string {
  const explicit = process.env.QR_TOKEN_SECRET?.trim();
  if (explicit && explicit.length >= 16) return explicit;

  const jwtSecret = process.env.JWT_SECRET?.trim();
  if (jwtSecret && jwtSecret.length >= 16) return jwtSecret;

  if (process.env.NODE_ENV === 'production') {
    return EPHEMERAL_PROD_QR_SECRET;
  }
  return DEV_FALLBACK_QR_SECRET;
}

function encodeBase32(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

function decodeBase32(str: string): Buffer | null {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (let i = 0; i < str.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(str[i]);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

function encodeOpaqueToken(kind: 'E' | 'G', id: number): string {
  const safeId = Number.isInteger(id) && id > 0 ? id : 0;
  const secret = getQrSecret();

  const kindByte = kind === 'E' ? 0x45 : 0x47;
  const mac6 = crypto
    .createHmac('sha256', secret)
    .update(`qr-v1:${kind}:${safeId}`)
    .digest()
    .subarray(0, 6);

  const mask4 = crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from('mask:'), mac6]))
    .digest()
    .subarray(0, 4);

  const idBuf = Buffer.allocUnsafe(4);
  idBuf.writeUInt32BE(safeId >>> 0, 0);

  const obfBuf = Buffer.from([
    idBuf[0] ^ mask4[0],
    idBuf[1] ^ mask4[1],
    idBuf[2] ^ mask4[2],
    idBuf[3] ^ mask4[3],
  ]);

  const raw = Buffer.concat([Buffer.from([kindByte]), obfBuf, mac6]);
  return encodeBase32(raw);
}

export function encodeEquipmentQrToken(equipmentId: number): string {
  return encodeOpaqueToken('E', equipmentId);
}

export function encodeGroupQrToken(batchId: number): string {
  return encodeOpaqueToken('G', batchId);
}

export function decodeOpaqueQrToken(
  input: string
): { kind: 'equipment' | 'group'; id: number } | null {
  if (!input || typeof input !== 'string') return null;

  const clean = input.trim().replace(/[\s-]+/g, '').toUpperCase();
  if (!/^[A-Z2-7]{18}$/.test(clean)) {
    return null;
  }

  const raw = decodeBase32(clean);
  if (!raw || raw.length !== 11) {
    return null;
  }

  const kindByte = raw[0];
  if (kindByte !== 0x45 && kindByte !== 0x47) {
    return null;
  }
  const kind: 'E' | 'G' = kindByte === 0x45 ? 'E' : 'G';

  const obfBuf = raw.subarray(1, 5);
  const mac6 = raw.subarray(5, 11);
  const secret = getQrSecret();

  const mask4 = crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([Buffer.from('mask:'), mac6]))
    .digest()
    .subarray(0, 4);

  const idBuf = Buffer.from([
    obfBuf[0] ^ mask4[0],
    obfBuf[1] ^ mask4[1],
    obfBuf[2] ^ mask4[2],
    obfBuf[3] ^ mask4[3],
  ]);

  const id = idBuf.readUInt32BE(0);
  if (!Number.isSafeInteger(id) || id <= 0) {
    return null;
  }

  const expectedMac6 = crypto
    .createHmac('sha256', secret)
    .update(`qr-v1:${kind}:${id}`)
    .digest()
    .subarray(0, 6);

  if (!crypto.timingSafeEqual(mac6, expectedMac6)) {
    return null;
  }

  return {
    kind: kind === 'E' ? 'equipment' : 'group',
    id,
  };
}
