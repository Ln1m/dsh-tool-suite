// dsh-guard 离线自测（不需要跑 DSH）：纯函数 + 真实临时目录扫描
// 用法：node tests/offline.mjs
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { globToRegExp, matchesAny, mirrorPath, scanChanged, expandCommand, pickEvictions } from '../lib/index.js';

let pass = 0;
let fail = 0;
const ok = (cond, label) => { if (cond) { pass++; console.log('  ✓ ' + label); } else { fail++; console.log('  ✗ ' + label); } };

console.log('== 通配符 ==');
ok(globToRegExp('D:/a/**/*.mjs').test('d:/a/b/c/x.mjs'), '** 跨目录匹配');
ok(!globToRegExp('D:/a/*.mjs').test('d:/a/b/x.mjs'), '* 不跨目录');
ok(globToRegExp('D:\\a\\b.js').test('d:/a/b.js'), '反斜杠写法等价');
ok(!globToRegExp('D:/a/*.mjs').test('d:/a/x.js'), '扩展名不匹配');

console.log('== 命中判定 ==');
ok(matchesAny(['D:\\x\\y\\gate.mjs'], ['D:/x/**/*.mjs']), '命中任一即真');
ok(!matchesAny(['D:\\x\\y\\gate.py'], ['D:/x/**/*.mjs']), '不命中为假');

console.log('== 路径镜像 ==');
ok(mirrorPath('D:\\a\\b\\c.txt') === 'files/D/a/b/c.txt', '盘符路径镜像');

console.log('== 变更扫描（真实目录）==');
const dir = mkdtempSync(join(tmpdir(), 'guard-test-'));
mkdirSync(join(dir, 'sub'), { recursive: true });
mkdirSync(join(dir, 'node_modules'), { recursive: true });
const since = Date.now() - 1000;
writeFileSync(join(dir, 'a.txt'), 'A');
writeFileSync(join(dir, 'sub', 'b.txt'), 'B');
writeFileSync(join(dir, 'node_modules', 'skip.txt'), 'S');
const found = scanChanged([dir], since, Date.now() + 1000);
const names = found.map((f) => f.replace(dir, '').replace(/\\/g, '/'));
ok(names.includes('/a.txt'), '根目录文件命中');
ok(names.includes('/sub/b.txt'), '子目录文件命中');
ok(!names.some((n) => n.includes('node_modules')), 'node_modules 被跳过');
ok(scanChanged([dir], Date.now() + 10000, Date.now() + 20000).length === 0, '晚于窗口的文件不命中');

console.log('== 命令占位符 ==');
ok(
  expandCommand('node x.mjs "{proj}"', ['D:\\Desktop\\proj\\Debug\\build.log']) === 'node x.mjs "D:\\Desktop\\proj"',
  '{proj} 从 Debug 上一级取工程目录'
);
ok(
  expandCommand('echo {file}', ['D:\\a\\b.c']) === 'echo D:\\a\\b.c',
  '{file} 取首个命中文件'
);
ok(expandCommand('echo {dir}', ['D:\\a\\Debug\\x.log']) === 'echo D:\\a\\Debug', '{dir} 取所在目录');

console.log('== 容量淘汰 ==');
const ev = pickEvictions(
  [
    { dir: 'a', bytes: 400, mtimeMs: 3 },
    { dir: 'b', bytes: 400, mtimeMs: 1 },
    { dir: 'c', bytes: 400, mtimeMs: 2 },
  ],
  800
);
ok(ev.length === 1 && ev[0].dir === 'b', '超限时删最旧的那个');
ok(pickEvictions([{ dir: 'a', bytes: 100, mtimeMs: 1 }], 1024 * 1024).length === 0, '未超限不删');

const guard = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8');
ok(/export function apply/.test(guard) && /agent\/pre-step/.test(guard) && /systemPrompt/.test(guard), '插件导出与两处挂载点齐全');
ok(guard.includes('(log|tmp|lock)'), '检查点排除 .log/.tmp/.lock 而钩子看全部');

console.log(`\n结果：通过 ${pass} / 失败 ${fail}`);
process.exit(fail ? 1 : 0);
