/**
 * dsh-guard —— 本机安全网（host 半端，无客户端）
 *
 * 三件事，全部挂在 `agent/pre-step`（唯一的可拦截瀑布）+ `session/event`：
 *   1) 检查点：每个 step 前扫一次"自上次扫描以来被改动的文件"，把它们的**当前内容**
 *      存进 ~/.dsh/checkpoints/<agent>/<序号>-<时间戳>/files/<绝对路径镜像>/。
 *      回滚不靠这里——由 scripts\backup\checkpoints.mjs list/restore 完成。
 *   2) 改动钩子：~/.dsh/guard-hooks.json 里每条规则声明 match 通配符 + 命令，
 *      命中改动文件时跑命令（带超时），结果写日志，并作为一次性提示渲染进系统提示，
 *      保证模型看得到（不靠"我记得去跑"）。
 *   3) 调用审计：把每一步的 tool/call 追加到 ~/.dsh/checkpoints/audit.log。
 *
 * 设计约束：
 *   - 任何异常都不许冒泡进 step（安全网坏了不能拖垮对话）；
 *   - 扫描按 scanIntervalSec 节流，跳过大目录；
 *   - 提示只保留"至少被渲染过一次"的那些，避免每步刷前缀。
 */

import { readdirSync, readFileSync, writeFileSync, existsSync, statSync, mkdirSync, copyFileSync, rmSync, readlinkSync } from 'node:fs';
import { join, dirname, basename, relative, extname } from 'node:path';
import { homedir } from 'node:os';

export const name = 'dsh-guard';

const DSH_HOME = join(homedir(), '.dsh');
const DSH_ROOT = process.env.DSH_ROOT || join(homedir(), 'DeepSeek_harness');
const STORE = join(DSH_HOME, 'checkpoints');
const HOOKS_FILE = join(DSH_HOME, 'guard-hooks.json');
const AUDIT_LOG = join(STORE, 'audit.log');
const HOOK_LOG = join(STORE, 'hooks.log');

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'backups', 'archive', 'tmp', 'logs', 'storages',
  'sessions', '.pnpm', 'dist', 'build', 'out', 'obj', 'bin', '.cache', 'EBWebView',
  'embed-profile', 'installer', 'third-party', '_domcheck', 'office-cache', 'profiles',
  '__pycache__', '.vscode', '.metadata', 'attachments', 'boot-splash',
]);

const DEFAULTS = {
  scanIntervalSec: 20,
  keepPerSession: 40,
  maxTotalMB: 1024,
  maxFileMB: 4,
  maxFilesPerCheckpoint: 400,
  maxScanFiles: 40000,
  auditLog: true,
  hooksEnabled: true,
};

const log = (msg) => {
  try { console.log(`[dsh-guard] ${msg}`); } catch { /* ignore */ }
};
const appendLog = (file, line) => {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, line + '\n', { flag: 'a' });
  } catch { /* ignore */ }
};

/** 递归列文件（容量统计用）。 */
function walkFiles(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walkFiles(full, out);
    else if (e.isFile()) out.push(full);
  }
  return out;
}

/** 通配符 → 正则（`**` 跨目录，`*` 单段，大小写不敏感，路径统一成 `/`）。 */
export function globToRegExp(glob) {
  const norm = String(glob).replace(/\\/g, '/').toLowerCase();
  let re = '';
  for (let i = 0; i < norm.length; i++) {
    const c = norm[i];
    if (c === '*') {
      if (norm[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if (c === '?') {
      re += '[^/]';
    } else if ('\\^$.|+()[]{}'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

/** 改动集是否命中规则（任一命中即算）。 */
export function matchesAny(files, globs) {
  const res = globs.map(globToRegExp);
  return files.some((f) => {
    const p = f.replace(/\\/g, '/').toLowerCase();
    return res.some((re) => re.test(p));
  });
}

/** 递归收集 mtime 在 (sinceMs, untilMs] 的文件，跳过大目录，返回绝对路径。 */
export function scanChanged(roots, sinceMs, untilMs, limits = {}) {
  const maxFiles = limits.maxScanFiles ?? DEFAULTS.maxScanFiles;
  const out = [];
  const walk = (dir, depth) => {
    if (out.length >= maxFiles || depth > 8) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= maxFiles) return;
      const full = join(dir, e.name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith('.')) continue;
        walk(full, depth + 1);
        continue;
      }
      if (!st.isFile()) continue;
      if (st.mtimeMs > sinceMs && st.mtimeMs <= untilMs) out.push(full);
    }
  };
  for (const r of roots) if (existsSync(r)) walk(r, 0);
  return out;
}

/** 镜像绝对路径（D:\a\b → files/D/a/b）。 */
export function mirrorPath(abs) {
  const norm = abs.replace(/\\/g, '/');
  const m = /^([A-Za-z]):\/(.*)$/.exec(norm);
  return m ? `files/${m[1]}/${m[2]}` : `files/${norm.replace(/^\/+/, '')}`;
}

/** 钩子的命令模板里可用的占位符：{file} 首个命中文件、{dir} 其所在目录、{proj} Debug/Release 的上一级。 */
export function expandCommand(template, matched) {
  const file = String(matched?.[0] ?? '');
  const dir = file ? dirname(file) : '';
  const base = basename(dir).toLowerCase();
  const proj = base === 'debug' || base === 'release' ? dirname(dir) : dir;
  return String(template)
    .replace(/\{file\}/g, file)
    .replace(/\{dir\}/g, dir)
    .replace(/\{proj\}/g, proj);
}

/** 检查点总容量淘汰：返回需要删除的最旧目录，直到总量降到上限内。 */
export function pickEvictions(entries, capBytes) {
  let total = entries.reduce((n, e) => n + e.bytes, 0);
  const sorted = [...entries].sort((a, b) => a.mtimeMs - b.mtimeMs);
  const drop = [];
  for (const e of sorted) {
    if (total <= capBytes) break;
    drop.push(e);
    total -= e.bytes;
  }
  return drop;
}

export function apply(ctx, config = {}) {
  const cfg = { ...DEFAULTS, ...(config || {}) };
  const roots = Array.isArray(cfg.roots) && cfg.roots.length
    ? cfg.roots
    : [DSH_ROOT, join(DSH_HOME, 'skills')];

  let lastScanMs = Date.now();
  let notices = [];
  let previousNotices = [];
  const hookState = new Map();
  let hooksCache = { mtime: 0, rules: [] };

  mkdirSync(STORE, { recursive: true });

  const readHooks = () => {
    try {
      const st = statSync(HOOKS_FILE);
      if (st.mtimeMs === hooksCache.mtime) return hooksCache.rules;
      const parsed = JSON.parse(readFileSync(HOOKS_FILE, 'utf8'));
      const rules = Array.isArray(parsed?.hooks) ? parsed.hooks : [];
      hooksCache = { mtime: st.mtimeMs, rules };
      return rules;
    } catch {
      return hooksCache.rules;
    }
  };

  const pruneCheckpoints = (sessionDir) => {
    try {
      const dirs = readdirSync(sessionDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();
      const excess = dirs.length - cfg.keepPerSession;
      if (excess <= 0) return;
      for (const d of dirs.slice(0, excess)) rmSync(join(sessionDir, d), { recursive: true, force: true });
    } catch { /* ignore */ }
  };

  /** 全局总量上限：超过 maxTotalMB 就按最旧优先删（跨 agent）。 */
  const enforceTotalCap = () => {
    try {
      const capBytes = Math.max(1, cfg.maxTotalMB) * 1024 * 1024;
      const entries = [];
      for (const agent of readdirSync(STORE, { withFileTypes: true })) {
        if (!agent.isDirectory()) continue;
        const adir = join(STORE, agent.name);
        for (const cp of readdirSync(adir, { withFileTypes: true })) {
          if (!cp.isDirectory()) continue;
          const dir = join(adir, cp.name);
          let bytes = 0;
          let mtimeMs = 0;
          for (const f of walkFiles(dir)) {
            try {
              const st = statSync(f);
              bytes += st.size;
              mtimeMs = Math.max(mtimeMs, st.mtimeMs);
            } catch { /* ignore */ }
          }
          entries.push({ dir, bytes, mtimeMs });
        }
      }
      const drop = pickEvictions(entries, capBytes);
      for (const d of drop) {
        rmSync(d.dir, { recursive: true, force: true });
        log(`容量淘汰：${d.dir.replace(STORE, '')}（${(d.bytes / 1048576).toFixed(1)} MB）`);
      }
    } catch (e) {
      log('容量淘汰失败: ' + (e?.message ?? e));
    }
  };

  const saveCheckpoint = (agentKey, files, stampMs) => {
    const sessionDir = join(STORE, agentKey);
    mkdirSync(sessionDir, { recursive: true });
    const seq = readdirSync(sessionDir, { withFileTypes: true }).filter((e) => e.isDirectory()).length + 1;
    const d = new Date(stampMs);
    const p = (n) => String(n).padStart(2, '0');
    const dirName = `${String(seq).padStart(3, '0')}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
    const dir = join(sessionDir, dirName);
    const items = [];
    let saved = 0;
    for (const f of files.slice(0, cfg.maxFilesPerCheckpoint)) {
      let st;
      try { st = statSync(f); } catch { continue; }
      if (st.size > cfg.maxFileMB * 1024 * 1024) continue;
      const dest = join(dir, mirrorPath(f));
      try {
        mkdirSync(dirname(dest), { recursive: true });
        copyFileSync(f, dest);
        items.push({ source: f, stored: mirrorPath(f), bytes: st.size, mtime: st.mtimeMs });
        saved++;
      } catch { /* 单个文件失败不影响其余 */ }
    }
    if (!saved) { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } return null; }
    const manifest = {
      version: 1,
      agent: agentKey,
      checkpoint: seq,
      createdAt: new Date(stampMs).toISOString(),
      changed: files.length,
      saved,
      items,
    };
    try { writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf8'); } catch { /* ignore */ }
    pruneCheckpoints(sessionDir);
    return { dir, manifest };
  };

  const runHooks = async (agentKey, files, stepKey) => {
    if (!cfg.hooksEnabled) return;
    const rules = readHooks();
    if (!rules.length) return;
    const { spawn } = await import('node:child_process');
    const norm = (f) => f.replace(/\\/g, '/').toLowerCase();
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (rule.enabled === false) continue;
      const globs = Array.isArray(rule.match) ? rule.match : [rule.match].filter(Boolean);
      if (!globs.length) continue;
      const res = globs.map(globToRegExp);
      const matched = files.filter((f) => res.some((re) => re.test(norm(f))));
      if (!matched.length) continue;
      const oncePer = rule.oncePer ?? 'step';
      const key = `${i}:${rule.run}`;
      const stamp = oncePer === 'session' ? 'session' : oncePer === 'turn' ? `turn` : stepKey;
      if (oncePer !== 'always' && hookState.get(key) === stamp) continue;
      hookState.set(key, stamp);

      const timeoutMs = (rule.timeoutSec ?? 120) * 1000;
      const started = Date.now();
      const cmd = expandCommand(rule.run, matched);
      const result = await new Promise((resolve) => {
        let out = '';
        let child;
        try {
          child = spawn(cmd, { shell: true, cwd: rule.cwd || DSH_ROOT, windowsHide: true });
        } catch (e) {
          resolve({ code: -1, out: String(e.message) });
          return;
        }
        const timer = setTimeout(() => { try { child.kill(); } catch { /* ignore */ } resolve({ code: -2, out: out + '\n[超时被杀]' }); }, timeoutMs);
        child.stdout?.on('data', (b) => { out += b.toString(); });
        child.stderr?.on('data', (b) => { out += b.toString(); });
        child.on('close', (code) => { clearTimeout(timer); resolve({ code: code ?? -3, out }); });
        child.on('error', (e) => { clearTimeout(timer); resolve({ code: -4, out: String(e.message) }); });
      });
      const ms = Date.now() - started;
      const tail = result.out.trim().split(/\r?\n/).slice(-12).join('\n').slice(0, 900);
      appendLog(HOOK_LOG, `[${new Date().toISOString()}] agent=${agentKey} rule=${i} code=${result.code} ${ms}ms  cmd=${cmd}`);
      notices.push({
        rule: rule.name || rule.run.slice(0, 60),
        code: result.code,
        ms,
        tail,
        ok: result.code === 0,
      });
    }
  };

  const tick = async (agent, step) => {
    const now = Date.now();
    if (now - lastScanMs < cfg.scanIntervalSec * 1000) return;

    previousNotices = notices;
    notices = [];

    const files = scanChanged(roots, lastScanMs, now, cfg);
    lastScanMs = now;
    if (!files.length) return;

    const agentKey = String(agent?.id ?? 'unknown').replace(/[^\w.-]+/g, '_');
    // 检查点排除日志/临时/锁文件；钩子看全部改动（编译器产生的 Debug\*.log 也要能触发诊断）
    const forCheckpoint = files.filter((f) => !/\.(log|tmp|lock)$/i.test(basename(f)));
    const saved = saveCheckpoint(agentKey, forCheckpoint, now);
    if (saved) log(`checkpoint ${agentKey}/${saved.manifest.checkpoint}：${saved.manifest.saved}/${files.length} 文件`);
    enforceTotalCap();
    await runHooks(agentKey, files, `${step?.turn ?? '?'}-${step?.step ?? '?'}`);
  };

  ctx.on('agent/pre-step', async (payload, next) => {
    try {
      await tick(payload?.agent, { turn: payload?.turn, step: payload?.step });
    } catch (e) {
      log('tick failed: ' + (e?.message ?? e));
    }
    return next();
  });

  if (cfg.auditLog) {
    ctx.on('session/event', (_session, event) => {
      try {
        if (event?.type !== 'tool/call') return;
        const args = String(event.data?.arguments ?? '').replace(/\s+/g, ' ').slice(0, 160);
        appendLog(AUDIT_LOG, `[${new Date().toISOString()}] ${event.data?.name} ${args}`);
      } catch { /* ignore */ }
    });
  }

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.systemPrompt.section({
      name: 'guard-notices',
      order: 152,
      text: () => {
        const shown = [...previousNotices, ...notices];
        previousNotices = [];
        if (!shown.length) return '';
        const lines = shown.map((n) => {
          const head = n.ok ? `✅ ${n.rule}：退出 0（${n.ms}ms）` : `❌ ${n.rule}：退出 ${n.code}（${n.ms}ms）`;
          return n.tail ? `${head}\n${n.tail.split('\n').map((l) => '   ' + l).join('\n')}` : head;
        });
        return `GUARD 自检提示（dsh-guard 自动跑，不是用户说的）：\n${lines.join('\n')}`;
      },
    });
  });

  log(`已装载：roots=${roots.length} 个，扫描节流 ${cfg.scanIntervalSec}s，钩子文件 ${HOOKS_FILE}`);
  void relative;
  void basename;
  void extname;
  void readlinkSync;
}
