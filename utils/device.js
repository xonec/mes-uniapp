// 本机设备标识：首次生成 UUID 存本地，用于草稿按设备隔离
// 注意：卸载重装会生成新 ID（草稿是「安装实例」级隔离，符合「其他设备看不到本设备草稿」的语义）

const KEY = 'mes_device_id'

export function getDeviceId() {
    let id = uni.getStorageSync(KEY)
    if (!id) {
        id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
        uni.setStorageSync(KEY, id)
    }
    return id
}
