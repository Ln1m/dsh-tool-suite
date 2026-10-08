// dsh-literature-search: a model-callable literature_search tool.
//
// Wraps the local paper-search.py (env DSH_PAPER_SEARCH_SCRIPT, default ~/Research-Tools/paper-search.py; OpenAlex cited-count
// sort + arXiv relevance) so literature search is one structured tool call
// instead of "read the literature-search skill body, then run a shell command".
// @module dsh-literature-search
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { defineTool } from '@deepseek-ai/dsh-tools'

const execFileAsync = promisify(execFile)

const name = 'dsh-literature-search'
const inject = ['tools']

/** Absolute path to paper-search.py (the tool backend). */
const PAPER_SEARCH_SCRIPT = process.env.DSH_PAPER_SEARCH_SCRIPT || join(homedir(), 'Research-Tools', 'paper-search.py')

/** Run the local literature-search script and return its markdown output. */
async function runPaperSearch(query, limit) {
  const n = Math.max(1, Math.min(50, Number.isInteger(limit) ? limit : 10))
  if (!existsSync(PAPER_SEARCH_SCRIPT)) {
    return `文献检索脚本不存在：${PAPER_SEARCH_SCRIPT}。请确认 paper-search.py 存在，或用环境变量 DSH_PAPER_SEARCH_SCRIPT 指定路径（详见 literature-search 技能 §1 兜底方案）。`
  }
  try {
    const { stdout } = await execFileAsync('python', [PAPER_SEARCH_SCRIPT, query, String(n)], {
      timeout: 90000,
      maxBuffer: 1024 * 1024 * 10,
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' }
    })
    return stdout
  } catch (err) {
    const detail = err && err.message ? err.message : String(err)
    return `文献检索执行失败: ${detail}。排查：① python 是否在 PATH（运行 \`python --version\`）；② ${PAPER_SEARCH_SCRIPT} 是否可运行、依赖已装；③ 网络（OpenAlex/arXiv 需国内直连）。`
  }
}

/** The literature_search tool: OpenAlex (cited-count sort) + arXiv (relevance). */
const literatureSearchTool = defineTool({
  name: 'literature_search',
  description:
    '检索外文学术文献（OpenAlex 按被引排序 + arXiv 按相关度），返回 Markdown 列表（标题/年份/作者/DOI/被引/是否开放获取）。' +
    '适合找经典/奠基文献、写文献综述、补充参考文献。输出为纯文本 Markdown。',
  parameters: {
    query: { type: 'string', description: '英文检索关键词（例如 "power electronics"）', required: true },
    limit: { type: 'integer', description: '每个源返回条数，默认 10，范围 1-50' }
  },
  output: {
    schema: { type: 'string' },
    render(args, value) {
      return [{ type: 'text', text: value }]
    }
  },
  async execute(args, exec) {
    return runPaperSearch(args.query, args.limit)
  }
})

/** Register the literature_search tool. */
function apply(ctx) {
  ctx.tools.register(literatureSearchTool)
}

export { apply, name, inject }
export default { apply, name, inject }
