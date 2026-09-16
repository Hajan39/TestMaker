/**
 * pdf.js 6 volá `Uint8Array#toHex`, `toBase64` a `Uint8Array.fromBase64` (ES2025).
 * Node 24 a starší prohlížeče je nemají a pdf.js pak spadne na
 * „hashOriginal.toHex is not a function“. Doplní se jen to, co chybí.
 */
type U8 = Uint8Array & {
  toHex?: () => string
  toBase64?: () => string
}
type U8Ctor = typeof Uint8Array & { fromBase64?: (s: string) => Uint8Array }

const proto = Uint8Array.prototype as U8
const ctor = Uint8Array as U8Ctor

if (typeof proto.toHex !== 'function') {
  proto.toHex = function toHex(this: Uint8Array) {
    let out = ''
    for (const b of this) out += b.toString(16).padStart(2, '0')
    return out
  }
}

if (typeof proto.toBase64 !== 'function') {
  proto.toBase64 = function toBase64(this: Uint8Array) {
    if (typeof Buffer !== 'undefined') return Buffer.from(this).toString('base64')
    let s = ''
    for (const b of this) s += String.fromCharCode(b)
    return btoa(s)
  }
}

if (typeof ctor.fromBase64 !== 'function') {
  ctor.fromBase64 = (s: string) =>
    typeof Buffer !== 'undefined'
      ? new Uint8Array(Buffer.from(s, 'base64'))
      : Uint8Array.from(atob(s), (c) => c.charCodeAt(0))
}
