// vk-unicloud 客户端配置（P0 地基：只做加法，不替换现有登录与业务调用）
//
// 说明：
// 1. functionName 指向 vk 路由云函数 router（尚未上传时调用会失败，试点页会显示错误原因）。
// 2. login/index 指向现场端现有页面，vk 的跳转/登录守卫复用现有页面，不引入 vk 登录页。
// 3. 不改 uni_id_token 键名，与现有 uni-id 登录态共用同一个 token。
export default {
    debug: process.env.NODE_ENV !== 'production',
    functionName: 'router',
    targetTimezone: 8,
    login: {
        url: '/pages/login/login'
    },
    index: {
        url: '/pages/operations/workbench'
    },
    request: {
        dataParam: {}
    },
    logger: {
        mode: 1
    }
}
