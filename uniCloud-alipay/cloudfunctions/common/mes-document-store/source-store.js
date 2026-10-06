'use strict'
const { createHash, randomBytes } = require('crypto')
const { ClientError } = require('mes-common')
const SOURCE_COLL = 'source_documents'
const ASSET_COLL = 'source_image_assets'
const RUN_COLL = 'source_recognition_runs'
const MAX_BYTES = 20 * 1024 * 1024
const MAX_TOTAL_BYTES = 40 * 1024 * 1024

/** 生成当前用户的存储隔离标识。 */
function userDigest(uid) { return createHash('sha256').update(String(uid)).digest('hex').slice(0, 32) }
/** 判断数据库主键重复；其他错误必须继续上抛。 */
function duplicate(error) { return /duplicate|already.*exist|document.*exist|重复|已存在|E11000/i.test(String(error && (error.message || error.errMsg) || error)) }
/** 只通过新增写入不可变记录，重复主键时读取已存在记录。 */
async function addImmutable(db, collection, document) {
    try { await db.collection(collection).add(document); return document }
    catch (error) { if (!duplicate(error)) throw error }
    const rows = (await db.collection(collection).doc(document._id).get()).data || []
    if (!rows[0]) throw new ClientError('来源记录暂时无法保存，请重试', 503)
    return rows[0]
}
/** 读取来源凭据，管理员可以查看共享订单引用的其他录入人凭据。 */
async function getSource(db, id, uid, isAdmin = false) {
    if (!/^src:[a-f0-9]{32}:[a-f0-9]{64}$/.test(String(id || ''))) throw new ClientError('原始单据标识非法', 400)
    const source = ((await db.collection(SOURCE_COLL).doc(id).get()).data || [])[0]
    if (!source) throw new ClientError('原始单据不存在', 404)
    if (!isAdmin && source.createdBy !== uid) throw new ClientError('无权访问此原始单据', 403)
    return source
}
/** 保存照片组的稳定身份；页面顺序参与身份，不按订单号去重照片。 */
async function ensureSource(db, uid, originalHashes, text = '') {
    if (!Array.isArray(originalHashes) || originalHashes.length > 6 || originalHashes.some(hash => !/^[a-f0-9]{64}$/.test(hash)) || new Set(originalHashes).size !== originalHashes.length) throw new ClientError('原始照片哈希非法', 400)
    const digest = userDigest(uid)
    const contentHash = createHash('sha256').update(JSON.stringify({ originalHashes, text })).digest('hex')
    return addImmutable(db, SOURCE_COLL, {
        _id: 'src:' + digest + ':' + contentHash, createdBy: uid, createdAt: Date.now(),
        pages: originalHashes.map((sha256, index) => ({ pageNo: index + 1, sha256, assetId: 'asset:' + digest + ':' + sha256 })),
        textOnly: !originalHashes.length
    })
}
/** 读取一组来源照片的已校验文件，缺失文件保持为空。 */
async function sourceAssets(db, source) {
    return Promise.all(source.pages.map(async page => ({ ...page, asset: ((await db.collection(ASSET_COLL).doc(page.assetId).get()).data || [])[0] || null })))
}
/** 验证原始图片字节和哈希，不重新压缩或转换图片。 */
function validateBytes(bytes, hash) {
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_BYTES) throw new ClientError('原图单张须小于20 MB', 400)
    if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new ClientError('原图哈希校验失败，请重新选择照片', 400)
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
    if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png'
    if (/^GIF8[79]a$/.test(bytes.subarray(0, 6).toString('ascii'))) return 'image/gif'
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
    throw new ClientError('来源文件须为 JPG、PNG、WebP 或 GIF 图片', 400)
}
/** 模型读取过的原图直接归档，临时原图清理后仍可回查。 */
async function archiveModelImages(db, source, dataUrls) {
    let total = 0
    for (let index = 0; index < dataUrls.length; index++) {
        const page = source.pages[index]
        if (!page) throw new ClientError('原图页数与来源单据不一致', 400)
        const value = dataUrls[index]
        const bytes = Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
        const mime = validateBytes(bytes, page.sha256); total += bytes.length
        if (total > MAX_TOTAL_BYTES) throw new ClientError('原图合计须小于40 MB', 400)
        const existing = ((await db.collection(ASSET_COLL).doc(page.assetId).get()).data || [])[0]
        if (existing) continue
        const extension = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp' }[mime]
        const cloudPath = 'mes-source-images/' + userDigest(source.createdBy) + '/' + randomBytes(16).toString('hex') + '/' + page.sha256 + '.' + extension
        const uploaded = await uniCloud.uploadFile({ cloudPath, fileContent: bytes })
        if (!uploaded || !uploaded.fileID) throw new ClientError('原图归档失败，请重试；识别结果可复用', 503)
        let asset
        try { asset = await addImmutable(db, ASSET_COLL, { _id: page.assetId, fileID: uploaded.fileID, sha256: page.sha256, bytes: bytes.length, mime, createdBy: source.createdBy, createdAt: Date.now() }) }
        catch (error) {
            // 超时可能发生在数据库已写入之后，先回查，不能删除已被历史凭据引用的文件。
            try { const rows = (await db.collection(ASSET_COLL).doc(page.assetId).get()).data || []; if (!rows[0] || rows[0].fileID !== uploaded.fileID) await uniCloud.deleteFile({ fileList: [uploaded.fileID] }) } catch (_) {}
            throw error
        }
        if (asset.fileID !== uploaded.fileID) await uniCloud.deleteFile({ fileList: [uploaded.fileID] })
    }
}
/** 授予原图补存目录，已归档的同哈希照片不再次上传。 */
async function prepareSourceImages(db, id, uid) {
    const source = await getSource(db, id, uid, true)
    const pages = await sourceAssets(db, source)
    const missing = pages.filter(page => !page.asset)
    if (!missing.length) return { sourceDocumentId: id, missing: [] }
    if (source.createdBy !== uid) throw new ClientError('此单据原图不完整，请原录入人补存', 403)
    const owner = randomBytes(16).toString('hex')
    const leaseId = 'source-upload:' + owner
    const prefix = 'mes-source-uploads/' + userDigest(uid) + '/' + owner + '/'
    await db.collection('source_upload_leases').add({ _id: leaseId, sourceDocumentId: id, uid, prefix, pageNumbers: missing.map(page => page.pageNo), expiresAt: Date.now() + 600000 })
    return { sourceDocumentId: id, leaseId, missing: missing.map(page => ({ pageNo: page.pageNo, sha256: page.sha256, cloudPath: prefix + page.sha256 + '.image' })) }
}
/** 校验补存文件后复制到仅由服务端写入的归档目录；上传目录文件不能覆盖历史原图。 */
async function commitSourceImages(db, event, uid) {
    const source = await getSource(db, event.sourceDocumentId, uid)
    if (!/^source-upload:[a-f0-9]{32}$/.test(String(event.leaseId || ''))) throw new ClientError('原图上传状态非法', 400)
    const lease = ((await db.collection('source_upload_leases').doc(event.leaseId).get()).data || [])[0]
    if (!lease || lease.uid !== uid || lease.sourceDocumentId !== source._id || lease.expiresAt <= Date.now()) throw new ClientError('原图上传状态已过期，请重新保存', 409)
    if (!Array.isArray(event.files) || event.files.length !== lease.pageNumbers.length) throw new ClientError('原图文件数量不一致', 400)
    if (event.files.some(file => !file || typeof file !== 'object' || !lease.pageNumbers.includes(file.pageNo)) || new Set(event.files.map(file => file.pageNo)).size !== event.files.length) throw new ClientError('原图页码不一致', 400)
    const dataUrls = [], temporaryIds = []
    let total = 0
    for (const page of source.pages) {
        const file = event.files.find(item => item.pageNo === page.pageNo)
        const expectedPath = lease.prefix + page.sha256 + '.image'
        if (lease.pageNumbers.includes(page.pageNo)) {
            if (!file || typeof file.fileID !== 'string' || !file.fileID.startsWith('cloud://') || file.fileID.split('/').slice(3).join('/') !== expectedPath) throw new ClientError('原图文件不属于本次上传', 403)
            temporaryIds.push(file.fileID)
        }
        const current = ((await db.collection(ASSET_COLL).doc(page.assetId).get()).data || [])[0]
        if (current) { dataUrls.push(null); total += current.bytes || 0; continue }
        if (!lease.pageNumbers.includes(page.pageNo)) throw new ClientError('原图归档状态变化，请重新保存', 409)
        const downloaded = await uniCloud.downloadFile({ fileID: file.fileID })
        const mime = validateBytes(downloaded.fileContent, page.sha256); total += downloaded.fileContent.length
        if (total > MAX_TOTAL_BYTES) throw new ClientError('原图合计须小于40 MB', 400)
        dataUrls.push('data:' + mime + ';base64,' + downloaded.fileContent.toString('base64'))
    }
    if (total > MAX_TOTAL_BYTES) throw new ClientError('原图合计须小于40 MB', 400)
    for (let index = 0; index < dataUrls.length; index++) if (dataUrls[index]) await archiveModelImages(db, { ...source, pages: [source.pages[index]] }, [dataUrls[index]])
    if (temporaryIds.length) await uniCloud.deleteFile({ fileList: temporaryIds })
    await db.collection('source_upload_leases').doc(event.leaseId).remove()
    return { sourceDocumentId: source._id, archived: true }
}
/** 丢弃凭据、图片数据及超大内容，仅保留识别业务输出。 */
function safeOutput(value, depth = 0) {
    if (depth > 12) return null
    if (typeof value === 'string') return /^data:image\//.test(value) ? '[图片已单独归档]' : value.slice(0, 100000)
    if (Array.isArray(value)) return value.slice(0, 300).map(item => safeOutput(item, depth + 1))
    if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).filter(key => !/api.?key|token|secret|password|authorization|imageBase64|^images$/i.test(key)).map(key => [key, safeOutput(value[key], depth + 1)]))
    return value == null ? null : value
}
/** 保存服务端实际返回的识别结果与当次 Prompt，缓存过期不会删除追溯凭据。 */
async function recordRecognition(db, options) {
    const { uid, originalHashes = [], processedHashes = [], text = '', purpose, result, config, modelImages = [] } = options
    const source = await ensureSource(db, uid, originalHashes, text)
    if (modelImages.length) await archiveModelImages(db, source, modelImages)
    const id = 'run:' + randomBytes(16).toString('hex')
    const prompt = result.recognitionAudit || {}
    const output = safeOutput(result)
    if (Buffer.byteLength(JSON.stringify(output), 'utf8') > 700000) throw new ClientError('识别凭据内容过大，请减少单据页数', 400)
    await db.collection(RUN_COLL).add({
        _id: id, sourceDocumentId: source._id, createdBy: uid, createdAt: Date.now(), purpose,
        source: result.recognitionSource || 'ocrspace', provider: result.recognitionProvider || '', model: result.recognitionModel || '',
        processedHashes, output, rawText: String(result.recognitionRaw && result.recognitionRaw.raw_text || result.recognitionDocument && result.recognitionDocument.raw_text || result.rawText || text || '').slice(0, 100000),
        prompt: safeOutput(prompt.contentPrompt ? { ...prompt, usedForOutput: true } : { usedForOutput: false, note: '此结果来自OCR初筛或产品档案，没有使用大模型Prompt' }),
        modelUsed: result.modelUsed === true
    })
    return { ...result, sourceDocumentId: source._id, recognitionRunId: id }
}
/** 校验订单关联的来源、识别记录及原图是否已完整归档。 */
async function validateSourceReference(db, sourceId, runId, uid, isAdmin) {
    if (!sourceId && !runId) return null
    const source = await getSource(db, sourceId, uid, isAdmin)
    const pages = await sourceAssets(db, source)
    if (pages.some(page => !page.asset)) throw new ClientError('原始照片尚未完整归档，请重新识别或补存原图后保存', 409)
    if (runId) {
        if (!/^run:[a-f0-9]{32}$/.test(runId)) throw new ClientError('识别记录标识非法', 400)
        const run = ((await db.collection(RUN_COLL).doc(runId).get()).data || [])[0]
        if (!run || run.sourceDocumentId !== sourceId) throw new ClientError('识别记录与来源单据不一致', 400)
    }
    return source
}
/** 管理追溯详情中返回永久凭据及新生成的原图访问地址。 */
async function sourceDetail(db, sourceId, runId, uid, isAdmin) {
    const source = await getSource(db, sourceId, uid, isAdmin)
    const pages = await sourceAssets(db, source)
    const files = pages.filter(page => page.asset).map(page => page.asset.fileID)
    const urls = files.length ? (await uniCloud.getTempFileURL({ fileList: files })).fileList || [] : []
    const run = runId ? ((await db.collection(RUN_COLL).doc(runId).get()).data || [])[0] || null : null
    if (run && run.sourceDocumentId !== sourceId) throw new ClientError('来源识别记录不匹配', 400)
    return { ...source, pages: pages.map(page => ({ pageNo: page.pageNo, sha256: page.sha256, fileID: page.asset && page.asset.fileID || '', url: page.asset && (urls.find(file => file.fileID === page.asset.fileID) || {}).tempFileURL || '', bytes: page.asset && page.asset.bytes || 0 })), recognition: run }
}
module.exports = { addImmutable, duplicate, ensureSource, getSource, sourceAssets, prepareSourceImages, commitSourceImages, recordRecognition, validateSourceReference, sourceDetail }

/** 原图已归档时直接读取校验后的文件，模型配置改变也无需客户端重复上传。 */
async function readArchivedImages(db, uid, hashes, deadline) {
    const source = await ensureSource(db, uid, hashes)
    const pages = await sourceAssets(db, source)
    if (pages.some(page => !page.asset)) return null
    const images = []
    let total = 0
    for (const page of pages) {
        if (deadline - Date.now() < 5000) throw new ClientError('原图读取耗时较长，请减少页数后重试', 503)
        const downloaded = await uniCloud.downloadFile({ fileID: page.asset.fileID })
        const mime = validateBytes(downloaded.fileContent, page.sha256)
        total += downloaded.fileContent.length
        if (total > MAX_TOTAL_BYTES) throw new ClientError('原图合计须小于40 MB', 400)
        images.push('data:' + mime + ';base64,' + downloaded.fileContent.toString('base64'))
    }
    return images
}
module.exports.readArchivedImages = readArchivedImages

/** 失败后仅清理本用户、本次授权目录中的临时上传，不删除任何归档原图。 */
async function cleanupSourceUploads(db, event, uid) {
    if (!/^source-upload:[a-f0-9]{32}$/.test(String(event.leaseId || ''))) throw new ClientError('上传授权非法', 400)
    const lease = ((await db.collection('source_upload_leases').doc(event.leaseId).get()).data || [])[0]
    if (!lease) return { cleaned: true }
    if (lease.uid !== uid) throw new ClientError('无权清理此上传', 403)
    const ids = Array.isArray(event.fileIDs) ? event.fileIDs : []
    if (ids.length > 6 || ids.some(id => typeof id !== 'string' || !id.startsWith('cloud://') || !id.split('/').slice(3).join('/').startsWith(lease.prefix))) throw new ClientError('临时文件不属于本次上传', 403)
    if (ids.length) await uniCloud.deleteFile({ fileList: ids })
    await db.collection('source_upload_leases').doc(event.leaseId).remove()
    return { cleaned: true }
}
module.exports.cleanupSourceUploads = cleanupSourceUploads
