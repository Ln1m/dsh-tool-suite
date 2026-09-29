// dsh-local-file-search —— Host 半端
// 在 Host 进程里提供「本机文件搜索」HTTP 能力：
//   GET /localfiles/api/search?q=<关键词>&limit=<n>  一次性全机 BFS 搜索（有界、超预算即返已有结果）
//   GET /localfiles/api/roots                        当前搜索根与预算参数（供 UI 显示范围）
// 设计基调：不建索引、不落盘、不写入工作区文件表；每次查询现场遍历，结果随响应即弃
// （仅保留一份极短的查询结果缓存，避免同一关键词被重复全机扫描）。

import { opendir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const name = 'dsh-local-file-search';
export const inject = ['webServer'];

/** 遍历时整体跳过的目录基名（小写比较）：系统区、包缓存、构建产物。 */
const DEFAULT_EXCLUDES = [
  'windows', '$recycle.bin', 'system volume information', 'recovery', 'perflogs', 'msocache',
  'config.msi', '$windows.~bt', '$windows.~ws', 'program files', 'program files (x86)', 'programdata',
  'appdata', 'onedrivetemp', 'node_modules', '.git', '.svn', '.hg', '.cache', '.gradle', '.m2', '.nuget',
  '.conda', '.venv', '.tox', '__pycache__', 'site-packages', 'temp', 'tmp', '.vscode', '.cursor',
  '.npm', '.pnpm-store', '.yarn', '.cargo', '.rustup', 'wsl', '.docker',
];

const DEFAULTS = {
  /** 搜索根；留空 = 自动取所有存在的盘符根。 */
  roots: [],
  /** 递归深度上限（根为 0 层）。 */
  maxDepth: 9,
  /** 单次搜索时间预算（毫秒），到点即返回已收集结果。 */
  budgetMs: 7000,
  /** 单次搜索最多检视的目录条目数（BFS 层序，先浅后深）。 */
  maxEntries: 900000,
  /** 命中收集上限，达到即停。 */
  maxMatches: 400,
  /** 提前收工：已扫过 earlyStopEntries 条目且命中已达 earlyStopMatches 时不再深入（浅层已有足够选择）。 */
  earlyStopMatches: 12,
  earlyStopEntries: 300000,
  /** 默认返回条数（可被请求的 limit 覆盖）。 */
  limit: 30,
  /** 目录并发度。 */
  concurrency: 32,
  /** 结果缓存条数与存活时间。 */
  cacheSize: 24,
  cacheTtlMs: 60000,
  excludeDirectories: DEFAULT_EXCLUDES,
};

/** 所有真实存在的盘符根（A:–Z:）。 */
function driveRoots() {
  const roots = [];
  for (let code = 65; code <= 90; code += 1) {
    const root = `${String.fromCharCode(code)}:\\`;
    try {
      if (existsSync(root)) roots.push(root);
    } catch {
      /* 不存在的盘符/未就绪的驱动器：跳过 */
    }
  }
  return roots;
}

/** 统一成正斜杠形式（DSH 内部与 @ 提示词都用 `/`）。 */
function toPosix(path) {
  return path.replace(/\\/g, '/');
}

/**
 * 命中打分：精确名 > 前缀 > 子串；浅层、短路径优先，同名时目录略微让位给文件。
 * @param item - 命中项（name/path/kind/depth）。
 * @param kw - 已小写化的关键词。
 * @returns 分值，越大越靠前。
 */
function scoreOf(item, kw) {
  const lower = item.name.toLowerCase();
  const stem = lower.replace(/\.[^.]+$/, '');
  let score;
  if (lower === kw || stem === kw) score = 100;
  else if (lower.startsWith(kw)) score = 86;
  else if (stem.startsWith(kw)) score = 78;
  else if (lower.includes(kw)) score = 58;
  else score = 30;
  if (item.kind === 'directory') score -= 2;
  score -= Math.min(12, item.depth * 2);
  score -= Math.min(8, Math.floor(item.path.length / 40));
  return score;
}

/**
 * 一次有界的本机 BFS 搜索：按层推进（浅目录先扫完），层内并发，超时/超条目/超命中即止。
 * @param keyword - 用户关键词（非空）。
 * @param opts - 生效配置（roots/maxDepth/budgetMs/maxEntries/maxMatches/limit/concurrency/excludeDirectories）。
 * @param signal - 取消信号（浏览器断开时中止遍历）。
 * @returns 结果项与统计。
 */
async function searchLocal(keyword, opts, signal) {
  const kw = keyword.toLowerCase();
  const startedAt = Date.now();
  const budgetMs = opts.budgetMs;
  const excludes = new Set(opts.excludeDirectories.map((s) => s.toLowerCase()));
  const roots = opts.roots.length > 0 ? opts.roots : driveRoots();
  const matches = [];
  let scanned = 0;
  let visited = 0;
  let stopReason = false;
  let stopped = false;

  let level = roots.map((dir) => ({ dir, depth: 0 }));
  for (let depth = 0; depth <= opts.maxDepth && level.length > 0; depth += 1) {
    const next = [];
    let head = 0;
    const workerCount = Math.max(1, Math.min(opts.concurrency, level.length));
    const worker = async () => {
      while (!stopped) {
        if (head >= level.length) return;
        if (Date.now() - startedAt > budgetMs) {
          stopReason = 'budget';
          stopped = true;
          return;
        }
        if (scanned >= opts.maxEntries) {
          stopReason = 'entries';
          stopped = true;
          return;
        }
        if (matches.length >= opts.maxMatches) {
          stopReason = 'matches';
          stopped = true;
          return;
        }
        if (matches.length >= opts.earlyStopMatches && scanned >= opts.earlyStopEntries) {
          stopReason = 'sufficient';
          stopped = true;
          return;
        }
        const { dir } = level[head];
        head += 1;
        visited += 1;
        let handle;
        try {
          handle = await opendir(dir);
        } catch {
          continue; // 无权限/已消失的目录：跳过
        }
        try {
          for await (const entry of handle) {
            scanned += 1;
            if (entry.name.toLowerCase().includes(kw)) {
              matches.push({
                name: entry.name,
                path: toPosix(join(dir, entry.name)),
                kind: entry.isDirectory() ? 'directory' : 'file',
                depth,
              });
              if (matches.length >= opts.maxMatches) {
                stopReason = 'matches';
                stopped = true;
                break;
              }
              if (matches.length >= opts.earlyStopMatches && scanned >= opts.earlyStopEntries) {
                stopReason = 'sufficient';
                stopped = true;
                break;
              }
            }
            if (entry.isDirectory() && depth < opts.maxDepth && !excludes.has(entry.name.toLowerCase())) {
              next.push({ dir: join(dir, entry.name), depth: depth + 1 });
            }
          }
        } catch {
          /* 读取中途失败：保留已得条目 */
        }
      }
    };
    await Promise.all(Array.from({ length: workerCount }, worker));
    if (stopped || signal?.aborted === true) break;
    level = next;
  }

  const limit = Math.max(1, Math.min(200, opts.limit));
  const items = matches
    .map((item) => ({ ...item, score: scoreOf(item, kw) }))
    .sort((a, b) => (b.score - a.score) || (a.depth - b.depth) || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ score, ...item }) => item);

  return {
    items,
    stats: {
      roots: roots.map(toPosix),
      scanned,
      visited,
      matched: matches.length,
      ms: Date.now() - startedAt,
      truncated: signal?.aborted === true ? 'aborted' : stopReason,
      aborted: signal?.aborted === true,
    },
  };
}

/**
 * 挂载本机文件搜索：注册 HTTP 路由。
 * @param ctx - Host 根上下文（需 webServer）。
 * @param config - 插件配置（见 DEFAULTS）。
 */
export function apply(ctx, config) {
  const opts = { ...DEFAULTS, ...(config ?? {}) };
  const webServer = ctx.get('webServer');
  /** 短期结果缓存：key = `关键词|条数`，避免同一查询被连续重复全机扫描。 */
  const cache = new Map();

  /**
   * 注册一条精确路径的 JSON 路由。
   * @param method - 允许的 HTTP 方法。
   * @param path - 精确路径。
   * @param handler - 业务处理，返回值序列化为 JSON。
   */
  function registerRoute(method, path, handler) {
    if (!webServer) return;
    webServer.register({
      kind: 'exact',
      path,
      handler: async (req, res) => {
        let result;
        try {
          if (req.method !== method) result = { ok: false, error: 'method-not-allowed' };
          else result = await handler(req);
        } catch (error) {
          result = { ok: false, error: String((error && error.message) || error).slice(0, 300) };
        }
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(result));
      },
    });
  }

  registerRoute('GET', '/localfiles/api/roots', async () => ({
    ok: true,
    roots: (opts.roots.length > 0 ? opts.roots : driveRoots()).map(toPosix),
    config: {
      maxDepth: opts.maxDepth,
      budgetMs: opts.budgetMs,
      maxEntries: opts.maxEntries,
      limit: opts.limit,
      excludeDirectories: opts.excludeDirectories.length,
    },
  }));

  registerRoute('GET', '/localfiles/api/search', async (req) => {
    const url = new URL(req.url || '/', 'http://localhost');
    const keyword = (url.searchParams.get('q') || '').trim();
    if (keyword === '') return { ok: false, error: 'empty-query' };
    const limit = Number(url.searchParams.get('limit')) || opts.limit;
    const depth = Number(url.searchParams.get('depth'));
    const effective = { ...opts, limit, ...(Number.isFinite(depth) && depth > 0 ? { maxDepth: Math.min(depth, 64) } : {}) };

    const key = `${keyword.toLowerCase()}|${limit}|${effective.maxDepth}`;
    const hit = cache.get(key);
    if (hit !== undefined && Date.now() - hit.at < opts.cacheTtlMs) return { ok: true, keyword, cached: true, ...hit.value };

    const controller = new AbortController();
    const onClose = () => controller.abort();
    req.once('close', onClose);
    let outcome;
    try {
      outcome = await searchLocal(keyword, effective, controller.signal);
    } finally {
      req.off('close', onClose);
    }
    const value = { items: outcome.items, stats: outcome.stats };
    if (!outcome.stats.aborted) {
      cache.set(key, { at: Date.now(), value });
      while (cache.size > opts.cacheSize) cache.delete(cache.keys().next().value);
    }
    return { ok: true, keyword, cached: false, ...value };
  });
}
