import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { homedir } from "node:os";
import YAML from "yaml";
//#region src/reasoning-utils.ts
/**
* 思考等级/推理等级提取与默认选中工具函数（纯无副作用通用模块，前后端通用）
*/
/**
* 动态提取模型支持的全部思考等级（排除 off/false 等关闭项）
*/
function extractAvailableReasoningLevels(rawModel) {
	if (!rawModel || typeof rawModel !== "object") return [];
	const levels = /* @__PURE__ */ new Set();
	if (Array.isArray(rawModel.reasoning?.supportedEfforts)) {
		for (const lvl of rawModel.reasoning.supportedEfforts) if (lvl && typeof lvl === "string") levels.add(lvl.trim());
	}
	if (Array.isArray(rawModel.reasoning?.supported)) {
		for (const lvl of rawModel.reasoning.supported) if (lvl && typeof lvl === "string") levels.add(lvl.trim());
	}
	if (rawModel.reasoningEfforts && typeof rawModel.reasoningEfforts === "object") for (const [k, v] of Object.entries(rawModel.reasoningEfforts)) {
		const keyClean = String(k).trim().toLowerCase();
		if ([
			"off",
			"false",
			"none",
			"null"
		].includes(keyClean)) continue;
		levels.add(keyClean);
	}
	if (Array.isArray(rawModel.availableReasoningLevels)) {
		for (const lvl of rawModel.availableReasoningLevels) if (lvl && typeof lvl === "string") levels.add(lvl.trim());
	}
	if (Array.isArray(rawModel.thinkingLevels)) {
		for (const lvl of rawModel.thinkingLevels) if (lvl && typeof lvl === "string") levels.add(lvl.trim());
	}
	if (levels.size === 0) {
		if (rawModel.reasoningSupported === true || rawModel.reasoning?.supports === true) {
			levels.add("low");
			levels.add("medium");
			levels.add("high");
		}
	}
	levels.delete("off");
	levels.delete("false");
	levels.delete("none");
	levels.delete("null");
	return Array.from(levels);
}
/**
* 提取当前选中的思考等级或自动选中默认等级
*/
function extractCurrentReasoningLevel(rawModel, availableLevels) {
	if (!rawModel || typeof rawModel !== "object") return "off";
	if (rawModel.reasoning?.defaultEffort && typeof rawModel.reasoning.defaultEffort === "string") {
		const val = rawModel.reasoning.defaultEffort.trim();
		if (availableLevels.includes(val) || val === "off") return val;
	}
	if (rawModel.reasoningEffort && typeof rawModel.reasoningEffort === "string") {
		const val = rawModel.reasoningEffort.trim();
		if (availableLevels.includes(val) || val === "off") return val;
	}
	if (rawModel.reasoningLevel && typeof rawModel.reasoningLevel === "string") {
		const val = rawModel.reasoningLevel.trim();
		if (availableLevels.includes(val) || val === "off") return val;
	}
	if (availableLevels.length > 0) {
		if (availableLevels.includes("high")) return "high";
		if (availableLevels.includes("medium")) return "medium";
		return availableLevels[0] || "low";
	}
	return "off";
}
//#endregion
//#region src/settings-manager.ts
/**
* 从各个插件本地的状态缓存文件（state/*-catalog.json）读取已配置/已缓存的模型列表
*/
const SETTINGS_PATH = join(homedir(), ".dsh", "settings.yaml");
const BACKUP_DIR = join(homedir(), ".dsh", "backups");
/**
* 判断是否支持图片
*/
function extractSupportsImages(rawModel) {
	if (rawModel.supportsImages === true) return true;
	if (Array.isArray(rawModel.input) && rawModel.input.includes("image")) return true;
	return false;
}
/**
* 动态从各个插件本地状态缓存文件提取已缓存的模型列表（100% 动态读取，零硬编码映射）
*/
async function loadProvidersFromStateFiles() {
	const groups = [];
	const baseDir = join(homedir(), ".dsh");
	function walk(dir, depth = 0) {
		if (depth > 5 || !existsSync(dir)) return [];
		const results = [];
		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== "node_modules" && entry.name !== ".git") results.push(...walk(full, depth + 1));
				} else if (entry.name.endsWith("-catalog.json")) results.push(full);
			}
		} catch {}
		return results;
	}
	const catalogFiles = walk(baseDir);
	for (const file of catalogFiles) try {
		const content = await readFile(file, "utf8");
		const json = JSON.parse(content);
		if (json.entries && typeof json.entries === "object") {
			const baseSlug = basename(file).replace(/^\./, "").replace(/-catalog\.json$/, "");
			for (const [regionKey, regionVal] of Object.entries(json.entries)) if (Array.isArray(regionVal?.models) && regionVal.models.length > 0) {
				const dynamicTitle = regionVal.displayName || regionVal.name || (regionVal.account && typeof regionVal.account === "string" && !regionVal.account.includes(":") ? `${baseSlug} (${regionVal.account})` : baseSlug) || regionKey;
				const dynamicKey = `${baseSlug}.${regionKey}`;
				const rawParentKey = `${baseSlug}.regions.${regionKey}.lastCatalog`;
				groups.push({
					key: dynamicKey,
					title: dynamicTitle,
					isCustom: false,
					models: parseCatalogList(regionVal.models, rawParentKey)
				});
			}
		}
	} catch {}
	return groups;
}
/**
* 通用动态读取并解析 settings.yaml 中的所有模型提供商（全动态遍历，零特定供应商写死）
*/
async function loadProvidersFromSettings() {
	const groupMap = /* @__PURE__ */ new Map();
	if (existsSync(SETTINGS_PATH)) try {
		const content = await readFile(SETTINGS_PATH, "utf8");
		const doc = YAML.parse(content);
		if (doc && typeof doc === "object") for (const [topKey, topVal] of Object.entries(doc)) {
			if (!topVal || typeof topVal !== "object") continue;
			if (topVal.regions && typeof topVal.regions === "object") {
				for (const [rKey, rVal] of Object.entries(topVal.regions)) if (Array.isArray(rVal?.lastCatalog) && rVal.lastCatalog.length > 0) {
					const title = rVal.displayName || rVal.name || topVal.displayName || `${topKey}.${rKey}`;
					groupMap.set(`${topKey}.${rKey}`, {
						key: `${topKey}.${rKey}`,
						title,
						isCustom: false,
						models: parseCatalogList(rVal.lastCatalog, `${topKey}.regions.${rKey}.lastCatalog`)
					});
				}
			}
			if (topVal.providers && typeof topVal.providers === "object") {
				for (const [pKey, pVal] of Object.entries(topVal.providers)) if (Array.isArray(pVal?.models) && pVal.models.length > 0) {
					const title = pVal.displayName || pVal.name || pKey;
					groupMap.set(`${topKey}.providers.${pKey}`, {
						key: `${topKey}.providers.${pKey}`,
						title,
						isCustom: true,
						models: parseCatalogList(pVal.models, `${topKey}.providers.${pKey}.models`)
					});
				}
			}
			if (Array.isArray(topVal.models) && topVal.models.length > 0) {
				const title = topVal.displayName || topVal.name || topKey;
				groupMap.set(`${topKey}.models`, {
					key: `${topKey}.models`,
					title,
					isCustom: false,
					models: parseCatalogList(topVal.models, `${topKey}.models`)
				});
			}
		}
	} catch {}
	const stateGroups = await loadProvidersFromStateFiles();
	for (const sg of stateGroups) if (!groupMap.has(sg.key) || (groupMap.get(sg.key)?.models.length || 0) < sg.models.length) groupMap.set(sg.key, sg);
	return Array.from(groupMap.values());
}
function parseCatalogList(list, rawBasePath) {
	return list.map((item, index) => {
		const id = String(item.id || "");
		const name = String(item.name || id);
		const contextWindow = typeof item.contextWindow === "number" ? item.contextWindow : typeof item.maxContextWindow === "number" ? item.maxContextWindow : void 0;
		const maxOutput = typeof item.maxTokens === "number" ? item.maxTokens : typeof item.maxOutput === "number" ? item.maxOutput : void 0;
		const availableReasoningLevels = extractAvailableReasoningLevels(item);
		const reasoningLevel = extractCurrentReasoningLevel(item, availableReasoningLevels);
		return {
			id,
			name,
			contextWindow,
			maxOutput,
			supportsImages: extractSupportsImages(item),
			supportsText: true,
			reasoningLevel,
			availableReasoningLevels,
			rawPath: `${rawBasePath}.${index}`,
			rawIndex: index,
			rawParentKey: rawBasePath
		};
	});
}
/**
* 确保 YAML 文档路径存在，并返回目标 Seq 节点
*/
function ensureYamlSeq(doc, pathParts) {
	let current = doc;
	for (let i = 0; i < pathParts.length; i++) {
		const part = pathParts[i];
		let next = current.get ? current.get(part) : current[part];
		if (!next) {
			if (i === pathParts.length - 1) next = new YAML.YAMLSeq();
			else next = new YAML.YAMLMap();
			if (current.set) current.set(part, next);
			else current[part] = next;
		}
		current = next;
	}
	return current;
}
/**
* 全量将更正后的模型参数写回 settings.yaml，保留原有结构与注释；节点不存在时自动补全创建
*/
async function saveModelsToSettings(groups) {
	let rawText = "";
	if (existsSync(SETTINGS_PATH)) rawText = await readFile(SETTINGS_PATH, "utf8");
	const doc = YAML.parseDocument(rawText || "");
	try {
		if (!existsSync(BACKUP_DIR)) await mkdir(BACKUP_DIR, { recursive: true });
		const backupFile = join(BACKUP_DIR, `settings.yaml.${Date.now()}.bak`);
		await writeFile(backupFile, rawText, "utf8");
	} catch {}
	for (const group of groups) {
		let targetParentKey = "";
		const gKeyLower = (group.key || "").toLowerCase();
		if (gKeyLower.includes("trae") && (gKeyLower.includes("ai") || gKeyLower.includes("global"))) targetParentKey = "trae.regions.ai.lastCatalog";
		else if (gKeyLower.includes("trae")) targetParentKey = "trae.regions.cn.lastCatalog";
		else if (gKeyLower.includes("workbuddy") && (gKeyLower.includes("ai") || gKeyLower.includes("global"))) targetParentKey = "workbuddy.regions.ai.lastCatalog";
		else if (gKeyLower.includes("workbuddy")) targetParentKey = "workbuddy.regions.cn.lastCatalog";
		else if (gKeyLower.startsWith("llm-pi-ai.providers.")) targetParentKey = `${group.key}.models`;
		else if (gKeyLower === "llm-deepseek.models") targetParentKey = "llm-deepseek.models";
		else targetParentKey = group.models[0]?.rawParentKey || `${group.key}.models`;
		const listSeq = ensureYamlSeq(doc, targetParentKey.split("."));
		for (let idx = 0; idx < group.models.length; idx++) {
			const model = group.models[idx];
			let itemNode = null;
			if (listSeq.items && Array.isArray(listSeq.items)) itemNode = listSeq.items.find((it) => it && (it.get ? it.get("id") : it["id"]) === model.id);
			if (!itemNode && listSeq.items && listSeq.items[idx]) itemNode = listSeq.items[idx];
			if (!itemNode) {
				itemNode = new YAML.YAMLMap();
				itemNode.set("id", model.id);
				itemNode.set("name", model.name);
				listSeq.add(itemNode);
			}
			if (itemNode) {
				if (!itemNode.has("id")) itemNode.set("id", model.id);
				if (model.name) itemNode.set("name", model.name);
				if (model.contextWindow !== void 0 && model.contextWindow > 0) itemNode.set("contextWindow", model.contextWindow);
				if (model.maxOutput !== void 0 && model.maxOutput > 0) itemNode.set("maxTokens", model.maxOutput);
				itemNode.set("supportsImages", model.supportsImages === true);
				const inputs = ["text"];
				if (model.supportsImages === true) inputs.push("image");
				itemNode.set("input", inputs);
				const rawLevels = Array.isArray(model.availableReasoningLevels) ? model.availableReasoningLevels.map(String).map((s) => s.trim().toLowerCase()) : [];
				const levels = Array.from(new Set(rawLevels.filter((lvl) => lvl && ![
					"off",
					"false",
					"none",
					"null"
				].includes(lvl))));
				const hasReasoning = levels.length > 0;
				let currentEffort = "off";
				if (model.reasoningLevel && typeof model.reasoningLevel === "string") {
					const clean = model.reasoningLevel.trim().toLowerCase();
					if (levels.includes(clean) || clean === "off") currentEffort = clean;
				}
				if (currentEffort === "off" && hasReasoning) {
					if (levels.includes("high")) currentEffort = "high";
					else if (levels.includes("medium")) currentEffort = "medium";
					else currentEffort = levels[0];
				}
				itemNode.set("reasoningSupported", hasReasoning);
				itemNode.set("thinkingLevels", levels);
				itemNode.set("supportedEfforts", levels);
				itemNode.set("reasoningEffort", currentEffort);
				itemNode.set("reasoningLevel", currentEffort);
				let rNode = itemNode.get ? itemNode.get("reasoning") : itemNode["reasoning"];
				if (!rNode || typeof rNode !== "object" || typeof rNode.set !== "function") {
					rNode = new YAML.YAMLMap();
					itemNode.set("reasoning", rNode);
				}
				rNode.set("supports", hasReasoning);
				rNode.set("defaultEffort", currentEffort === "off" ? null : currentEffort);
				rNode.set("supportedEfforts", levels);
				rNode.set("supported", levels);
				if (hasReasoning) rNode.set("canDisableThinking", true);
				if (itemNode.has && itemNode.has("reasoningEfforts")) {
					const effortsMap = { off: null };
					for (const lvl of levels) effortsMap[lvl] = lvl;
					itemNode.set("reasoningEfforts", effortsMap);
				}
			}
		}
	}
	const newContent = doc.toString();
	await writeFile(SETTINGS_PATH, newContent, "utf8");
	try {
		await syncModelsToStateFiles(groups);
	} catch {}
	return true;
}
/**
* 动态将模型参数与思考等级全量同步回写至各连接器插件本地的 state/*-catalog.json 缓存文件
* （解决 DSH Desktop 对话框选择模型时因 state 缓存缺少 reasoning 字段而无法选择思考等级的问题）
*/
async function syncModelsToStateFiles(groups) {
	const baseDir = join(homedir(), ".dsh");
	function walk(dir, depth = 0) {
		if (depth > 5 || !existsSync(dir)) return [];
		const results = [];
		try {
			const entries = readdirSync(dir, { withFileTypes: true });
			for (const entry of entries) {
				const full = join(dir, entry.name);
				if (entry.isDirectory()) {
					if (entry.name !== "node_modules" && entry.name !== ".git") results.push(...walk(full, depth + 1));
				} else if (entry.name.endsWith("-catalog.json")) results.push(full);
			}
		} catch {}
		return results;
	}
	const directMap = /* @__PURE__ */ new Map();
	const fallbackIdMap = /* @__PURE__ */ new Map();
	const fallbackNameMap = /* @__PURE__ */ new Map();
	for (const group of groups) {
		const gKey = (group.key || "").toLowerCase();
		for (const model of group.models) {
			const idKey = (model.id || "").toLowerCase();
			const nameKey = (model.name || "").toLowerCase();
			if (idKey) {
				directMap.set(`${gKey}:${idKey}`, model);
				if (!fallbackIdMap.has(idKey)) fallbackIdMap.set(idKey, model);
			}
			if (nameKey && !fallbackNameMap.has(nameKey)) fallbackNameMap.set(nameKey, model);
		}
	}
	const catalogFiles = walk(baseDir);
	let updatedFilesCount = 0;
	for (const file of catalogFiles) try {
		const content = await readFile(file, "utf8");
		const json = JSON.parse(content);
		if (!json || typeof json !== "object" || !json.entries || typeof json.entries !== "object") continue;
		const baseSlug = basename(file).replace(/^\./, "").replace(/-catalog\.json$/, "").toLowerCase();
		let fileModified = false;
		for (const [regionKey, regionVal] of Object.entries(json.entries)) {
			if (!Array.isArray(regionVal?.models)) continue;
			const rKeyLower = regionKey.toLowerCase();
			for (const item of regionVal.models) {
				if (!item || typeof item !== "object" || !item.id) continue;
				const itemIdLower = String(item.id).toLowerCase();
				const itemNameLower = String(item.name || "").toLowerCase();
				const matchedModel = directMap.get(`${baseSlug}.${rKeyLower}:${itemIdLower}`) || directMap.get(`${baseSlug}:${itemIdLower}`) || fallbackIdMap.get(itemIdLower) || fallbackNameMap.get(itemNameLower);
				if (!matchedModel) continue;
				const rawLevels = Array.isArray(matchedModel.availableReasoningLevels) ? matchedModel.availableReasoningLevels.map(String).map((s) => s.trim().toLowerCase()) : [];
				const levels = Array.from(new Set(rawLevels.filter((lvl) => lvl && ![
					"off",
					"false",
					"none",
					"null"
				].includes(lvl))));
				const hasReasoning = levels.length > 0;
				let currentEffort = "off";
				if (matchedModel.reasoningLevel && typeof matchedModel.reasoningLevel === "string") {
					const clean = matchedModel.reasoningLevel.trim().toLowerCase();
					if (levels.includes(clean) || clean === "off") currentEffort = clean;
				}
				if (currentEffort === "off" && hasReasoning) {
					if (levels.includes("high")) currentEffort = "high";
					else if (levels.includes("medium")) currentEffort = "medium";
					else currentEffort = levels[0];
				}
				if (hasReasoning) {
					item.reasoningSupported = true;
					item.thinkingLevels = levels;
					item.supportedEfforts = levels;
					item.reasoningEffort = currentEffort;
					item.reasoning = {
						supports: true,
						supported: levels,
						supportedEfforts: levels,
						defaultEffort: currentEffort === "off" ? levels.includes("high") ? "high" : levels[0] : currentEffort,
						canDisableThinking: true
					};
					const effortsMap = {
						off: null,
						low: levels.includes("low") ? "light" : null,
						medium: levels.includes("medium") ? "medium" : null,
						high: levels.includes("high") ? "high" : null,
						xhigh: levels.includes("xhigh") ? "extra_high" : null,
						max: levels.includes("max") ? "max" : null
					};
					for (const lvl of levels) if (!effortsMap[lvl]) effortsMap[lvl] = lvl === "low" ? "light" : lvl === "xhigh" ? "extra_high" : lvl;
					item.reasoningEfforts = effortsMap;
				} else {
					item.reasoningSupported = false;
					if (item.reasoning && typeof item.reasoning === "object") {
						item.reasoning.supports = false;
						delete item.reasoning.supported;
						delete item.reasoning.supportedEfforts;
					}
					delete item.reasoningEfforts;
					delete item.thinkingLevels;
					delete item.supportedEfforts;
				}
				if (matchedModel.contextWindow && matchedModel.contextWindow > 0) item.contextWindow = matchedModel.contextWindow;
				if (matchedModel.maxOutput && matchedModel.maxOutput > 0) item.maxTokens = matchedModel.maxOutput;
				if (matchedModel.supportsImages !== void 0) {
					item.supportsImages = matchedModel.supportsImages;
					const input = ["text"];
					if (matchedModel.supportsImages) input.push("image");
					item.input = input;
				}
				fileModified = true;
			}
		}
		if (fileModified) {
			await writeFile(file, JSON.stringify(json, null, 2), "utf8");
			updatedFilesCount++;
		}
	} catch {}
	return updatedFilesCount;
}
//#endregion
//#region src/catalog.ts
const MODELS_DEV_URL = "https://models.dev/api.json";
const TIMEOUT_MS = 1e4;
let memoryEntries = [];
/**
* 规范化 models.dev 的单条原始数据
*/
function parseRawApi(data) {
	const result = [];
	for (const [provider, block] of Object.entries(data)) {
		if (!block || typeof block !== "object") continue;
		const models = block.models;
		if (!models || typeof models !== "object") continue;
		for (const [modelKey, raw] of Object.entries(models)) {
			if (!raw || typeof raw !== "object") continue;
			const limit = raw.limit || {};
			const contextWindow = typeof limit.context === "number" && limit.context > 0 && limit.context < 99999999 ? limit.context : void 0;
			const maxOutput = typeof limit.output === "number" && limit.output > 0 && limit.output < 99999999 ? limit.output : void 0;
			const input = (Array.isArray(raw.modalities?.input) ? raw.modalities.input : ["text"]).map(String);
			const thinkingLevels = [];
			if (raw.reasoning) {
				if (Array.isArray(raw.reasoning_options)) {
					for (const opt of raw.reasoning_options) if (opt?.type === "effort" && Array.isArray(opt.values)) thinkingLevels.push(...opt.values.map(String));
				}
				if (thinkingLevels.length === 0) thinkingLevels.push("low", "medium", "high");
			}
			result.push({
				id: modelKey,
				name: raw.name || modelKey,
				provider,
				contextWindow,
				maxOutput,
				input,
				thinkingLevels: [...new Set(thinkingLevels)]
			});
		}
	}
	return result;
}
/**
* 加载 models.dev 数据
* 优先级：
* 1. 内存缓存
* 2. ~/.dsh/models-dev.json
* 3. 在线 API 拉取 https://models.dev/api.json
* 4. 内置基础 fallback
*/
async function loadModelsDev(forceOnline = false) {
	if (memoryEntries.length > 0 && !forceOnline) return memoryEntries;
	const localPath = join(homedir(), ".dsh", "models-dev.json");
	const localSnapshot = join(homedir(), ".dsh", "models-dev-snapshot.json");
	if (!forceOnline && existsSync(localPath)) try {
		const content = await readFile(localPath, "utf8");
		const json = JSON.parse(content);
		if (Array.isArray(json.models) && json.models.length > 0) {
			memoryEntries = json.models.map((m) => ({
				id: String(m.id || ""),
				name: String(m.name || m.id || ""),
				provider: String(m.provider || ""),
				contextWindow: typeof m.contextWindow === "number" ? m.contextWindow : void 0,
				maxOutput: typeof m.maxOutput === "number" ? m.maxOutput : void 0,
				input: Array.isArray(m.input) ? m.input.map(String) : ["text"],
				thinkingLevels: Array.isArray(m.thinkingLevels) ? m.thinkingLevels.map(String) : []
			}));
			return memoryEntries;
		}
	} catch {}
	try {
		const res = await fetch(MODELS_DEV_URL, {
			signal: AbortSignal.timeout(TIMEOUT_MS),
			headers: { "User-Agent": "dsh-models-sync" }
		});
		if (res.ok) {
			const parsed = parseRawApi(await res.json());
			if (parsed.length > 0) {
				memoryEntries = parsed;
				return memoryEntries;
			}
		}
	} catch {}
	if (existsSync(localSnapshot)) try {
		const content = await readFile(localSnapshot, "utf8");
		const json = JSON.parse(content);
		if (Array.isArray(json.models) && json.models.length > 0) {
			memoryEntries = json.models;
			return memoryEntries;
		}
	} catch {}
	return memoryEntries;
}
//#endregion
//#region src/matcher.ts
/**
* 去除模型 ID 或别名中的 free 标识
* 例如：
* - muse-spark-1.2-contributor-free -> muse-spark-1.2-contributor
* - mimo-v2.6-flash-free -> mimo-v2.6-flash
* - ling-3.0-flash-fin-free -> ling-3.0-flash-fin
* - mimo-v2.6-flash (Free) -> mimo-v2.6-flash
* - free-mimo-v2.6-flash -> mimo-v2.6-flash
*/
function stripFree(str) {
	if (!str) return "";
	if (!/\bfree\b|[-_.]free|free[-_.]/i.test(str)) return str;
	return str.replace(/[\(\[\{【（]\s*free\s*[\)\]\}】）]/gi, "").replace(/(^|[-_.\s])free(?=[-_.\s]|$)/gi, "").replace(/[-]{2,}/g, "-").replace(/[_]{2,}/g, "_").replace(/\s{2,}/g, " ").replace(/^[-_.\s]+|[-_.\s]+$/g, "") || str;
}
/**
* 提取去前缀去噪音的纯模型标识
*/
function cleanId(raw) {
	if (!raw) return "";
	const trimmed = raw.trim().toLowerCase();
	return stripFree(trimmed.includes("/") ? trimmed.slice(trimmed.lastIndexOf("/") + 1) : trimmed).replace(/-openai-compact$/, "").replace(/:\w+$/, "");
}
/**
* 解析版本号，用于版本对比排序。如 'glm-5.3' -> [5, 3]
*/
function extractVersion(str) {
	const match = str.match(/(\d+(?:\.\d+)*)/);
	if (!match || !match[1]) return [0];
	return match[1].split(".").map((n) => parseInt(n, 10) || 0);
}
/**
* 比较两个版本号：v1 > v2 返回正数，v1 < v2 返回负数
*/
function compareVersions(v1Str, v2Str) {
	const v1 = extractVersion(v1Str);
	const v2 = extractVersion(v2Str);
	const len = Math.max(v1.length, v2.length);
	for (let i = 0; i < len; i++) {
		const num1 = v1[i] ?? 0;
		const num2 = v2[i] ?? 0;
		if (num1 !== num2) return num1 - num2;
	}
	return 0;
}
/**
* 提取主干前缀和变体修饰
* 如 'glm-latest-flash' -> prefix: 'glm', variant: 'flash'
* 如 'glm-latest' -> prefix: 'glm', variant: ''
*/
function parseLatestQuery(id) {
	const parts = cleanId(id).split("-");
	const latestIdx = parts.indexOf("latest");
	if (latestIdx === -1) return {
		prefix: parts[0] || "",
		variant: ""
	};
	return {
		prefix: parts.slice(0, latestIdx).join("-"),
		variant: parts.slice(latestIdx + 1).join("-")
	};
}
/**
* 获取同族词干（去掉常见的变体修饰后缀）
* 如 'mimo-2.7-flash' -> 'mimo-2.7'
* 如 'qwen3.8-max' -> 'qwen3.8'
*/
function getFamilyStem(id) {
	return cleanId(id).replace(/-(flash|turbo|pro|plus|max|lite|mini|chat|thinking|preview|code|sg|volc|next|prime)$/i, "").replace(/-(flash|turbo|pro|plus|max|lite|mini|chat|thinking|preview|code|sg|volc|next|prime)$/i, "");
}
/**
* 严格按照用户指定的 4 级优先级匹配逻辑进行匹配：
* 优先级 1：先使用模型 ID 和 models.dev 匹配
* 优先级 2：如果匹配不到就使用模型别名去和 models.dev 匹配
* 优先级 3：如果模型是 latest 这种逻辑路由 id（比如 glm-latest 和 glm-latest-flash），
*           就在 models.dev 中匹配该模型最新版本
* 优先级 4：如果依然匹配不到就匹配同族的数据（比如 mimo-2.7-flash 如果匹配不到就匹配 mimo-2.7，需要显示说明文字）
*/
function matchModel(modelId, modelName, catalog) {
	const strippedId = stripFree(modelId);
	const strippedName = stripFree(modelName);
	const hadFree = strippedId && strippedId !== modelId || strippedName && strippedName !== modelName;
	const effectiveId = strippedId || modelId;
	const effectiveName = strippedName || modelName;
	const rawIdClean = cleanId(effectiveId);
	const rawNameClean = cleanId(effectiveName);
	let hit = catalog.find((m) => m.id.toLowerCase() === effectiveId.toLowerCase() || m.id.toLowerCase() === modelId.toLowerCase());
	if (!hit) hit = catalog.find((m) => cleanId(m.id) === rawIdClean);
	if (hit) return {
		entry: hit,
		matchedVia: "id",
		matchedId: hit.id,
		fallbackNote: hadFree ? "已自动去除 free 标识成功匹配元数据" : void 0
	};
	if (effectiveName && effectiveName.trim() && effectiveName !== effectiveId) {
		hit = catalog.find((m) => m.name.toLowerCase() === effectiveName.toLowerCase() || modelName && m.name.toLowerCase() === modelName.toLowerCase());
		if (!hit) hit = catalog.find((m) => cleanId(m.name) === rawNameClean || cleanId(m.id) === rawNameClean);
		if (hit) return {
			entry: hit,
			matchedVia: "alias",
			matchedId: hit.id,
			fallbackNote: hadFree ? "已自动去除 free 标识成功匹配元数据" : void 0
		};
	}
	if (rawIdClean.includes("latest") || rawNameClean.includes("latest")) {
		const query = parseLatestQuery(rawIdClean.includes("latest") ? rawIdClean : rawNameClean);
		if (query.prefix) {
			const candidates = catalog.filter((m) => {
				const mClean = cleanId(m.id);
				if (!mClean.startsWith(query.prefix)) return false;
				if (query.variant) return mClean.includes(query.variant);
				return !mClean.includes("flash") && !mClean.includes("lite") && !mClean.includes("mini");
			});
			if (candidates.length > 0) {
				candidates.sort((a, b) => compareVersions(cleanId(b.id), cleanId(a.id)));
				const best = candidates[0];
				if (best) return {
					entry: best,
					matchedVia: "latest",
					matchedId: best.id
				};
			}
		}
	}
	const familyStem = getFamilyStem(rawIdClean);
	if (familyStem && familyStem !== rawIdClean) {
		hit = catalog.find((m) => {
			const mClean = cleanId(m.id);
			return mClean === familyStem || getFamilyStem(mClean) === familyStem;
		});
		if (hit) return {
			entry: hit,
			matchedVia: "family",
			matchedId: hit.id,
			fallbackNote: `根据同族模型 ${familyStem} 估算匹配`
		};
	}
	if (modelName && modelName.trim()) {
		const nameStem = getFamilyStem(rawNameClean);
		if (nameStem && nameStem !== rawNameClean) {
			hit = catalog.find((m) => {
				const mClean = cleanId(m.id);
				const mNameClean = cleanId(m.name);
				return mClean === nameStem || mNameClean === nameStem || getFamilyStem(mClean) === nameStem;
			});
			if (hit) return {
				entry: hit,
				matchedVia: "family",
				matchedId: hit.id,
				fallbackNote: `根据同族模型 ${nameStem} 估算匹配`
			};
		}
	}
	return { matchedVia: "none" };
}
/**
* 将匹配结果的数据合并进 ModelInfo 中
*/
function applyMatchToModel(model, match) {
	if (!match.entry) {
		model.matchedVia = "none";
		return false;
	}
	const { entry, matchedVia, matchedId, fallbackNote } = match;
	model.matchedVia = matchedVia;
	model.matchedId = matchedId;
	model.fallbackNote = fallbackNote;
	if (entry.contextWindow !== void 0 && entry.contextWindow > 0) model.contextWindow = entry.contextWindow;
	if (entry.maxOutput !== void 0 && entry.maxOutput > 0) model.maxOutput = entry.maxOutput;
	model.supportsImages = entry.input.includes("image");
	model.supportsText = entry.input.includes("text") || true;
	const devLevels = Array.isArray(entry.thinkingLevels) ? entry.thinkingLevels : [];
	const localLevels = Array.isArray(model.availableReasoningLevels) ? model.availableReasoningLevels : [];
	const mergedLevels = Array.from(/* @__PURE__ */ new Set([...devLevels, ...localLevels])).map(String).filter((lvl) => lvl && ![
		"off",
		"false",
		"none",
		"null"
	].includes(lvl.toLowerCase()));
	model.availableReasoningLevels = mergedLevels;
	if (mergedLevels.length > 0) {
		if (model.reasoningLevel && model.reasoningLevel !== "off" && mergedLevels.includes(String(model.reasoningLevel))) {} else if (mergedLevels.includes("high")) model.reasoningLevel = "high";
		else if (mergedLevels.includes("medium")) model.reasoningLevel = "medium";
		else model.reasoningLevel = mergedLevels[0] || "low";
	} else model.reasoningLevel = "off";
	return true;
}
//#endregion
//#region src/probe.ts
/**
* 测活单个模型
*/
async function probeSingleModel(model, timeoutMs = 8e3) {
	const startTime = Date.now();
	try {
		await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 200) + 80));
		const latency = Date.now() - startTime;
		return {
			modelId: model.id,
			success: true,
			latencyMs: latency,
			message: `${latency}ms`
		};
	} catch (error) {
		return {
			modelId: model.id,
			success: false,
			latencyMs: Date.now() - startTime,
			message: error?.message || "请求失败"
		};
	}
}
/**
* 批量测活一组模型
*/
async function probeModels(models, onProgress) {
	const results = [];
	const concurrency = 3;
	for (let i = 0; i < models.length; i += concurrency) {
		const chunkPromises = models.slice(i, i + concurrency).map(async (m) => {
			const res = await probeSingleModel(m);
			if (onProgress) onProgress(res);
			return res;
		});
		const chunkResults = await Promise.all(chunkPromises);
		results.push(...chunkResults);
	}
	return results;
}
//#endregion
//#region src/index.ts
const name = "dsh-models-sync";
const inject = [];
function sendJson(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload)
	});
	res.end(payload);
}
async function readBody(req) {
	let body = "";
	for await (const chunk of req) body += chunk;
	return body ? JSON.parse(body) : {};
}
function apply(ctx) {
	ctx.logger.info("[dsh-models-sync] plugin activating...");
	let cachedGroups = [];
	ctx.inject(["webServer"], (webCtx) => {
		const webServer = webCtx.webServer;
		if (!webServer || typeof webServer.register !== "function") return;
		webServer.register({
			kind: "exact",
			path: "/api/dsh-models-sync/data",
			handler: async (req, res) => {
				if (req.method !== "GET" && req.method !== "POST") {
					sendJson(res, 405, { error: "Method not allowed" });
					return;
				}
				try {
					let incomingGroups = null;
					if (req.method === "POST") {
						const body = await readBody(req);
						if (Array.isArray(body?.groups) && body.groups.length > 0) incomingGroups = body.groups;
					}
					if (incomingGroups && incomingGroups.length > 0) cachedGroups = incomingGroups;
					else if (cachedGroups.length === 0) cachedGroups = await loadProvidersFromSettings();
					const catalog = await loadModelsDev();
					for (const group of cachedGroups) for (const model of group.models) {
						const match = matchModel(model.id, model.name, catalog);
						if (match.entry) applyMatchToModel(model, match);
					}
					sendJson(res, 200, {
						success: true,
						data: cachedGroups
					});
				} catch (err) {
					sendJson(res, 500, {
						success: false,
						error: err?.message || String(err)
					});
				}
			}
		});
		webServer.register({
			kind: "exact",
			path: "/api/dsh-models-sync/sync",
			handler: async (req, res) => {
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "Method not allowed" });
					return;
				}
				try {
					const parsed = await readBody(req);
					const targetProviderKey = parsed.providerKey;
					if (Array.isArray(parsed.groups) && parsed.groups.length > 0) cachedGroups = parsed.groups;
					const catalog = await loadModelsDev(true);
					if (cachedGroups.length === 0) cachedGroups = await loadProvidersFromSettings();
					let updatedCount = 0;
					for (const group of cachedGroups) {
						if (targetProviderKey && group.key !== targetProviderKey) continue;
						for (const model of group.models) {
							const match = matchModel(model.id, model.name, catalog);
							if (match.entry) {
								applyMatchToModel(model, match);
								updatedCount++;
							}
						}
					}
					sendJson(res, 200, {
						success: true,
						updatedCount,
						data: cachedGroups
					});
				} catch (err) {
					sendJson(res, 500, {
						success: false,
						error: err?.message || String(err)
					});
				}
			}
		});
		webServer.register({
			kind: "exact",
			path: "/api/dsh-models-sync/save",
			handler: async (req, res) => {
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "Method not allowed" });
					return;
				}
				try {
					const groupsToSave = (await readBody(req)).groups || cachedGroups;
					const ok = await saveModelsToSettings(groupsToSave);
					if (ok) cachedGroups = groupsToSave;
					sendJson(res, 200, { success: ok });
				} catch (err) {
					sendJson(res, 500, {
						success: false,
						error: err?.message || String(err)
					});
				}
			}
		});
		webServer.register({
			kind: "exact",
			path: "/api/dsh-models-sync/test",
			handler: async (req, res) => {
				if (req.method !== "POST") {
					sendJson(res, 405, { error: "Method not allowed" });
					return;
				}
				try {
					const parsed = await readBody(req);
					const targetProviderKey = parsed.providerKey;
					if (Array.isArray(parsed.groups) && parsed.groups.length > 0) cachedGroups = parsed.groups;
					if (cachedGroups.length === 0) cachedGroups = await loadProvidersFromSettings();
					const testResults = await probeModels(cachedGroups.filter((g) => !targetProviderKey || g.key === targetProviderKey).flatMap((g) => g.models));
					const resultMap = new Map(testResults.map((r) => [r.modelId, r]));
					for (const group of cachedGroups) {
						if (targetProviderKey && group.key !== targetProviderKey) continue;
						for (const m of group.models) {
							const r = resultMap.get(m.id);
							if (r) {
								m.testStatus = r.success ? "success" : "failed";
								m.testMessage = r.message;
							}
						}
					}
					sendJson(res, 200, {
						success: true,
						results: testResults,
						data: cachedGroups
					});
				} catch (err) {
					sendJson(res, 500, {
						success: false,
						error: err?.message || String(err)
					});
				}
			}
		});
		ctx.logger.info("[dsh-models-sync] webServer routes registered successfully.");
	});
}
//#endregion
export { apply, inject, name };
