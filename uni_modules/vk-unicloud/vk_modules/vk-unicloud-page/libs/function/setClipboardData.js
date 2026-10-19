// #ifdef WEB
uni.setClipboardData = async function setClipboardData({ data, success, fail, complete } = {}) {
  const onSuccess = () => {
    setTimeout(() => {
      const res = {
        errMsg: 'setClipboardData:ok',
        data,
      };
      success && success(res);
      complete && complete(res);
    });
  };

  const onFail = () => {
    setTimeout(() => {
      const res = {
        errMsg: 'setClipboardData:fail',
      };
      fail && fail(res);
      complete && complete(res);
    });
  };

  // 优先使用现代 Clipboard API
  if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
    try {
      await navigator.clipboard.writeText(data);
      onSuccess();
      return;
    } catch (e) {
      // Clipboard API 失败，回退到 execCommand
    }
  }

  // 回退方案：使用 textarea + execCommand
  try {
    const textarea = document.createElement('textarea');
    textarea.value = data;
    textarea.style.cssText = 'position:fixed;left:-9999px;top:-9999px;opacity:0';
    document.body.appendChild(textarea);
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    document.execCommand('copy');
    document.body.removeChild(textarea);
    onSuccess();
  } catch (e) {
    onFail();
  }
};
// #endif

// 设置系统剪贴板的内容
function setClipboardData(obj = {}) {
  uni.setClipboardData(obj);
}

export default setClipboardData;
