/* 合成大猫咪 · 兼容层（Chrome 61 基线）
 * 只为实际使用的新能力做局部检测，不引入 polyfill。
 * 1) Flex gap：Chrome 61 不认识 flex 容器里的 gap，必须真测布局行为，不能只看属性语法。
 * 2) 把结果写到 <html> 的 class 上，CSS 用 .supports-flex-gap 启用增强层。
 */
(function () {
  'use strict';

  function supportsFlexGap() {
    var flex = document.createElement('div');
    flex.style.position = 'absolute';
    flex.style.visibility = 'hidden';
    flex.style.display = 'flex';
    flex.style.flexDirection = 'column';
    flex.style.rowGap = '1px';
    flex.appendChild(document.createElement('div'));
    flex.appendChild(document.createElement('div'));
    document.body.appendChild(flex);
    var ok = flex.scrollHeight === 1;
    if (flex.parentNode) flex.parentNode.removeChild(flex);
    return ok;
  }

  try {
    if (supportsFlexGap()) document.documentElement.className += ' supports-flex-gap';
  } catch (err) {}

  window.CatCompat = { flexGap: supportsFlexGap };
})();
