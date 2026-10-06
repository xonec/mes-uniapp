export const OCR_PROTOCOL_VERSION = 4
const SERVICE_CHECK_TTL = 60000
let serviceCheckedAt = 0
let serviceCapabilities = null

/** 校验云端授予的上传状态，仅在持有有效状态时发送图片。 */
function uploadStateFor(result) {
    if (!/^[a-f0-9]{32}$/.test(String(result.uploadOwner || '')) || !/^upload:c:[a-f0-9]{64}$/.test(String(result.uploadKey || ''))) throw new Error('图片上传信息异常，请重新识别')
    return { uploadKey: result.uploadKey, uploadOwner: result.uploadOwner }
}

/** 失败时清理当前上传状态及已上传原图；服务端也会在处理结束后清理。 */
async function cleanupUpload(call, uploadState, originalFileIds = []) {
    try { await call('doc-ocr', 'cleanupOriginals', { ...uploadState, originalFileIds }) }
    catch (cleanupError) { console.warn('临时图片或上传状态清理失败，请稍后重试') }
}

/** 保存识别原图，先查询已归档哈希；失败时仍保留识别结果供补存，避免再次调用模型。 */
export async function archiveOcrSource(call, images, result) {
    if (!result.sourceDocumentId) throw new Error('识别服务未返回单据来源，请上传新版 doc-ocr 后重试')
    const prepared = await call('production-orders', 'prepareSourceImages', { sourceDocumentId: result.sourceDocumentId })
    if (!prepared.missing.length) return result
    if (images.some(image => Number(image.originalSize) > 20 * 1024 * 1024) || images.reduce((size, image) => size + (Number(image.originalSize) || 0), 0) > 40 * 1024 * 1024) throw new Error('原图单张上限20 MB、合计40 MB，请减少页数')
    const files = []
    try {
        for (const page of prepared.missing) {
            const image = images[page.pageNo - 1]
            if (!image || image.originalHash !== page.sha256 || !image.originalPath || !/^mes-source-uploads\/[a-f0-9]{32}\/[a-f0-9]{32}\/[a-f0-9]{64}\.image$/.test(page.cloudPath)) throw new Error('原图归档信息不一致，请重新选择照片')
            const uploaded = await uniCloud.uploadFile({ filePath: image.originalPath, cloudPath: page.cloudPath })
            if (!uploaded || !uploaded.fileID) throw new Error('原图归档上传失败，请重试补存')
            files.push({ pageNo: page.pageNo, fileID: uploaded.fileID })
        }
        await call('production-orders', 'commitSourceImages', { sourceDocumentId: result.sourceDocumentId, leaseId: prepared.leaseId, files })
    } catch (error) {
        try { await call('production-orders', 'cleanupSourceUploads', { leaseId: prepared.leaseId, fileIDs: files.map(file => file.fileID) }) } catch (_) {}
        throw error
    }
    return result
}

/** 验证选图已转为图片数据，构造新版多图识别参数；不把临时路径作为图片上传。 */
export function buildOcrRequest(images, purpose, options = {}) {
    if (!Array.isArray(images) || !images.length) throw new Error('请先拍照或选择相册照片')
    if (images.length > 6) throw new Error('最多选择 6 张照片')
    const data = images.map((image, index) => {
        const value = image && image.dataUrl
        if (typeof value !== 'string' || !/^data:image\/(jpeg|jpg|png|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(value)) {
            throw new Error('第 ' + (index + 1) + ' 张照片的数据未读取完成，请清空照片后重新选择')
        }
        return value
    })
    if (data.reduce((size, value) => size + value.length, 0) > 6 * 1024 * 1024) throw new Error('照片总大小过大，请压缩或减少照片')
    const originalHashes = images.map(image => image.originalHash)
    const processedHashes = images.map(image => image.processedHash)
    if ([...originalHashes, ...processedHashes].some(hash => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash))) throw new Error('图片内容校验尚未完成，请清空照片后重新选择')
    if (new Set(originalHashes).size !== originalHashes.length) throw new Error('照片中有重复原图，请重新选择')
    return { ...options, protocolVersion: OCR_PROTOCOL_VERSION, images: data, originalHashes, processedHashes, purpose: purpose === 'bom' ? 'bom' : 'order' }
}

/** 先确认同一空间中的云函数已支持初筛查库流程，再发送照片；旧接口不进入识别。 */
export async function recognizeOcr(call, images, purpose, options = {}) {
    const payload = buildOcrRequest(images, purpose, options)
    if (!serviceCheckedAt || Date.now() - serviceCheckedAt > SERVICE_CHECK_TTL || (payload.useModel === true && (!serviceCapabilities || serviceCapabilities.modelFallback !== true))) {
        let capability
        try { capability = await call('doc-ocr', 'getCapabilities') }
        catch (error) {
            if (error.code === 401) throw error
            const failure = new Error('识别服务版本检查失败。请确认已将新版 doc-ocr 上传到当前使用的云空间，再重新识别。' + (error.message ? '（' + String(error.message).slice(0, 160) + '）' : ''))
            failure.code = error.code
            throw failure
        }
        if (!capability || capability.protocolVersion !== OCR_PROTOCOL_VERSION || capability.flow !== 'archive-first' || capability.multiImage !== true || capability.originalImages !== true || capability.hashPreflight !== true || capability.sourceTrace !== true) {
            throw new Error('云端尚未支持原图追溯，请上传新版 doc-ocr、production-orders 及公共模块后重试')
        }
        serviceCapabilities = capability
        serviceCheckedAt = Date.now()
    }
    if (payload.useModel === true && serviceCapabilities.modelFallback !== true) {
        throw new Error('云端尚未支持“使用大模型识别”，请上传本次更新的 doc-ocr 后重试')
    }
    try {
        const { images: processedImages, ...metadata } = payload
        let result = await call('doc-ocr', 'checkRecognition', metadata)
        if (result.needsProcessedImages) {
            const processedState = uploadStateFor(result)
            try { result = await call('doc-ocr', 'recognize', { ...metadata, ...processedState, images: processedImages }) }
            catch (error) { await cleanupUpload(call, processedState); throw error }
        }
        if (!result.needsOriginalImages) return result
        const uploadState = uploadStateFor(result)
        if (result.archiveOriginals === true) {
            try {
                await archiveOcrSource(call, images, result)
                const recognized = await call('doc-ocr', 'recognize', { ...metadata, ...uploadState, sourceDocumentId: result.sourceDocumentId })
                if (recognized.needsOriginalImages || recognized.needsProcessedImages) throw new Error('原图或初筛状态已过期，请重试；已归档的同哈希照片会复用')
                return recognized
            } catch (error) { await cleanupUpload(call, uploadState); throw error }
        }
        if (!/^ocr-originals\/[a-f0-9]{32}\/[a-f0-9]{32}\/$/.test(String(result.originalUploadPrefix || '')) || !result.originalUploadPrefix.endsWith('/' + result.uploadOwner + '/')) {
            await cleanupUpload(call, uploadState)
            throw new Error('原图上传信息异常，请重新识别')
        }
        const originalFileIds = []
        try {
            if (images.some(image => Number(image.originalSize) > 20 * 1024 * 1024) || images.reduce((size, image) => size + (Number(image.originalSize) || 0), 0) > 40 * 1024 * 1024) throw new Error('原图单张上限 20 MB、合计上限 40 MB，请减少页数或选择体积较小的原图')
            for (let index = 0; index < images.length; index++) {
                if (!images[index].originalPath) throw new Error('原图路径已失效，请清空照片并重新选择原图')
                const uploaded = await uniCloud.uploadFile({ filePath: images[index].originalPath, cloudPath: result.originalUploadPrefix + index + '.image' })
                if (!uploaded || typeof uploaded.fileID !== 'string' || !uploaded.fileID) throw new Error('原图上传失败，请重新识别')
                originalFileIds.push(uploaded.fileID)
            }
            const recognized = await call('doc-ocr', 'recognize', { ...metadata, ...uploadState, originalFileIds })
            if (recognized.needsOriginalImages) throw new Error('云端未收到完整原图，请重新识别')
            return recognized
        } catch (error) {
            await cleanupUpload(call, uploadState, originalFileIds)
            throw error
        }
    }
    catch (error) {
        if (/缺少图片数据/.test(String(error.message || ''))) {
            serviceCheckedAt = 0
            throw new Error('照片已读取，但云端未接收到照片列表。请检查前后台是否关联同一空间，并上传新版 doc-ocr 后重试')
        }
        throw error
    }
}
