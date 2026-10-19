/**
 * 函数 - 页面导航
 */
// #ifdef VUE2
let config;
let pagesJson;
try {
  config = require('@/app.config.js');
  if (typeof config.default === 'object') {
    config = config.default;
  }
} catch (e) {
  config = {};
}
try {
  pagesJson = require('@/pages.json');
  if (typeof pagesJson.default === 'object') {
    pagesJson = pagesJson.default;
  }
} catch (e) {
  pagesJson = {};
}
// #endif

// #ifdef VUE3
import config from '@/app.config.js';
import pagesJson from '@/pages.json';
// #endif

const util = {};
let lastNavigate = {
  url: '',
  time: 0,
};
/**
 * 保留当前页面，跳转到应用内的某个页面，使用vk.navigateBack可以返回到原页面。
 * vk.navigateTo(url);
 */
util.navigateTo = function (obj) {
  let vk = uni.vk;
  if (typeof obj == 'string') {
    let url = obj;
    obj = {
      url: url,
    };
  } else if (typeof obj == 'undefined') {
    obj = {};
  }
  if (!obj.url) {
    vk.toast('url不能为空!');
    return false;
  }
  let time = Date.now();
  if (lastNavigate.url === obj.url && time - lastNavigate.time < 200) {
    return false;
  }
  lastNavigate = { url: obj.url, time };
  if (!obj.__vkNavigateTo404 && !util.checkPageExists({ url: obj.url })) {
    vk.navigateTo404();
    return false;
  }
  util.checkNeedLogin({
    url: obj.url,
    success: (res) => {
      if (res.needLogin) {
        obj.url = vk.pubfn.getPageFullPath(obj.url);
        vk.navigate.setOriginalPage(obj);
        obj.url = config.login.url;
        // login拦截器开始-----------------------------------------------------------
        let { interceptor = {} } = config;
        if (typeof interceptor.login === 'function') {
          let key = interceptor.login({
            vk,
            params: obj,
            res: {
              ...res,
              code: 30204,
              msg: '本地token校验未通过',
            },
          });
          if (typeof key === 'undefined' || key !== true) return false;
        }
        // login拦截器结束-----------------------------------------------------------
      } else {
        vk.navigate.setOriginalPage(null);
      }
      util._navigateTo(obj);
    },
  });
};
util._navigateTo = function (obj) {
  let { interceptor = {} } = config;
  if (typeof interceptor.navigateTo === 'function') {
    let vk = uni.vk;
    obj.pagePath = vk.pubfn.getPageFullPath(obj.url);
    let key = interceptor.navigateTo({
      ...obj,
      vk,
    });
    if (typeof key == 'boolean' && key === false) return false;
  }
  let { url, animationType = 'pop-in', animationDuration = 300, events, mode = 'navigateTo' } = obj;
  // 此处写法仅为支持vue3，vue3不支持uni[apiName]的形式调用
  let navigateFn;
  if (mode === 'navigateTo') {
    navigateFn = uni.navigateTo;
  } else if (mode === 'redirectTo') {
    navigateFn = uni.redirectTo;
  } else if (mode === 'reLaunch') {
    navigateFn = uni.reLaunch;
  } else if (mode === 'switchTab') {
    navigateFn = uni.switchTab;
  } else {
    navigateFn = uni.navigateTo;
  }
  // 此处写法仅为支持vue3，vue3不支持uni[apiName]的形式调用
  navigateFn({
    url: url,
    animationType: animationType,
    animationDuration: animationDuration,
    events: events, // 参考 https://uniapp.dcloud.io/api/router?id=navigateto
    success: function (res) {
      if (typeof obj.success == 'function') obj.success(res);
    },
    fail: function (err) {
      if (err.errMsg.indexOf('not found') > -1) {
        let vk = uni.vk;
        console.error(err);
        if (!obj.__vkNavigateTo404) {
          vk.navigateTo404();
        } else {
          let errUrl = vk.pubfn.getPageFullPath(url);
          vk.toast(`页面 ${errUrl} 不存在`, 'none');
        }
        return false;
      }
      uni.switchTab({
        url: url,
        success: obj.success,
        fail: function () {
          uni.redirectTo({
            url: url,
            success: obj.success,
            fail: function (err) {
              console.error(err);
              if (typeof obj.fail == 'function') obj.fail(err);
            },
          });
        },
      });
    },
    complete: function (res) {
      if (typeof obj.complete == 'function') obj.complete(res);
    },
  });
};

/**
 * 关闭当前页面，跳转到应用内的某个页面。
 * vk.redirectTo(url);
 */
util.redirectTo = function (obj) {
  obj = util.paramsInit(obj);
  obj.mode = 'redirectTo';
  util.navigateTo(obj);
};

/**
 * 关闭所有页面，打开到应用内的某个页面。
 * vk.reLaunch(url);
 */
util.reLaunch = function (obj) {
  obj = util.paramsInit(obj);
  obj.mode = 'reLaunch';
  util.navigateTo(obj);
};

/**
 * 跳转到 tabBar 页面，并关闭其他所有非 tabBar 页面。
 * vk.switchTab(url);
 */
util.switchTab = function (obj) {
  obj = util.paramsInit(obj);
  obj.mode = 'switchTab';
  util.navigateTo(obj);
};
/**
 * 关闭当前页面，返回上一页面或多级页面。可通过 getCurrentPages() 获取当前的页面栈，决定需要返回几层。
 * vk.navigateBack();
 */
util.navigateBack = function (obj) {
  let vk = uni.vk;
  if (typeof obj == 'number') {
    let delta = obj;
    obj = {
      delta: delta,
    };
  } else if (typeof obj == 'undefined') {
    obj = {};
  }
  let { delta = 1, animationType = 'pop-out', animationDuration = 300 } = obj;
  uni.navigateBack({
    delta: delta,
    animationType: animationType,
    animationDuration: animationDuration,
    success: function () {
      if (typeof obj.success == 'function') obj.success();
    },
    fail: function (res) {
      console.error(res);
      if (typeof obj.fail == 'function') obj.fail();
    },
    complete: function () {
      if (typeof obj.complete == 'function') obj.complete();
    },
  });
};
/**
 * 跳转到登录前的页面
 * vk.navigate.originalTo();
 */
util.originalTo = function () {
  let vk = uni.vk;
  let originalPage = vk.navigate.getOriginalPage();
  vk.navigate.setOriginalPage(null);
  util.redirectTo(originalPage);
};

/**
 * 获取登录前的页面
 * vk.navigate.getOriginalPage();
 */
util.getOriginalPage = function () {
  if (typeof uni.vk.getVuex === 'function') {
    // 有安装vuex则使用vuex
    return uni.vk.getVuex('$app.originalPage');
  } else {
    // 未安装则使用本地缓存
    return uni.vk.getStorageSync('vk.navigate.originalPage');
  }
};

/**
 * 设置登录前的页面
 * vk.navigate.setOriginalPage(originalPage);
 */
util.setOriginalPage = function (originalPage) {
  if (originalPage === null) originalPage = '';
  uni.vk.navigate.originalPage = originalPage; // 兼容老版本
  if (typeof uni.vk.getVuex === 'function') {
    // 有安装vuex则使用vuex
    return uni.vk.setVuex('$app.originalPage', originalPage);
  } else {
    // 未安装则使用本地缓存
    return uni.vk.setStorageSync('vk.navigate.originalPage', originalPage);
  }
};

/**
 * 跳转到首页
 * vk.navigateToHome();
 */
util.navigateToHome = function (obj = {}) {
  let vk = uni.vk;
  let { mode = 'reLaunch' } = obj;
  vk[mode](config.index.url);
};

/**
 * 跳转到登录页
 * vk.navigateToLogin();
 */
util.navigateToLogin = function (obj = {}) {
  let vk = uni.vk;
  let {
    redirectUrl, // 当mode为reLaunch或redirectTo时，指定登录成功后跳转的地址，redirectUrl的优先级高于needBack
    needBack, // 当mode为reLaunch或redirectTo时，登录成功是否需要返回当前页面
    mode = 'reLaunch', // 可选值为 navigateTo redirectTo reLaunch
    query, // 传递给登录页的参数
  } = obj;

  let url = config.login.url;
  let { pagePath, fullPath } = vk.pubfn.getCurrentPage();
  // 如果已经在登录页面则不跳转
  if (pagePath === url) {
    return false;
  }
  if (mode !== 'navigateTo') {
    let uniIdRedirectUrl;
    if (typeof redirectUrl === 'string') {
      uniIdRedirectUrl = encodeURIComponent(redirectUrl);
    } else if (needBack) {
      uniIdRedirectUrl = encodeURIComponent(fullPath);
    }
    if (uniIdRedirectUrl) {
      // 如果url中有参数则用&连接，否则用?连接
      url += url.indexOf('?') > -1 ? `&` : `?`;
      url += `uniIdRedirectUrl=${uniIdRedirectUrl}`;
    }
  }
  if (query) {
    url += url.indexOf('?') > -1 ? `&` : `?`;
    url += query;
  }
  vk[mode]({
    ...obj,
    url,
  });
};

/**
 * 跳转到权限不足页面
 * vk.navigateTo403();
 */
util.navigateTo403 = function (obj = {}) {
  let vk = uni.vk;
  let { mode = 'redirectTo' } = obj;
  if (config.noPermission && config.noPermission.url) {
    vk[mode](config.noPermission.url);
  }
};

/**
 * 跳转到404页面
 * vk.navigateTo404();
 */
util.navigateTo404 = function (obj = {}) {
  let vk = uni.vk;
  let { mode = 'redirectTo' } = obj;
  if (config.error && config.error.url) {
    vk[mode]({
      ...obj,
      url: config.error.url,
      __vkNavigateTo404: true,
    });
  }
};

/**
 * 检测是否满足条件(内部方法)
 util.checkWildcardTest({
	 url:url,
	 pagesRule:config.checkTokenPages,
	 success:function(res){
		 if(res.success){

		 }
	 }
 })
 */
util.checkWildcardTest = function (obj) {
  let vk = uni.vk;
  let { url, pagesRule } = obj;
  // ../ 转成绝对路径
  url = vk.pubfn.getPageFullPath(url);
  let key = false;
  if (vk.pubfn.isNotNull(pagesRule)) {
    let { mode = 0, list = [] } = pagesRule;
    if (mode > 0) {
      let regExpKey = false;
      let path = util.getPagePath(url);
      for (let i = 0; i < list.length; i++) {
        let pageRegExp = list[i];
        regExpKey = vk.pubfn.wildcardTest(path, pageRegExp);
        if (regExpKey) {
          break;
        }
      }
      if (mode === 1 && regExpKey) {
        key = true;
      } else if (mode === 2 && !regExpKey) {
        key = true;
      }
    }
  }
  return {
    url,
    key,
  };
};

/**
 * 检测是否需要登录(内部方法)
 util.checkNeedLogin({
	 url:url,
	 success:function(res){
		 if(res.needLogin){

		 }
	 }
 })
 */
util.checkNeedLogin = function (obj) {
  let vk = uni.vk;
  let { url, success } = obj;
  let needLogin = false; // 用户是否需要重新登录
  let pageNeedLogin = false; // 该页面是否需要登录才能访问
  let pagesRule = config.checkTokenPages;
  if (pagesRule) {
    let res = util.checkWildcardTest({
      url,
      pagesRule,
    });
    pageNeedLogin = res.key;
    if (pageNeedLogin) {
      // 本地判断token有效期(联网会浪费性能)
      if (!vk.checkToken()) {
        needLogin = true;
      }
    }
  }
  if (typeof success === 'function') {
    success({
      url,
      needLogin,
      pageNeedLogin,
    });
  }
  return pageNeedLogin;
};

// 检测页面是否已在 pages.json 的 pages 或 subPackages/subpackages 中注册
util.checkPageExists = function (obj = {}) {
  let vk = uni.vk;
  let { url } = obj;
  if (vk.pubfn.isNull(url)) return true;
  let pagePath = util.normalizePagePath(vk.pubfn.getPageFullPath(url));
  if (vk.pubfn.isNull(pagePath)) return true;
  let pageList = util.getRegisteredPageList();
  if (!pageList.length) return true;
  return pageList.indexOf(pagePath) > -1;
};

// 检测 pages.json 中注册的页面，pages.json 的注释由 uni-app 编译器处理
util.getRegisteredPageList = function () {
  let list = [];
  const addPage = (page, root) => {
    if (typeof page === 'string') {
      list.push(util.normalizePagePath([root, page].filter((item) => item).join('/')));
    } else if (page && typeof page === 'object') {
      list.push(util.normalizePagePath([root, page.path || page.pagePath].filter((item) => item).join('/')));
    }
  };
  const addPages = (pages, root) => {
    if (Array.isArray(pages)) {
      pages.forEach((page) => addPage(page, root));
    } else if (pages && typeof pages === 'object') {
      Object.keys(pages).forEach((page) => addPage(page, root));
    }
  };

  addPages(pagesJson.pages);
  let subPackages = pagesJson.subPackages || pagesJson.subpackages || [];
  if (Array.isArray(subPackages)) {
    subPackages.forEach((subPackage) => {
      if (subPackage && typeof subPackage === 'object') {
        addPages(subPackage.pages, subPackage.root);
      }
    });
  }

  return list.filter((page, index) => page && list.indexOf(page) === index);
};

util.normalizePagePath = function (path) {
  if (typeof path !== 'string') return '';
  return path
    .split('?')[0]
    .split('#')[0]
    .replace(/^\/+/, '')
    .replace(/\.html$/, '');
};

// 检查当前页面是否有菜单权限（处理直接 URL 访问场景）
util.checkCurrentPagePermission = function (obj = {}) {
  let vk = uni.vk;
  let currentPage = vk.pubfn.getCurrentPage();
  let pagePath = '/' + (currentPage.route || '');
  if (obj.url) {
    pagePath = vk.pubfn.getPageFullPath(obj.url);
  }
  pagePath = pagePath.split('?')[0];
  if (!util.checkPageExists({ url: pagePath })) {
    vk.navigateTo404();
    return true;
  }
  // 403 页面自身不做权限检查（防止无限重定向）
  if (config.noPermission && config.noPermission.url) {
    let noPermissionPath = vk.pubfn.getPageFullPath(config.noPermission.url);
    if (pagePath === noPermissionPath) {
      return true;
    }
  }
  // 检查是否需要菜单权限检查
  if (!config.noPermission) {
    // 如果没有 403 页面，则直接放行
    return true;
  }
  let pagesRule = config.checkPermissionPages;
  if (pagesRule) {
    let res = util.checkWildcardTest({ url: pagePath, pagesRule });
    if (!res.key) return true; // 该页面不需要检查菜单权限，直接放行
  } else {
    // 如果不存在 checkPermissionPages 则直接放行
    return true;
  }
  // 如果页面不需要登录，则不需要检查菜单权限
  let pageNeedLogin = util.checkNeedLogin({ url: pagePath });
  if (!pageNeedLogin) return true;
  let menuList = vk.getVuex('$app.menuList') || [];
  let hasPermission = menuList.some((item) => item.url && item.url.split('?')[0] === pagePath);
  if (!hasPermission) {
    return false;
  }
  return true;
};

// 获取?前面的地址
util.getPagePath = function (url) {
  let pathIndex = url.indexOf('?');
  let path = url;
  if (pathIndex > -1) {
    path = path.substring(0, pathIndex);
  }
  return path;
};

util.paramsInit = function (obj) {
  let vk = uni.vk;
  if (typeof obj == 'string') {
    let url = obj;
    obj = {
      url: url,
    };
  } else if (typeof obj == 'undefined') {
    obj = {};
  }
  if (!obj.url) {
    vk.toast('url不能为空!');
    return false;
  }
  return obj;
};

/**
 * 跳转到小程序
	vk.navigateToMiniProgram({
		appId: 'appId',
		path: 'pages/index/index',
		extraData:{
			//发送数据携带的参数
		},
		success(res) {
			// 打开成功

		}
	})
 */
util.navigateToMiniProgram = function (obj) {
  let vk = uni.vk;
  // #ifdef WEB
  vk.toast('不支持打开小程序', 'none');
  // #endif

  // #ifndef WEB
  uni.navigateToMiniProgram(obj);
  // #endif
};

/**
 * 检测是否可以分享(内部方法)
let allowShare = vk.navigate.checkAllowShare({
	url: url,
});
 */
util.checkAllowShare = function (obj) {
  let vk = uni.vk;
  let { url, success } = obj;
  let pagesRule = config.checkSharePages || {};
  if (pagesRule && pagesRule.mode > 0) {
    if (url === '/') {
      url = config.index.url;
    }
    let res = util.checkWildcardTest({
      url,
      pagesRule,
    });
    // console.log('res.key: ', res.key)
    // #ifdef MP-WEIXIN || MP-ALIPAY || MP-TOUTIAO || MP-QQ || MP-KUAISHOU || MP-JD
    let menus = pagesRule.menus || ['shareAppMessage', 'shareTimeline'];
    // #ifdef MP-TOUTIAO
    menus = ['share', 'record'];
    // #endif
    if (res.key) {
      //console.log("允许分享");
      uni.showShareMenu({
        withShareTicket: false,
        menus,
      });
    } else {
      //console.log("禁止分享");
      uni.hideShareMenu({
        menus,
      });
    }
    // #endif
    return res.key;
  }
};

util.$emit = function (...obj) {
  return uni.$emit(...obj);
};
util.$on = function (...obj) {
  return uni.$on(...obj);
};
util.$once = function (...obj) {
  return uni.$once(...obj);
};
util.$off = function (...obj) {
  return uni.$off(...obj);
};

/**
 * 跳转到抽奖页
vk.navigateToLuckyDraw({
	path: `pages/activity/detail/detail?_id=${activity_id}`
});
 */
util.navigateToLuckyDraw = function (obj = {}) {
  let vk = uni.vk;
  // #ifndef APP-PLUS || MP-WEIXIN || WEB
  vk.alert('请在微信小程序中打开');
  // #endif
  const mpConfig = {
    appid: 'wx2c55b235ad6553e3', // 抽奖服务小程序的appid（请勿修改）
    ghId: 'gh_fbd003114768', // 抽奖服务小程序的原始ID（请勿修改）
  };
  let {
    path, // 页面地址
    envVersion = 'release', // 小程序版本，正式版为release，开发版为develop，体验版为trial
    extraData,
    shortLink,
    noRelaunchIfPathUnchanged,
    allowFullScreen,
    success,
    fail,
    complete,
    openEmbedded,
  } = obj;
  const successCallback = (res) => {
    if (typeof success === 'function') success(res);
    if (typeof complete === 'function') complete(res);
  };
  const failCallback = (err) => {
    if (typeof fail === 'function') fail(err);
    if (typeof complete === 'function') complete(err);
  };
  // #ifdef WEB
  let pathArr = path.split('?');
  let page = pathArr[0];
  let query = pathArr[1];
  let url = `weixin://dl/business/?appid=${mpConfig.appid}&path=${page}&env_version=${envVersion}`;
  if (query) {
    query = encodeURIComponent(query);
    url += `&query=${query}`;
  }
  window.location.href = url;
  successCallback({
    errMsg: 'navigateToMiniProgram:ok',
  });
  // #endif

  // #ifdef APP-PLUS
  plus.share.getServices((res) => {
    let sweixin = null;
    for (let i in res) {
      if (res[i].id === 'weixin') {
        sweixin = res[i];
        break;
      }
    }
    if (sweixin) {
      let typeObj = {
        release: 0,
        develop: 1,
        trial: 2,
      };
      sweixin.launchMiniProgram(
        {
          id: mpConfig.ghId, // 需在微信开放平台绑定的小程序原始ID
          type: typeObj[envVersion], // 0-正式版，1-开发版，2-体验版
          path,
        },
        successCallback,
        failCallback
      );
    } else {
      vk.alert('跳转失败：未安装微信');
    }
  });
  // #endif

  // #ifdef MP-WEIXIN
  const openMiniProgram = openEmbedded ? uni.openEmbeddedMiniProgram : uni.navigateToMiniProgram;
  openMiniProgram({
    appId: mpConfig.appid,
    path,
    extraData,
    envVersion,
    shortLink,
    noRelaunchIfPathUnchanged,
    allowFullScreen,
    success,
    complete,
    fail: (err) => {
      failCallback(err);
      let subMsg = err.errMsg || err.message;
      if (subMsg && subMsg.indexOf('cancel') > -1) {
        return;
      }
      if (subMsg && subMsg.indexOf('jump miniprogram banded') > -1) {
        subMsg = `当前小程序不具备打开其他小程序的能力`;
      }
      let errMsg = '跳转失败';
      if (subMsg) {
        errMsg += `：${subMsg}`;
      }
      console.error(errMsg);
    },
  });
  // #endif
};

export default util;
