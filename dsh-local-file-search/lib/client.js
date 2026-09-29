// dsh-local-file-search —— Client 半端
// 向输入触发流水线注册一个 @ 触发源，在 @ 列表里多出一行「搜索本机文件…」入口：
//   普通输入：入口行（可下钻）—— 若 @ 后已有关键词，入口行显示「在本机搜索「xx」…」
//   本机模式：草稿变成 @?关键词 后，本 source 现场调 Host 的 /localfiles/api/search，
//             把全机命中列成候选；选中即以 @绝对路径 插入（不进文件栏、不进工作区索引）。
// 命中结果是"一次性"的：不缓存进任何工作区列表，选完即弃。

window.__ModuleLoader__.load({
	id: 'dsh-local-file-search',
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

		/** 本机搜索模式的草稿前缀：`@?关键词`。 */
		const MODE_PREFIX = '?';
		/** Host 半端注册的搜索路由。 */
		const SEARCH_API = '/localfiles/api/search';
		/** 候选分组标题（section 行）。 */
		const SECTION = '本机文件';
		const RESULT_LIMIT = 30;

		const inject = ['inputTriggers'];

		/** 取路径最后一段，用作 chip 标签。 */
		function lastSegment(path) {
			const parts = path.split('/');
			return parts[parts.length - 1] || path;
		}

		/** 中间省略的长路径。 */
		function shortenPath(path, max) {
			const limit = max === undefined ? 62 : max;
			if (path.length <= limit) return path;
			const cut = limit - 1;
			return path.slice(0, Math.floor(cut * 0.34)) + '…' + path.slice(-Math.ceil(cut * 0.66));
		}

		/**
		 * 把绝对路径渲染成 @ mention 文本（带空格的路径用 @"…"；目录保留尾斜杠）。
		 * @param path - 正斜杠形式的绝对路径。
		 * @param kind - 'file' | 'directory'。
		 * @returns mention 文本；路径含控制字符或引号时返回 undefined。
		 */
		function mentionOf(path, kind) {
			const clean = kind === 'directory' ? path.replace(/\/+$/, '') : path;
			const withSlash = kind === 'directory' ? clean + '/' : clean;
			if (/[\u0000-\u001f\u007f-\u009f"]/u.test(withSlash)) return undefined;
			if (!/\s/u.test(withSlash)) return '@' + withSlash;
			return kind === 'directory' ? '@"' + withSlash : '@"' + withSlash + '"';
		}

		/** 一行纯提示（不可选，pick 无动作）。 */
		function infoCandidate(name, description) {
			return {
				name,
				...(description === undefined ? {} : { description }),
				section: SECTION,
				value: JSON.stringify({ kind: 'info' }),
			};
		}

		/** 普通模式下的入口行；已输入关键词时把它带进去，点一下即搜。 */
		function entryCandidate(raw) {
			const keyword = raw.trim();
			const id = keyword === '' ? '搜索本机文件…' : '在本机搜索「' + keyword + '」…';
			return {
				name: id,
				description: keyword === ''
					? '全机一次性搜索：选中后输入文件名关键词'
					: '全机一次性搜索（结果不加入文件栏）',
				icon: 'folder',
				section: SECTION,
				value: JSON.stringify({ kind: 'entry', q: raw }),
				drill: true,
			};
		}

		/** 看起来像路径或已带引号的查询不展示入口行，避免干扰常规 @ 路径补全。 */
		function looksLikePath(query) {
			return query.includes('/') || query.includes('\\') || query.includes(':');
		}

		/**
		 * 调 Host 全机搜索。
		 * @param keyword - 关键词。
		 * @param signal - 请求取消信号。
		 * @returns Host 返回的 JSON。
		 */
		async function runSearch(keyword, signal) {
			const res = await fetch(SEARCH_API + '?q=' + encodeURIComponent(keyword) + '&limit=' + RESULT_LIMIT, { signal });
			if (!res.ok) throw new Error('HTTP ' + res.status);
			return await res.json();
		}

		/**
		 * 注册 @ 触发源。
		 * @param ctx - Client 根上下文（需 inputTriggers）。
		 */
		function apply(ctx) {
			const inputTriggers = ctx.get('inputTriggers');

			const source = {
				trigger: '@',
				name: 'local-file-search',
				order: 1,
				showGroupTitle: false,

				async candidates(session, req) {
					const raw = req.query === undefined ? '' : req.query;

					// —— 本机搜索模式：@?关键词 ——
					if (raw.startsWith(MODE_PREFIX)) {
						const keyword = raw.slice(MODE_PREFIX.length).trim();
						if (keyword === '') {
							return [infoCandidate('输入文件名关键词，即在全机范围搜索', '范围：所有本地盘（跳过系统与缓存目录）')];
						}
						let data;
						try {
							data = await runSearch(keyword, req.signal);
						} catch (error) {
							if (req.signal.aborted) return [];
							return [infoCandidate('本机搜索失败', String((error && error.message) || error))];
						}
						if (req.signal.aborted) return [];
						if (data === null || data.ok !== true) {
							return [infoCandidate('本机搜索失败', String((data && data.error) || '未知错误'))];
						}
						const stats = data.stats || {};
						const scope = stats.ms === undefined ? '' : '（' + (stats.ms / 1000).toFixed(1) + 's，扫描 ' + (stats.scanned || 0) + ' 项' + (stats.truncated ? '，已达预算上限' : '') + '）';
						if (!Array.isArray(data.items) || data.items.length === 0) {
							return [infoCandidate('本机未找到匹配「' + keyword + '」', '范围：' + ((stats.roots || []).join(' ') || '所有本地盘') + scope)];
						}
						const rows = [];
						for (const item of data.items) {
							const isDirectory = item.kind === 'directory';
							const mention = mentionOf(item.path, item.kind);
							if (mention === undefined) continue;
							rows.push({
								name: isDirectory ? item.name + '/' : item.name,
								description: shortenPath(item.path),
								icon: isDirectory ? 'folder' : 'file',
								section: SECTION,
								value: JSON.stringify({ kind: 'local', path: item.path, directory: isDirectory, mention }),
							});
						}
						if (rows.length === 0) return [infoCandidate('本机未找到可用匹配「' + keyword + '」', '范围：' + ((stats.roots || []).join(' ') || '所有本地盘') + scope)];
						if (stats.truncated === 'entries' || stats.truncated === 'budget' || stats.truncated === 'matches') {
							rows.push(infoCandidate('本次搜索未覆盖全机', (stats.ms / 1000).toFixed(1) + 's 内扫描 ' + (stats.scanned || 0) + ' 项 —— 换个更精确的关键词可继续深入'));
						}
						return rows;
					}

					// —— 普通模式：只出入口行 ——
					if (looksLikePath(raw)) return [];
					return [entryCandidate(raw)];
				},

				onPick(pick) {
					let value;
					try {
						value = JSON.parse(pick.candidate.value);
					} catch {
						return undefined;
					}
					if (value === null || typeof value !== 'object') return undefined;
					if (value.kind === 'entry') {
						// 把当前 @ token 就地改写成本机模式，菜单保持打开等关键词
						return { text: '@' + MODE_PREFIX + (typeof value.q === 'string' ? value.q : ''), continue: true };
					}
					if (value.kind === 'local' && typeof value.mention === 'string') {
						const isDirectory = value.directory === true;
						const label = lastSegment(value.path) + (isDirectory ? '/' : '');
						return {
							insert: {
								source: 'local-file-search',
								ref: value.mention,
								label,
								appearance: isDirectory ? 'folder' : 'file',
								clipboardText: value.mention,
							},
						};
					}
					return undefined;
				},

				codec: {
					clipboardText: (ref) => ref,
					serialize: (ref) => Promise.resolve(ref),
				},
			};

			ctx.effect(() => inputTriggers.registerSource(source), 'dsh-local-file-search: @ source');
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
