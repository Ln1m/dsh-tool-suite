// dsh-wifi-access —— Host 半端
// 内置 WiFi 局域网反代：监听 0.0.0.0:3081 → 转发 127.0.0.1:3080（DSH web）。
// 关键优化（相对旧方案）：
//   1) 改写 Host/Origin 回 127.0.0.1:3080 —— 让上游看到 loopback 权威，cookie 的
//      authority 与后续请求保持一致（不再需要 --host 0.0.0.0 / trustedHosts / 官方源码改动）；
//   2) 对 text/html 注入 crypto.randomUUID polyfill —— 移动端浏览器（手机/平板，非安全上下文）
//      访问时前端 mintRpcId 不崩；
//   3) 代理随 DSH 插件生命周期自动起停，无需 dsh-desktop 参与。
// 路由：/wifi-access/api/status|start|stop|qr（浏览器同源调用）。
// 工具：query_wifi_access —— 模型可查询移动端访问地址/状态。
//
// 2026-09-11（DSH 升级 0.1.5-rc.2 后手机端 401 的修复）：
//   新版的浏览器会话 cookie 绑定 Host 权威，且只有「根路径 GET 带 ?token=<进程令牌>」
//   才会签发 cookie（@deepseek-ai/dsh-client-connection 的 authorizeIndex）；
//   loopback Host 已不再等于免鉴权，所以只改写 Host 的老做法会让手机打开
//   http://<LAN-IP>:3081/ 直接吃 401「dsh web authentication required」——
//   表现就是「3081 反代没起来」。两处修复：
//     a) 面板/工具给出的 URL 一律换成 connection.authenticatedUrl() 的带 token 版；
//     b) 裸导航（GET + Accept: text/html + 无 token）被上游 401 时，本地回 302 到
//        /?token=<进程令牌>，由上游签发 cookie 后自动跳回干净 /。手机端因此扫码即用。

import { defineTool } from "@deepseek-ai/dsh-tools";
import { createRequire } from "node:module";
import { networkInterfaces } from "node:os";
import { brotliDecompressSync, gunzipSync, inflateSync } from "node:zlib";

export const name = "dsh-wifi-access";
export const inject = ["webServer", "tools"];

const LISTEN_HOST = "0.0.0.0";
const LISTEN_PORT = 3081;
const TARGET_HOST = "127.0.0.1";
let TARGET_PORT = 3080; // apply 时从 webServer.port 覆盖
// 反代转发时打上的标记头：看到它就说明请求来自局域网（手机/平板），而不是本机 GUI。
// 用途：带 token 的地址只发给本机 GUI；局域网侧一律只给裸地址，避免未鉴权接口吐 token。
const LAN_PROXY_HEADER = "x-dsh-lan-proxy";

// crypto.randomUUID polyfill（getRandomValues 实现，非安全上下文可用）+ 触摸全屏
const POLYFILL = '<script>if(window.crypto&&!window.crypto.randomUUID){var g=window.crypto.getRandomValues?window.crypto.getRandomValues.bind(window.crypto):null;window.crypto.randomUUID=function(){var b=g?g(new Uint8Array(16)):null;if(!b){b=[];for(var i=0;i<16;i++)b.push(Math.floor(Math.random()*256));}b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;var h=[];for(var i=0;i<16;i++)h.push((b[i]<16?"0":"")+b[i].toString(16));var s=h.join("");return s.slice(0,8)+"-"+s.slice(8,12)+"-"+s.slice(12,16)+"-"+s.slice(16,20)+"-"+s.slice(20);};}document.addEventListener("touchstart",function fs(){document.removeEventListener("touchstart",fs);var d=document.documentElement;if(d.requestFullscreen){try{d.requestFullscreen()}catch(e){}}},{once:true,passive:true});</script>';

// 2026-09-14 修复「移动端所有文件预览显示：文件资源服务不可用。」的根因。
// 实测（华为 MatePad Pro / OpenHarmony 6.1 / ArkWeb 6.1.0.120）：ArkWeb 的 new URL() 对
// 「非特殊协议 + //」不解析 authority —— `dsh-resource://file/…` 和 `foo://bar/x` 都返回
// hostname=""，而 Chrome 会返回 host=file / host=bar。
// 官方 @deepseek-ai/dsh-client-resources 的 protocolOf() 恰好吃 hostname：
//     if (parsed.protocol !== "dsh-resource:") return undefined;
//     return parsed.hostname === "" ? undefined : parsed.hostname.toLowerCase();
// → ArkWeb 上永远判定「协议未知」→ 没有 file 资源提供方 → 任何文件（PDF/js/png/工作区内或外）
//   在拓展栏里都显示「文件资源服务不可用。」，而标签类型认领/文件树/预览面板都是手写字符串解析，
//   所以聊天、文件树、标签一切正常 —— 只有文件预览这一条链断在这里。
// 垫片只改写 dsh-resource:// 开头的输入：借 http:// 解析出 pathname，再补回 protocol/hostname；
// 其它协议（http/https/ws/…）一律原样透传，行为不变。放在 HTML 内联注入里，先于客户端包执行，
// 因此不受客户端包 immutable 缓存影响，刷新页面即生效。
const URL_SHIM = '<script>(function(){try{if(window.__dshArkUrlShim)return;window.__dshArkUrlShim=1;var U=window.URL,P="dsh-resource://";function W(u,b){if(typeof u==="string"&&u.slice(0,P.length)===P){var r=u.slice(P.length),c=r.search(/[\\/?#]/),h=(c===-1?r:r.slice(0,c));var o=new U("http://"+(h||"invalid")+(c===-1?"/":r.slice(c)));try{Object.defineProperty(o,"protocol",{value:"dsh-resource:",configurable:true});}catch(e){}try{Object.defineProperty(o,"hostname",{value:h,configurable:true});}catch(e){}return o;}return b===undefined?new U(u):new U(u,b);}W.prototype=U.prototype;if(U.createObjectURL)W.createObjectURL=U.createObjectURL;if(U.revokeObjectURL)W.revokeObjectURL=U.revokeObjectURL;if(U.canParse)W.canParse=U.canParse;window.URL=W;}catch(e){}})();</script>';

// 2026-09-14 第二处 ArkWeb 缺口（PDF 预览报 `无法显示 PDF: n.toHex is not a function`）。
// pdfjs 用到 ES2024 的 `Uint8Array.prototype.toHex` / `toBase64` 族（Chrome 131+ 才有），ArkWeb 的
// JS 引擎没有。官方包里这一族共 10 处：**7 处在 pdfjs 的 worker 源码里、3 处在主线程**；worker 是独立
// JS realm，页面里的垫片进不去 —— 所以必须把同一份垫片源码**前置进 worker 的源码**。
// 做法：包一层 Blob，凡 type 含 javascript 的 Blob 都把垫片源码前置（pdfjs 用
// `new Worker(URL.createObjectURL(new Blob([workerSrc], {type:"text/javascript"})))` 起 worker）。
// 语义按提案实现，**原生已存在的绝不覆盖**（逐个判 undefined）。
const TYPED_ARRAY_CODE = "(function(){try{var U8=Uint8Array;function def(o,n,f){try{if(o[n]===undefined)Object.defineProperty(o,n,{value:f,writable:true,configurable:true});}catch(e){}}function TB(a){return a===\"base64url\"?\"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_\":\"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/\";}def(U8.prototype,\"toHex\",function(){var s=\"\";for(var i=0;i<this.length;i++)s+=(this[i]<16?\"0\":\"\")+this[i].toString(16);return s;});def(U8,\"fromHex\",function(h){var s=String(h).replace(/[^0-9a-fA-F]/g,\"\");if(s.length%2)throw new SyntaxError(\"invalid hex\");var o=new U8(s.length/2);for(var i=0;i<o.length;i++)o[i]=parseInt(s.substr(i*2,2),16);return o;});def(U8.prototype,\"toBase64\",function(p){var t=TB(p&&p.alphabet),omit=!!(p&&p.omitPadding),out=\"\",i;for(i=0;i+2<this.length;i+=3){var n=(this[i]<<16)|(this[i+1]<<8)|this[i+2];out+=t[(n>>18)&63]+t[(n>>12)&63]+t[(n>>6)&63]+t[n&63];}var r=this.length-i;if(r===1){var a=this[i]<<16;out+=t[(a>>18)&63]+t[(a>>12)&63];if(!omit)out+=\"==\";}else if(r===2){var b=(this[i]<<16)|(this[i+1]<<8);out+=t[(b>>18)&63]+t[(b>>12)&63]+t[(b>>6)&63];if(!omit)out+=\"=\";}return out;});def(U8,\"fromBase64\",function(s,p){var t=TB(p&&p.alphabet),c=String(s).replace(/[\\t\\n\\f\\r ]/g,\"\").replace(/=+$/,\"\"),out=[],buf=0,bits=0;for(var i=0;i<c.length;i++){var v=t.indexOf(c[i]);if(v<0)throw new SyntaxError(\"invalid base64\");buf=(buf<<6)|v;bits+=6;if(bits>=8){bits-=8;out.push((buf>>bits)&255);}}return new U8(out);});}catch(e){}})();";
const TYPED_ARRAY_POLYFILL = '<script>' + TYPED_ARRAY_CODE + '</script>';
// 2026-09-14 第三处 ArkWeb 缺口：pdfjs 6.3 还用了 `Map.prototype.getOrInsertComputed`
// （ES2025 "upsert" 提案，Chrome 139+ 才有）→ 报错形如 `this.#methodPromises.getOrInsertComputed is not a function`。
// 同族一起补齐：Map/WeakMap 的 getOrInsert / getOrInsertComputed、Object.groupBy / Map.groupBy、
// Promise.withResolvers / Promise.try、Set 的七个集合运算。**原生已存在的绝不覆盖**。
const NEW_API_CODE = "(function(){try{function def(o,n,f){try{if(o[n]===undefined)Object.defineProperty(o,n,{value:f,writable:true,configurable:true});}catch(e){}}function up(){return function(k,v){if(this.has(k))return this.get(k);this.set(k,v);return v;};}function upc(){return function(k,cb){if(this.has(k))return this.get(k);if(typeof cb!==\"function\")throw new TypeError(\"callback is not a function\");var v=cb(k);this.set(k,v);return v;};}def(Map.prototype,\"getOrInsert\",up());def(Map.prototype,\"getOrInsertComputed\",upc());def(WeakMap.prototype,\"getOrInsert\",up());def(WeakMap.prototype,\"getOrInsertComputed\",upc());def(Object,\"groupBy\",function(items,cb){if(items==null)throw new TypeError(\"items is null\");var r=Object.create(null),i=0;for(var x of items){var k=cb(x,i++);k=typeof k===\"symbol\"?k:String(k);if(Object.prototype.hasOwnProperty.call(r,k))r[k].push(x);else r[k]=[x];}return r;});def(Map,\"groupBy\",function(items,cb){if(items==null)throw new TypeError(\"items is null\");var r=new Map(),i=0;for(var x of items){var k=cb(x,i++);if(r.has(k))r.get(k).push(x);else r.set(k,[x]);}return r;});def(Promise,\"withResolvers\",function(){var r={};r.promise=new Promise(function(res,rej){r.resolve=res;r.reject=rej;});return r;});def(Promise,\"try\",function(cb){var a=Array.prototype.slice.call(arguments,1);return new Promise(function(res){res(cb.apply(void 0,a));});});function need(o){if(!(o instanceof Set))throw new TypeError(\"not a Set\");}function copy(s){var r=new Set();s.forEach(function(v){r.add(v);});return r;}def(Set.prototype,\"union\",function(o){need(o);var r=copy(this);o.forEach(function(v){r.add(v);});return r;});def(Set.prototype,\"intersection\",function(o){need(o);var r=new Set();this.forEach(function(v){if(o.has(v))r.add(v);});return r;});def(Set.prototype,\"difference\",function(o){need(o);var r=new Set();this.forEach(function(v){if(!o.has(v))r.add(v);});return r;});def(Set.prototype,\"symmetricDifference\",function(o){need(o);var r=new Set();this.forEach(function(v){if(!o.has(v))r.add(v);});o.forEach(function(v){if(!this.has(v))r.add(v);},this);return r;});def(Set.prototype,\"isSubsetOf\",function(o){need(o);var ok=true;this.forEach(function(v){if(!o.has(v))ok=false;});return ok;});def(Set.prototype,\"isSupersetOf\",function(o){need(o);var ok=true;o.forEach(function(v){if(!this.has(v))ok=false;},this);return ok;});def(Set.prototype,\"isDisjointFrom\",function(o){need(o);var d=true;this.forEach(function(v){if(o.has(v))d=false;});return d;});}catch(e){}})();";
// 页面与 worker 共用的完整垫片源码（worker 里 pdfjs 同样需要这一族）
const SHARED_CODE = TYPED_ARRAY_CODE + NEW_API_CODE;
const SHARED_POLYFILL = '<script>' + SHARED_CODE + '</script>';
// worker 版：把同一份垫片源码前置进 JS 类型的 Blob（worker 与页面共用一份实现）
const WORKER_POLYFILL = '<script>(function(){try{if(window.__dshArkWorker)return;window.__dshArkWorker=1;var P=' + JSON.stringify(SHARED_CODE) + ';var B=window.Blob;function W(a,o){try{if(o&&typeof o.type==="string"&&/javascript/i.test(o.type)&&a&&typeof a.length==="number"){var parts=[P];for(var i=0;i<a.length;i++)parts.push(a[i]);return new B(parts,o);}}catch(e){}return a===undefined?new B():new B(a,o);}W.prototype=B.prototype;window.Blob=W;}catch(e){}})();</script>';

// 2026-09-25：垫片从「反代注入」升级为「webserver index 注入」。
// 3081 反代当前由 dsh-pocket 提供服务（本插件处于 delegated 热备），反代层的注入因而不会执行；
// 而 webserver 的 index tap 是官方扩展点（@deepseek-ai/dsh-host-webserver 的 tapIndex，
// 由 dsh-host-frontend-static 渲染 index.html 时调用）——不论请求最终由哪个反代转发，
// 只要 index 仍由 DSH 渲染，垫片就生效。
const ARK_SHIM_MARK = 'data-dsh-arkweb-shim="1"';
const ARK_SHIM_HTML = '<script ' + ARK_SHIM_MARK + '>window.__dshArkwebShim=1</script>'
  + POLYFILL + URL_SHIM + SHARED_POLYFILL + WORKER_POLYFILL;

/** 把移动端浏览器垫片插到 <head> 最前（先于官方与客户端脚本执行）。幂等：已含标记的 HTML 原样返回。 */
export function injectArkWebShim(html) {
  if (typeof html !== 'string') return html;
  if (html.indexOf(ARK_SHIM_MARK) !== -1) return html;
  const open = /<head(?:\s[^>]*)?>/i.exec(html);
  if (open === null) return ARK_SHIM_HTML + html;
  const at = open.index + open[0].length;
  return html.slice(0, at) + ARK_SHIM_HTML + html.slice(at);
}

// 2026-09-14 客户端能力自检（零操作）：页面加载时自动回传
//  ① 这台设备的浏览器到底缺哪些现代 API（一次列清，回答"其他文件还会不会有缺口"）；
//  ② worker realm 里 toHex 修好没有（data: URL 起 classic worker 绕过 Blob 包装 = 原生值；
//     经 Blob 起 module worker = 垫片生效后的值）。
// 结果写到 ~/.dsh/wifi-access-client-caps.log，模型侧可直接读；失败静默，绝不影响页面。
const CAPS_BEACON = `<script>(function(){try{
  var out={ua:navigator.userAgent,secure:(typeof isSecureContext==="boolean"?isSecureContext:null),href:location.origin};
  var probes={"Promise.withResolvers":"Promise.withResolvers","Promise.try":"Promise.try","Promise.any":"Promise.any","Object.groupBy":"Object.groupBy","Map.groupBy":"Map.groupBy","Map.getOrInsert":"Map.prototype.getOrInsert","Map.getOrInsertComputed":"Map.prototype.getOrInsertComputed","WeakMap.getOrInsertComputed":"WeakMap.prototype.getOrInsertComputed","Array.fromAsync":"Array.fromAsync","Array.prototype.at":"Array.prototype.at","Array.prototype.findLast":"Array.prototype.findLast","Object.hasOwn":"Object.hasOwn","String.prototype.replaceAll":"String.prototype.replaceAll","structuredClone":"structuredClone","URL.canParse":"URL.canParse","URL.parse":"URL.parse","AbortSignal.any":"AbortSignal.any","Math.sumPrecise":"Math.sumPrecise","RegExp.escape":"RegExp.escape","Float16Array":"Float16Array","Iterator.from":"Iterator.from","Iterator.prototype.map":"Iterator.prototype.map","Iterator.prototype.toArray":"Iterator.prototype.toArray","Uint8Array.toHex":"Uint8Array.prototype.toHex","Uint8Array.fromHex":"Uint8Array.fromHex","Uint8Array.toBase64":"Uint8Array.prototype.toBase64","Uint8Array.fromBase64":"Uint8Array.fromBase64","Set.union":"Set.prototype.union","Set.intersection":"Set.prototype.intersection","Set.difference":"Set.prototype.difference","Set.symmetricDifference":"Set.prototype.symmetricDifference","crypto.randomUUID":"crypto.randomUUID"};
  out.missing=[];out.present=0;
  for(var k in probes){try{var v=probes[k].split(".").reduce(function(o,p){return o==null?o:o[p];},window);if(typeof v==="function")out.present++;else out.missing.push(k);}catch(e){out.missing.push(k);}}
  out.blobWrapped=String(window.Blob).indexOf("parts.push")>=0;
  var pending=2;function fire(){if(--pending>0)return;try{var body=JSON.stringify(out);if(navigator.sendBeacon)navigator.sendBeacon("/wifi-access/api/client-caps",new Blob([body],{type:"application/json"}));else fetch("/wifi-access/api/client-caps",{method:"POST",body:body,keepalive:true});}catch(e){}}
  function probe(url,opts,done){try{var w=new Worker(url,opts||{});var t=setTimeout(function(){try{w.terminate();}catch(e){}done("TIMEOUT");},5000);w.onmessage=function(e){clearTimeout(t);try{w.terminate();}catch(err){}done(String(e.data));};w.onerror=function(e){clearTimeout(t);done("ERR "+((e&&e.message)||""));};}catch(e){done("THROW "+e.message);}}
  var src="self.postMessage(typeof Uint8Array.prototype.toHex)";
  probe("data:text/javascript,"+encodeURIComponent(src),{},function(v){out.workerNativeToHex=v;fire();});
  try{probe(URL.createObjectURL(new Blob([src],{type:"text/javascript"})),{type:"module",name:"caps-probe"},function(v){out.workerBlobToHex=v;fire();});}catch(e){out.workerBlobToHex="THROW "+e.message;fire();}
}catch(e){}})();</script>`;

// 改写 Host/Origin 回 loopback；HTTP 转发去逐跳头（WS 用 rewriteUpgradeHeaders）
function rewriteHeaders(headers) {
  const h = { ...headers };
  h.host = `${TARGET_HOST}:${TARGET_PORT}`;
  h[LAN_PROXY_HEADER] = "1";
  if (h.origin) h.origin = `http://${TARGET_HOST}:${TARGET_PORT}`;
  // 2026-09-11：文档导航一律要未压缩的 HTML —— 注入 polyfill 必须改 body，
  // 而压缩响应（gzip/br）会与注入后的明文冲突（白屏根因）。注入侧仍保留解压兜底。
  if (String(h.accept || "").includes("text/html")) h["accept-encoding"] = "identity";
  const hopByHop = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];
  for (const k of hopByHop) delete h[k];
  return h;
}

// WS 握手必须保留 Connection/Upgrade 头，只改 Host/Origin 并删其余逐跳头
function rewriteUpgradeHeaders(headers) {
  const h = { ...headers };
  h.host = `${TARGET_HOST}:${TARGET_PORT}`;
  if (h.origin) h.origin = `http://${TARGET_HOST}:${TARGET_PORT}`;
  const hopByHop = ["keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding"];
  for (const k of hopByHop) delete h[k];
  return h;
}

function injectPolyfill(headers, bodyBuf) {
  const ct = String(headers["content-type"] || "");
  if (!ct.toLowerCase().includes("text/html")) return { headers, body: bodyBuf };
  const h = { ...headers };
  // 2026-09-11 修复（手机端白屏根因）：上游 3080 对 HTML 会按 Accept-Encoding 压缩（gzip/br）。
  // 旧实现直接对（可能仍压缩的）字节做 toString('utf8') 再拼 polyfill，却把 content-encoding: gzip
  // 原样透传 —— 浏览器按 gzip 解码「明文 polyfill + gzip 数据」必然失败，报
  // net::ERR_CONTENT_DECODING_FAILED，页面纯白。现在：先按 content-encoding 解压再注入；
  // 解压失败则原样透传（宁可不注入，也不破坏响应）。请求侧另见 rewriteHeaders 的 identity 兜底。
  const ce = String(h["content-encoding"] || "").toLowerCase();
  let buf = bodyBuf;
  if (ce.length > 0 && ce !== "identity") {
    try {
      buf = ce.includes("br")
        ? brotliDecompressSync(bodyBuf)
        : ce.includes("gzip")
          ? gunzipSync(bodyBuf)
          : inflateSync(bodyBuf); // deflate
    } catch {
      return { headers, body: bodyBuf };
    }
    delete h["content-encoding"];
  }
  const body = buf.toString("utf8");
  const idx = body.toLowerCase().indexOf("<head>");
  const out = idx !== -1 ? body.slice(0, idx + 6) + POLYFILL + URL_SHIM + WORKER_POLYFILL + SHARED_POLYFILL + CAPS_BEACON + body.slice(idx + 6) : POLYFILL + URL_SHIM + WORKER_POLYFILL + SHARED_POLYFILL + CAPS_BEACON + body;
  const outBuf = Buffer.from(out, "utf8");
  h["content-length"] = String(outBuf.length);
  delete h["etag"];
  delete h["transfer-encoding"];
  return { headers: h, body: outBuf };
}

/** 本机可被移动端访问的 IPv4 列表：真实局域网私有段（192.168/16、10/8、172.16/12）优先，
 *  排除回环与链路本地（169.254 APIPA）、虚拟网卡（Radmin 26.x 等非局域网段）。 */
function lanAddresses() {
  const addrs = [];
  for (const list of Object.values(networkInterfaces())) {
    for (const iface of list || []) {
      if (iface.family !== "IPv4" || iface.internal) continue;
      const ip = iface.address;
      if (!ip) continue;
      const parts = ip.split(".").map(Number);
      if (parts.length !== 4 || parts.some((n) => Number.isNaN(n))) continue;
      // 跳过链路本地 APIPA（169.254.x.x）与本机回环
      if (parts[0] === 169 && parts[1] === 254) continue;
      if (parts[0] === 127) continue;
      // 真实局域网私有段优先：192.168.x.x > 10.x.x.x > 172.16-31.x.x
      let rank = 3;
      if (parts[0] === 192 && parts[1] === 168) rank = 0;
      else if (parts[0] === 10) rank = 1;
      else if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) rank = 2;
      addrs.push({ ip, rank });
    }
  }
  return [...new Set(addrs)]
    .sort((a, b) => a.rank - b.rank || (a.ip < b.ip ? -1 : 1))
    .map((a) => a.ip);
}

// 兜底：任何未捕获错误都不让宿主进程崩溃
process.on("uncaughtException", (e) => console.log("[wifi-access] uncaughtException:", (e && e.code) || (e && e.message)));
process.on("unhandledRejection", (e) => console.log("[wifi-access] unhandledRejection:", (e && e.code) || (e && e.message)));

export function apply(ctx) {
  const http = createRequire(import.meta.url)("node:http");
  const webServer = ctx.get("webServer");
  const tools = ctx.get("tools");
  TARGET_PORT = (webServer && webServer.port) || 3080;

  // index 注入（见 injectArkWebShim）：官方扩展点，与反代层注入互为兜底，拿不到也不影响反代
  try {
    if (webServer && typeof webServer.tapIndex === "function") {
      ctx.effect(() => webServer.tapIndex((html) => injectArkWebShim(html)), "wifi-access: index tap");
    }
  } catch { /* keep going */ }

  // 浏览器会话权威（提供 authenticatedUrl()）。软依赖：拿不到就退化成旧行为
  // （裸 URL + 401 直传），绝不让本插件因为缺服务而挂载失败——那会连反代都没了。
  let connection = ctx.get("connection") || null;
  if (!connection) {
    try { ctx.inject(["connection"], (c) => { connection = c.connection; }); } catch { /* keep null */ }
  }

  /** 带进程令牌的访问 URL（拿不到 connection 时原样返回）。 */
  function authUrl(base) {
    try {
      if (connection && typeof connection.authenticatedUrl === "function") return connection.authenticatedUrl(base);
    } catch { /* fall through */ }
    return base;
  }

  /** 进程启动令牌；用于把裸导航 302 到 token 兑换入口。 */
  function launchToken() {
    try {
      if (!connection || typeof connection.authenticatedUrl !== "function") return "";
      const url = new URL(connection.authenticatedUrl(`http://${TARGET_HOST}:${TARGET_PORT}`));
      return url.searchParams.get("token") || "";
    } catch { return ""; }
  }

  /** 浏览器文档导航（而非 fetch/资源/WS）。 */
  function isHtmlNavigation(req) {
    return req.method === "GET" && String((req.headers && req.headers.accept) || "").includes("text/html");
  }

  let server = null; // 当前反代实例
  let listenError = "";
  // 3081 被「另一个 DSH 实例」的同款反代占住时（常见：3080 正常版与本实例同时开着），
  // 不再当红错报「端口被占用」，而是按「由它提供」显示；并周期复探，对方退出后自己接管。
  let delegated = false;
  // 移动端活跃监测：记录最近一次「来自非本机（手机/平板等）」的访问时间（含 HTTP 与 WS upgrade）
  let lastPhoneAccess = 0;
  let phoneCount = 0; // 当前活跃移动端连接数（粗略：非本机来源的 socket）

  /** 判断来源地址是否为本机（回环或本机网卡 IP）。 */
  function isLocalClient(ip) {
    if (!ip) return true;
    const v4 = ip.replace(/^::ffff:/, "").replace(/^::1$/, "127.0.0.1");
    if (v4 === "127.0.0.1" || v4 === "::1") return true;
    const localIps = new Set();
    for (const list of Object.values(networkInterfaces())) {
      for (const iface of list || []) {
        if (iface.family === "IPv4" && iface.address) localIps.add(iface.address);
      }
    }
    return localIps.has(v4);
  }

  function noteAccess(ip) {
    if (!isLocalClient(ip)) {
      lastPhoneAccess = Date.now();
      phoneCount += 1;
    }
  }

  function closeServer() {
    if (!server) return;
    try {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
      server.close();
    } catch { /* ignore */ }
    server = null;
  }

  /** 请求是否来自局域网反代（手机/平板）。带标记 = 来自局域网。 */
  function isLanProxy(req) {
    return String((req && req.headers && req.headers[LAN_PROXY_HEADER]) || "") !== "";
  }

  /** 探测 3081 上是否已有同类插件在服务（= 另一个 DSH 实例的反代）。 */
  function probeDelegated() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (!done) { done = true; resolve(v); } };
      try {
        const req = http.get({ host: TARGET_HOST, port: LISTEN_PORT, path: "/wifi-access/api/status", timeout: 1500 }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            try {
              const doc = JSON.parse(Buffer.concat(chunks).toString("utf8"));
              finish(!!doc && doc.ok === true && doc.port === LISTEN_PORT);
            } catch { finish(false); }
          });
        });
        req.on("error", () => finish(false));
        req.on("timeout", () => { try { req.destroy(); } catch { /* ignore */ } finish(false); });
      } catch { finish(false); }
    });
  }

  /** delegated 期间每 20s 复探：对方退出（或不再是同类插件）就自己接管 3081。 */
  function startDelegatedWatch() {
    try {
      const timer = setInterval(() => {
        if (!delegated) return;
        probeDelegated().then((ok) => {
          if (ok) return;
          delegated = false;
          listenError = "";
          startServer();
        }).catch(() => { /* ignore */ });
      }, 20000);
      if (timer && typeof timer.unref === "function") timer.unref();
    } catch { /* ignore */ }
  }

  function startServer() {
    closeServer();
    listenError = "";
    const s = http.createServer((req, res) => {
      noteAccess(req.socket && req.socket.remoteAddress);
      req.on("error", () => { try { req.destroy(); } catch {} });
      res.on("error", () => { try { res.destroy(); } catch {} });
      const proxyReq = http.request({
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: req.url,
        method: req.method,
        headers: rewriteHeaders(req.headers),
      }, (proxyRes) => {
        // 裸导航被上游 401（新版必须兑换 token）→ 本地 302 到兑换入口，
        // 手机端只看到「打开就是界面」，而不是 "dsh web authentication required"。
        if (proxyRes.statusCode === 401 && isHtmlNavigation(req) && !/[?&]token=/.test(String(req.url || ""))) {
          const token = launchToken();
          if (token) {
            try { proxyRes.resume(); } catch { /* ignore */ }
            try {
              res.writeHead(302, {
                location: "/?token=" + encodeURIComponent(token),
                "cache-control": "no-store",
                "referrer-policy": "no-referrer",
              });
              res.end();
            } catch { /* ignore */ }
            return;
          }
        }
        proxyRes.on("error", () => { try { res.destroy(); } catch {} });
        const chunks = [];
        proxyRes.on("data", (c) => chunks.push(c));
        proxyRes.on("end", () => {
          const buf = Buffer.concat(chunks);
          const { headers, body } = injectPolyfill(proxyRes.headers, buf);
          res.writeHead(proxyRes.statusCode, headers);
          res.end(body);
        });
      });
      proxyReq.on("error", (e) => { try { res.writeHead(502); res.end("proxy error: " + e.message); } catch {} });
      req.pipe(proxyReq);
    });

    s.on("upgrade", (req, socket, head) => {
      noteAccess(req.socket && req.socket.remoteAddress);
      socket.on("error", () => { try { socket.destroy(); } catch {} });
      const proxyReq = http.request({
        hostname: TARGET_HOST,
        port: TARGET_PORT,
        path: req.url,
        method: req.method,
        headers: rewriteUpgradeHeaders(req.headers),
      });
      proxyReq.on("upgrade", (proxyRes, proxySocket, proxyHead) => {
        proxySocket.on("error", () => { try { proxySocket.destroy(); } catch {} });
        const headText = Object.keys(proxyRes.headers).map((k) => `${k}: ${proxyRes.headers[k]}`).join("\r\n");
        socket.write(`HTTP/1.1 101 Switching Protocols\r\n${headText}\r\n\r\n`);
        if (proxyHead && proxyHead.length) socket.write(proxyHead);
        proxySocket.pipe(socket);
        socket.pipe(proxySocket);
      });
      proxyReq.on("error", () => { try { socket.destroy(); } catch {} });
      proxyReq.end(head);
    });

    s.on("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        listenError = `端口 ${LISTEN_PORT} 被占用（可能旧 dsh-wifi-proxy.js 仍在运行），请先停止旧代理`;
        // 先按老文案报错，随后探测：若占住 3081 的是另一个 DSH 实例的同款反代，
        // 说明「移动端访问其实在正常工作」，改成由它提供的状态，不给用户假红错。
        probeDelegated().then((ok) => {
          if (ok) { delegated = true; listenError = ""; }
        }).catch(() => { /* ignore */ });
      } else {
        listenError = String((err && err.message) || err);
      }
      if (server === s) server = null;
    });
    s.listen(LISTEN_PORT, LISTEN_HOST);
    server = s;
  }

  function statusPayload(bare) {
    const running = (!!server && !listenError) || delegated;
    // 带 token 的 URL：只有本机 GUI 才拿得到（bare=true 表示请求来自局域网反代，
    // 只给裸地址——裸导航由反代本地 302 自动配对，token 不外泄）。
    const urls = lanAddresses().map((ip) => (bare ? `http://${ip}:${LISTEN_PORT}` : authUrl(`http://${ip}:${LISTEN_PORT}`)));
    // 移动端连接状态：最近 60 秒内有来自非本机（局域网/远程）的访问即视为已连接
    const phoneConnected = Date.now() - lastPhoneAccess < 60000;
    return {
      ok: true,
      running,
      delegated,
      listenError,
      port: LISTEN_PORT,
      targetPort: TARGET_PORT,
      urls,
      mainUrl: urls[0] || "",
      phoneConnected,
      phoneLastSeen: lastPhoneAccess,
      usbHint: "USB 兜底：adb reverse tcp:3080 tcp:3080 后访问 http://localhost:3080",
    };
  }

  // —— 路由 ——
  function registerRoute(method, path, handler) {
    if (!webServer) return;
    webServer.register({
      kind: "exact",
      path,
      handler: async (req, res) => {
        let result;
        try {
          if (req.method !== method) result = { ok: false, error: "method-not-allowed" };
          else result = await handler(req);
        } catch (e) {
          result = { ok: false, error: String((e && e.message) || e).slice(0, 300) };
        }
        res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify(result));
      },
    });
  }

  registerRoute("GET", "/wifi-access/api/status", async (req) => statusPayload(isLanProxy(req)));
  registerRoute("POST", "/wifi-access/api/start", async (req) => { startServer(); return statusPayload(isLanProxy(req)); });
  registerRoute("POST", "/wifi-access/api/stop", async (req) => { closeServer(); return statusPayload(isLanProxy(req)); });

  // 客户端能力自检回传（见 CAPS_BEACON）：追加一行 JSON，模型侧可直接读 ~/.dsh/wifi-access-client-caps.log
  // 注：本插件没有 DATA_DIR/path/fs，全部按需 createRequire 取（上一次写错成 DATA_DIR 被静默吞掉过一次）
  registerRoute("POST", "/wifi-access/api/client-caps", async (req) => {
    const doc = await new Promise((resolve) => {
      let b = "";
      req.on("data", (c) => { b += c; });
      req.on("end", () => { try { resolve(JSON.parse(b || "{}")); } catch { resolve({ raw: String(b).slice(0, 500) }); } });
      req.on("error", () => resolve({}));
    });
    try {
      const load = createRequire(import.meta.url);
      const fsMod = load("node:fs");
      const pathMod = load("node:path");
      const osMod = load("node:os");
      const file = pathMod.join(osMod.homedir(), ".dsh", "wifi-access-client-caps.log");
      const existing = fsMod.existsSync(file) ? fsMod.statSync(file).size : 0;
      if (existing < 512 * 1024) fsMod.appendFileSync(file, new Date().toISOString() + " " + JSON.stringify(doc) + "\n", "utf8");
    } catch { /* 静默：自检失败不影响任何功能 */ }
    return { ok: true };
  });

  // 二维码 SVG：/wifi-access/api/qr?text=...（qrcode.js 生成矩阵 → SVG rect）
  registerRoute("GET", "/wifi-access/api/qr", async (req) => {
    const url = new URL(req.url || "/", "http://x");
    const text = (url.searchParams.get("text") || "").slice(0, 512);
    if (!text) return { ok: false, error: "missing-text" };
    return { ok: true, svg: qrSvg(text, 5) };
  });

  // —— 模型工具 ——
  if (tools) {
    tools.register(defineTool({
      name: "query_wifi_access",
      description: "查询 DSH 移动端（手机/平板）局域网访问状态：返回移动端可访问的 URL（WiFi 反代 3081 端口）与启停提示。",
      parameters: {},
      output: { schema: { type: "object", additionalProperties: true }, render: (_a, v) => [{ type: "text", text: String((v && v.content) || "") }] },
      async execute() {
        const s = statusPayload();
        if (s.listenError) return { content: "移动端访问未运行：" + s.listenError };
        if (!s.mainUrl) return { content: "未检测到局域网 IPv4 地址，移动端无法通过 WiFi 访问（可尝试 USB 兜底：adb reverse tcp:3080 tcp:3080 → http://localhost:3080）" };
        const lines = [
          "## DSH 移动端访问",
          "- WiFi（同一局域网）访问：" + s.mainUrl,
          ...(s.delegated ? ["- 说明：3081 由另一个 DSH 实例（通常是 3080）的反代提供"] : []),
          ...(s.urls.length > 1 ? s.urls.slice(1).map((u) => "  - " + u) : []),
          "- USB 兜底：" + s.usbHint,
        ];
        return { content: lines.join("\n") };
      },
    }));
  }

  // 默认开启（2026-08-21 用户要求「保持移动端访问持续开启，默认开启，用不到自己关」）：
  // 随插件生命周期自动启动反代，无需手动点「启动」；用不到时在左栏面板点「停止」关闭。
  startServer();
  // 3081 被另一个实例占住时（本进程起不来反代），周期复探以便对方退出后接管。
  startDelegatedWatch();
}


// —— 二维码（qrcode.js：Kazuhiko Arase，MIT）——
let _qrcode = null;
function qrFactory() {
  if (!_qrcode) {
    const require = createRequire(import.meta.url);
    _qrcode = require("./vendor/qrcode.cjs");
  }
  return _qrcode;
}
function qrSvg(text, scale) {
  const qr = qrFactory()(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const size = n * scale;
  const cells = [];
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.isDark(r, c)) cells.push(`<rect x="${c * scale}" y="${r * scale}" width="${scale}" height="${scale}"/>`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" shape-rendering="crispEdges">${cells.join("")}</svg>`;
}
