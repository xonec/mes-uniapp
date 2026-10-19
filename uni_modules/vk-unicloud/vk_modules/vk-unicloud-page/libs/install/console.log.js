let debug = process.env.NODE_ENV !== 'production';
const install = (Vue) => {
  let vk = Vue.prototype ? Vue.prototype.vk : Vue.config.globalProperties.vk;
  if (vk) {
    vk.log = console.log;
    if (typeof vk.getConfig === 'function') {
      debug = vk.getConfig().debug;
    }
    if (!debug) {
      console.log = function (...obj) {};
      console.group = function (...obj) {};
      console.groupCollapsed = function (...obj) {};
      console.groupEnd = function (...obj) {};
    }
    // #ifdef MP-WEIXIN
    if (wx.canIUse('getDeviceInfo') && wx.canIUse('getWindowInfo') && wx.canIUse('getAppBaseInfo') && wx.canIUse('getSystemSetting')) {
      uni.getSystemInfoSync = () => {
        const deviceInfo = uni.getDeviceInfo();
        const windowInfo = uni.getWindowInfo();
        const appBaseInfo = uni.getAppBaseInfo();
        const systemSetting = uni.getSystemSetting();
        // const appAuthorizeSetting = wx.getAppAuthorizeSetting(); // 这个API效率低，不放在这里了
        // 最终会少 batteryLevel 属性和 appAuthorizeSetting 属性
        return {
          devicePixelRatio: windowInfo.pixelRatio,
          hostFontSizeSetting: appBaseInfo.fontSizeSetting,
          batteryLevel: 100, // 设置一个假的固定值进去，防止出错（如果再调用电量API这效率会比较低）
          ...deviceInfo,
          ...windowInfo,
          ...appBaseInfo,
          ...systemSetting,
          // ...appAuthorizeSetting,
        };
      };
    }
    // #endif
  }
};

export default {
  install,
};
