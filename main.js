import App from './App'
import Vue from 'vue'
import store from './store'
import config from '@/app.config.js'
// vk-unicloud 客户端（P0 地基）：只做加法，现有页面与登录逻辑保持原样
import vk from 'uni_modules/vk-unicloud'

Vue.config.productionTip = false
Vue.use(vk, config)
App.mpType = 'app'

const app = new Vue({
    store,
    ...App
})
app.$mount()
