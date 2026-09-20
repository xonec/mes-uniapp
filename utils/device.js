// 本机设备标识：首次生成存本地，与服务端 token 解析出的 uid 一起用于草稿隔离
// （草稿 _id = draft:<uid>:<设备ID>:<批号>）
// 注意：卸载重装会生成新 ID（草稿是「用户 + 安装实例」级隔离，其他设备或其他用户都看不到）

const KEY = 'mes_device_id'

export function getDeviceId() {
    let id = uni.getStorageSync(KEY)
    if (!id) {
        id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
        uni.setStorageSync(KEY, id)
    }
    return id
}
