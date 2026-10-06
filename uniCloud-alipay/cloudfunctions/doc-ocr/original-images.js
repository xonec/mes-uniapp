'use strict'

const { createHash, randomBytes } = require('crypto')
const { ClientError } = require('mes-common')
const MAX_ORIGINAL_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 40 * 1024 * 1024

function userFolder(uid) {
    return 'ocr-originals/' + createHash('sha256').update(String(uid)).digest('hex').slice(0, 32) + '/'
}

/** 为当前登录用户生成本次原图上传目录；原图仅在需要模型时上传。 */
function originalUploadPrefix(uid, owner) {
    return userFolder(uid) + (owner || randomBytes(16).toString('hex')) + '/'
}

/** 仅接受当前用户专用目录中的云存储原图，禁止任意 URL 或其他业务文件。 */
function validateOriginalIds(ids, uid, expectedCount, expectedOwner) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 6 || (expectedCount !== undefined && ids.length !== expectedCount)) throw new ClientError('原图数量与所选照片不一致，请重新选图', 400)
    const folder = userFolder(uid)
    let group = ''
    for (const id of ids) {
        if (typeof id !== 'string' || id.length > 1024) throw new ClientError('原图文件信息非法', 400)
        const match = id.match(/^cloud:\/\/[A-Za-z0-9_.-]+\/(ocr-originals\/[a-f0-9]{32}\/([a-f0-9]{32})\/([0-5])\.image)$/)
        if (!match || !match[1].startsWith(folder)) throw new ClientError('原图文件不属于当前用户，请重新选图', 403)
        if (expectedOwner && match[2] !== expectedOwner) throw new ClientError('原图文件与本次上传状态不一致', 403)
        if (group && group !== match[2]) throw new ClientError('原图须属于同一组选图', 400)
        group = match[2]
    }
    if (new Set(ids).size !== ids.length) throw new ClientError('原图文件不能重复提交', 400)
    return ids
}

function imageMime(bytes) {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
    if (bytes.length >= 6 && /^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
    if (bytes.length >= 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
    throw new ClientError('原图须为 JPG、PNG、WebP 或 GIF，请重新选择支持的原图', 400)
}

/** 下载原始文件并直接编码为模型图片输入，保持原始字节，不缩放或重新压缩。 */
async function loadOriginalImages(ids, deadline, expectedHashes) {
    const images = []
    let totalBytes = 0
    for (let index = 0; index < ids.length; index++) {
        const id = ids[index]
        if (deadline - Date.now() < 5000) throw new ClientError('原图读取耗时较长，请减少照片页数后重试', 503)
        let downloaded
        try { downloaded = await uniCloud.downloadFile({ fileID: id }) }
        catch (error) { throw new ClientError('原图读取失败，请重新选图或稍后重试', 503) }
        const bytes = downloaded && downloaded.fileContent
        if (!Buffer.isBuffer(bytes) || !bytes.length) throw new ClientError('原图读取失败，请重新选图', 503)
        if (createHash('sha256').update(bytes).digest('hex') !== expectedHashes[index]) throw new ClientError('原图内容校验失败，请清空照片后重新选择；尚未调用大模型', 400)
        totalBytes += bytes.length
        if (bytes.length > MAX_ORIGINAL_BYTES || totalBytes > MAX_TOTAL_BYTES) throw new ClientError('原图单张上限 20 MB、合计上限 40 MB，请减少页数或选择体积较小的原图', 400)
        images.push('data:' + imageMime(bytes) + ';base64,' + bytes.toString('base64'))
    }
    return Array.from(new Set(images))
}

/** 清理本次识别上传的临时原图；调用方先验证目录归属。 */
async function cleanupOriginalImages(ids) {
    if (ids.length) await uniCloud.deleteFile({ fileList: ids })
}

module.exports = { originalUploadPrefix, validateOriginalIds, loadOriginalImages, cleanupOriginalImages }
