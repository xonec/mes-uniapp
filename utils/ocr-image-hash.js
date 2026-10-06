const SHA256_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const BASE64_VALUES = new Int16Array(128)
BASE64_VALUES.fill(-1)
for (let index = 0; index < BASE64_ALPHABET.length; index++) BASE64_VALUES[BASE64_ALPHABET.charCodeAt(index)] = index
const rotate = (value, bits) => (value >>> bits) | (value << (32 - bits))

/** 按原始图片字节计算 SHA-256；逐块解码，兼容 App、小程序和 H5，不依赖浏览器加密接口。 */
export async function hashImageData(dataUrl) {
    const marker = typeof dataUrl === 'string' ? dataUrl.indexOf(';base64,') : -1
    if (marker < 0) throw new Error('图片数据不完整，请重新选图')
    const start = marker + 8
    const length = dataUrl.length - start
    if (!length || length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(dataUrl.slice(start))) throw new Error('图片数据不完整，请重新选图')
    const size = length / 4 * 3 - (dataUrl.endsWith('==') ? 2 : dataUrl.endsWith('=') ? 1 : 0)
    const state = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]
    const block = new Uint8Array(64)
    const header = new Uint8Array(12)
    const words = new Int32Array(64)
    let used = 0, decoded = 0
    const processBlock = () => {
        for (let index = 0; index < 16; index++) {
            const offset = index * 4
            words[index] = (block[offset] << 24) | (block[offset + 1] << 16) | (block[offset + 2] << 8) | block[offset + 3]
        }
        for (let index = 16; index < 64; index++) {
            const first = words[index - 15], second = words[index - 2]
            const s0 = rotate(first, 7) ^ rotate(first, 18) ^ (first >>> 3)
            const s1 = rotate(second, 17) ^ rotate(second, 19) ^ (second >>> 10)
            words[index] = (words[index - 16] + s0 + words[index - 7] + s1) | 0
        }
        let [a, b, c, d, e, f, g, h] = state
        for (let index = 0; index < 64; index++) {
            const s1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25)
            const choice = (e & f) ^ (~e & g)
            const first = (h + s1 + choice + SHA256_K[index] + words[index]) | 0
            const s0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22)
            const majority = (a & b) ^ (a & c) ^ (b & c)
            h = g; g = f; f = e; e = (d + first) | 0
            d = c; c = b; b = a; a = (first + s0 + majority) | 0
        }
        const values = [a, b, c, d, e, f, g, h]
        for (let index = 0; index < 8; index++) state[index] = (state[index] + values[index]) | 0
    }
    const put = value => {
        if (decoded < header.length) header[decoded] = value
        decoded++
        block[used++] = value
        if (used === 64) { processBlock(); used = 0 }
    }
    for (let offset = start; offset < dataUrl.length; offset += 4) {
        const a = BASE64_VALUES[dataUrl.charCodeAt(offset)], b = BASE64_VALUES[dataUrl.charCodeAt(offset + 1)]
        const c = BASE64_VALUES[dataUrl.charCodeAt(offset + 2)], d = BASE64_VALUES[dataUrl.charCodeAt(offset + 3)]
        put((a << 2) | (b >>> 4))
        if (dataUrl[offset + 2] !== '=') put((b << 4) | (c >>> 2))
        if (dataUrl[offset + 3] !== '=') put((c << 6) | d)
        if (offset > start && (offset - start) % (1024 * 1024) === 0) await new Promise(resolve => setTimeout(resolve, 0))
    }
    put(0x80)
    while (used !== 56) put(0)
    const high = Math.floor(size / 0x20000000), low = size * 8
    for (let shift = 24; shift >= 0; shift -= 8) put(high >>> shift)
    for (let shift = 24; shift >= 0; shift -= 8) put(low >>> shift)
    let mime = ''
    if (size >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) mime = 'image/jpeg'
    else if (size >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => header[index] === value)) mime = 'image/png'
    else if (size >= 6 && /^GIF8[79]a$/.test(String.fromCharCode(...header.slice(0, 6)))) mime = 'image/gif'
    else if (size >= 12 && String.fromCharCode(...header.slice(0, 4)) === 'RIFF' && String.fromCharCode(...header.slice(8, 12)) === 'WEBP') mime = 'image/webp'
    return { hash: state.map(value => ('00000000' + (value >>> 0).toString(16)).slice(-8)).join(''), size, mime }
}
