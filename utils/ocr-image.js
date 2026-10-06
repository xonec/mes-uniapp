import { hashImageData } from './ocr-image-hash.js'

const MAX_IMAGE_BYTES = 700 * 1024
const fitsFreeOcr = dataUrl => (dataUrl.length - dataUrl.indexOf(',') - 1) * 3 / 4 <= MAX_IMAGE_BYTES

/** 区分原图不同、但预处理结果相同的照片，避免页面误判已经识别。 */
export function ocrImageIdentity(image) {
    return image.originalHash && image.processedHash ? image.originalHash + '|' + image.processedHash : String(image.originalPath || '') + '|' + String(image.dataUrl || '')
}

/** 保留相机/相册原图路径，另生成符合免费 OCR 限制的预处理图片。 */
export async function chooseOcrImages(sourceType = ['album', 'camera'], existing = []) {
    const remaining = 6 - existing.length
    if (remaining < 1) throw new Error('最多选择 6 张照片，请先清空照片再重新选择')
    const result = await new Promise((resolve, reject) => uni.chooseImage({ count: remaining, sourceType, sizeType: ['original'], success: resolve, fail: reject }))
    const files = result.tempFilePaths || []
    const images = existing.slice()
    for (let index = 0; index < files.length; index++) {
        const original = files[index]
        const reportedSize = Number(result.tempFiles && result.tempFiles[index] && result.tempFiles[index].size) || 0
        if (reportedSize > 20 * 1024 * 1024) throw new Error('原图单张上限 20 MB，请选择体积较小的原图')
        const originalInfo = await hashImageData(await readImageDataUrl(original))
        if (!originalInfo.mime) throw new Error('原图须为 JPG、PNG、WebP 或 GIF，请重新选择支持的原图')
        if (images.some(image => image.originalHash === originalInfo.hash)) continue
        const originalSize = originalInfo.size
        if (originalSize > 20 * 1024 * 1024 || images.reduce((total, image) => total + (image.originalSize || 0), originalSize) > 40 * 1024 * 1024) throw new Error('原图单张上限 20 MB、合计上限 40 MB，请减少照片页数')
        const originalHash = originalInfo.hash
        // #ifdef H5
        const browserDataUrl = await compressBrowserImage(original)
        images.push({ path: original, originalPath: original, originalSize, originalHash, processedHash: (await hashImageData(browserDataUrl)).hash, dataUrl: browserDataUrl })
        continue
        // #endif
        // #ifndef H5
        const compressed = await compressPlatformImage(original)
        images.push({ ...compressed, path: original, originalPath: original, originalSize, originalHash, processedHash: (await hashImageData(compressed.dataUrl)).hash, processedPath: compressed.path })
        // #endif
    }
    if (images.length > 6 || images.reduce((total, image) => total + image.dataUrl.length, 0) > 6 * 1024 * 1024) throw new Error('照片数量或总大小过大，请清空照片后减少页数重新选择')
    return images
}

// #ifdef H5
/** 在浏览器中缩放照片，避免原始相机照片超过云函数请求大小。 */
function compressBrowserImage(path) {
    return new Promise((resolve, reject) => {
        const image = new Image()
        image.onload = () => {
            try {
                for (const [edge, quality] of [[1600, .82], [1600, .68], [1400, .58], [1200, .48]]) {
                    const scale = Math.min(1, edge / Math.max(image.naturalWidth, image.naturalHeight))
                    const canvas = document.createElement('canvas')
                    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
                    const context = canvas.getContext('2d')
                    context.fillStyle = 'white'; context.fillRect(0, 0, canvas.width, canvas.height)
                    context.drawImage(image, 0, 0, canvas.width, canvas.height)
                    const dataUrl = canvas.toDataURL('image/jpeg', quality)
                    if (fitsFreeOcr(dataUrl)) { resolve(dataUrl); return }
                }
                reject(new Error('照片仍超过免费 OCR 的大小限制，请裁切单据区域后重选'))
            } catch (error) { reject(new Error('图片压缩失败，请重新选择照片')) }
        }
        image.onerror = () => reject(new Error('读取图片失败，请重试'))
        image.src = path
    })
}
// #endif

// #ifndef H5
/** 在 App/小程序逐级压缩，超限时停止提交以免浪费免费额度。 */
async function compressPlatformImage(original) {
    const info = await new Promise(resolve => uni.getImageInfo({ src: original, success: resolve, fail: () => resolve({}) }))
    for (const [edge, quality] of [[1600, 75], [1600, 60], [1400, 50], [1200, 40]]) {
        const scale = info.width && info.height ? Math.min(1, edge / Math.max(info.width, info.height)) : 1
        const dimensions = info.width && info.height ? { compressedWidth: Math.max(1, Math.round(info.width * scale)), compressedHeight: Math.max(1, Math.round(info.height * scale)) } : { compressedWidth: edge }
        const path = await new Promise(resolve => uni.compressImage({ src: original, quality, ...dimensions, success: image => resolve(image.tempFilePath), fail: () => resolve(original) }))
        const dataUrl = await readImageDataUrl(path)
        if (fitsFreeOcr(dataUrl)) return { path, dataUrl }
    }
    throw new Error('照片仍超过免费 OCR 的大小限制，请裁切单据区域后重选')
}
// #endif

/** 读取各端临时图片；H5 使用浏览器 FileReader。 */
export function readImageDataUrl(filePath) {
    // #ifdef APP-PLUS
    return new Promise((resolve, reject) => plus.io.resolveLocalFileSystemURL(filePath, entry => entry.file(file => {
        const reader = new plus.io.FileReader()
        reader.onloadend = event => event.target && event.target.result ? resolve(event.target.result) : reject(new Error('读取图片失败'))
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(file)
    }, reject), reject))
    // #endif
    // #ifdef H5
    return fetch(filePath).then(response => {
        if (!response.ok) throw new Error('读取图片失败')
        return response.blob()
    }).then(blob => new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(reader.result)
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(blob)
    }))
    // #endif
    // #ifndef APP-PLUS
    // #ifndef H5
    return new Promise((resolve, reject) => uni.getFileSystemManager().readFile({
        filePath, encoding: 'base64',
        success: result => {
            const ext = (String(filePath).match(/\.(png|webp|gif)(?:\?|$)/i) || [])[1] || 'jpeg'
            resolve('data:image/' + ext.toLowerCase() + ';base64,' + result.data)
        }, fail: () => reject(new Error('读取图片失败'))
    }))
    // #endif
    // #endif
}
