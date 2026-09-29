// dsh-wifi-access —— Client 半端
// 2026-09-25：「功能」Tab（sidebar.extensions）里的「移动端访问」卡片已移除——该槽位里的
// 「移动端访问」由 dsh-pocket 提供（局域网开关 + 公网隧道 + 地址 + 复制 + 二维码），
// 功能覆盖了本插件原来的卡片，避免两条同名重复项。
//
// Host 半端（lib/index.js）保留，它提供的是 dsh-pocket 没有的东西：
//   ① 3081 反代热备：pocket 的 3081 掉线时，每 20s 复探的本插件会接管；
//   ② 移动端浏览器垫片（华为 ArkWeb 实测缺口）：dsh-resource:// 的 URL 解析、Uint8Array
//      toHex/toBase64、Map.getOrInsertComputed 等，pocket 只注入 randomUUID / AbortSignal.any；
//   ③ /wifi-access/api/* 路由与 query_wifi_access 工具（模型侧查询移动端访问状态）。

window.__ModuleLoader__.load({
  id: 'dsh-wifi-access',
  factory: () => {
    var module = { exports: {} };
    Object.defineProperty(module.exports, Symbol.toStringTag, { value: 'Module' });
    module.exports.apply = function apply() {};
    return module.exports;
  },
});
