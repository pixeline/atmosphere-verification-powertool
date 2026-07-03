import crypto from 'node:crypto'

function key(): Buffer {
  const k = Buffer.from(process.env.VIDI_TOKEN_ENC_KEY ?? '', 'base64')
  if (k.length !== 32) throw new Error('VIDI_TOKEN_ENC_KEY must be 32 bytes base64')
  return k
}

export function encryptJson(obj: unknown): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv)
  const pt = Buffer.from(JSON.stringify(obj), 'utf8')
  const ct = Buffer.concat([cipher.update(pt), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, ct]).toString('base64')
}

export function decryptJson<T>(s: string): T {
  const buf = Buffer.from(s, 'base64')
  const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return JSON.parse(pt.toString('utf8')) as T
}
