window.__ModuleLoader__.load({
	id: "dsh-models-sync",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule || !__hasOwnProp.call(mod, "default") ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		let react_jsx_runtime = require("react/jsx-runtime");
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
				const val = rawModel.reasoning.defaultEffort.trim().toLowerCase();
				if (availableLevels.includes(val) || val === "off") return val;
			}
			if (rawModel.reasoningEffort && typeof rawModel.reasoningEffort === "string") {
				const val = rawModel.reasoningEffort.trim().toLowerCase();
				if (availableLevels.includes(val) || val === "off") return val;
			}
			if (rawModel.reasoningLevel && typeof rawModel.reasoningLevel === "string") {
				const val = rawModel.reasoningLevel.trim().toLowerCase();
				if (availableLevels.includes(val) || val === "off") return val;
			}
			if (availableLevels.length > 0) {
				if (availableLevels.includes("medium")) return "medium";
				if (availableLevels.includes("low")) return "low";
				return availableLevels[0] || "off";
			}
			return "off";
		}
		//#endregion
		//#region src/client/ModelsSyncCard.tsx
		/**
		* 等级英文标签到中文的友好映射
		*/
		const LEVEL_LABEL_MAP = {
			off: "关",
			minimal: "极低",
			low: "低",
			medium: "中",
			high: "高",
			xhigh: "极高",
			max: "最大"
		};
		/**
		* 安全获取桌面端运行时全量模型目录（优先通过原生 modelDirectories 服务或 RPC）
		*/
		async function fetchRuntimeModelCatalog(ctx) {
			if (!ctx) return null;
			try {
				const modelsService = typeof ctx.get === "function" ? ctx.get("modelDirectories") : ctx.modelDirectories;
				if (modelsService && typeof modelsService.directoryFor === "function") {
					const sessionsService = typeof ctx.get === "function" ? ctx.get("sessions") : ctx.sessions;
					let sessionId = "";
					try {
						const sSnap = sessionsService?.list?.getSnapshot?.();
						if (sSnap?.current) sessionId = sSnap.current;
						else if (sSnap?.byId) {
							const keys = Object.keys(sSnap.byId);
							if (keys.length > 0) sessionId = keys[0];
						}
					} catch {}
					const dir = modelsService.directoryFor(sessionId);
					if (dir) {
						try {
							if (typeof dir.load === "function") await dir.load();
						} catch {}
						const snap = (typeof dir.store?.getSnapshot === "function" ? dir.store.getSnapshot() : null) || (typeof dir.getSnapshot === "function" ? dir.getSnapshot() : null);
						if (snap && Array.isArray(snap.groups) && snap.groups.length > 0) return { groups: snap.groups };
					}
				}
			} catch {}
			try {
				if (typeof ctx.get === "function") {
					const rs = ctx.get("remote.session");
					if (rs && typeof rs.modelCatalog === "function") {
						const cat = await rs.modelCatalog();
						if (cat?.groups?.length) return cat;
					}
				}
			} catch {}
			try {
				if (typeof ctx.get === "function") {
					const r = ctx.get("remote");
					if (r?.session && typeof r.session.modelCatalog === "function") {
						const cat = await r.session.modelCatalog();
						if (cat?.groups?.length) return cat;
					}
				}
			} catch {}
			try {
				if (typeof ctx.get === "function") {
					const s = ctx.get("session");
					if (s && typeof s.modelCatalog === "function") {
						const cat = await s.modelCatalog();
						if (cat?.groups?.length) return cat;
					}
				}
			} catch {}
			try {
				if (ctx.remote?.session && typeof ctx.remote.session.modelCatalog === "function") {
					const cat = await ctx.remote.session.modelCatalog();
					if (cat?.groups?.length) return cat;
				}
			} catch {}
			return null;
		}
		const ModelsSyncCard = ({ as = "div", ctx }) => {
			const Component = as;
			const [groups, setGroups] = (0, react.useState)([]);
			const [loading, setLoading] = (0, react.useState)(false);
			const [syncingAll, setSyncingAll] = (0, react.useState)(false);
			const [testingAll, setTestingAll] = (0, react.useState)(false);
			const [saving, setSaving] = (0, react.useState)(false);
			const [syncingProviders, setSyncingProviders] = (0, react.useState)({});
			const [testingProviders, setTestingProviders] = (0, react.useState)({});
			const [expandedMap, setExpandedMap] = (0, react.useState)({});
			const [toast, setToast] = (0, react.useState)(null);
			const showToast = (message, type = "info") => {
				setToast({
					message,
					type
				});
				setTimeout(() => setToast(null), 3e3);
			};
			const fetchData = (0, react.useCallback)(async () => {
				setLoading(true);
				try {
					let initialGroups = [];
					try {
						const catalog = await fetchRuntimeModelCatalog(ctx);
						if (catalog && Array.isArray(catalog.groups) && catalog.groups.length > 0) initialGroups = catalog.groups.map((cg) => {
							const models = (Array.isArray(cg.models) ? cg.models : []).map((m, idx) => {
								const availableLevels = extractAvailableReasoningLevels(m);
								const currentLevel = extractCurrentReasoningLevel(m, availableLevels);
								return {
									id: m.id,
									name: m.name || m.id,
									contextWindow: m.contextWindow || m.limit?.context || void 0,
									maxOutput: m.maxTokens || m.limit?.output || void 0,
									supportsImages: m.supportsImages === true || Array.isArray(m.input) && m.input.includes("image"),
									supportsText: true,
									reasoningLevel: currentLevel,
									availableReasoningLevels: availableLevels,
									rawPath: `${cg.id}.models.${idx}`,
									rawIndex: idx,
									rawParentKey: `${cg.id}.models`
								};
							});
							return {
								key: cg.id,
								title: cg.name || cg.id,
								isCustom: false,
								models
							};
						});
					} catch (err) {
						console.warn("[dsh-models-sync] 获取运行时 modelCatalog 异常:", err);
					}
					const json = await (await fetch("/api/dsh-models-sync/data", {
						method: initialGroups.length > 0 ? "POST" : "GET",
						headers: { "Content-Type": "application/json" },
						body: initialGroups.length > 0 ? JSON.stringify({ groups: initialGroups }) : void 0
					})).json();
					if (json.success && Array.isArray(json.data) && json.data.length > 0) setGroups(json.data);
					else if (initialGroups.length > 0) setGroups(initialGroups);
					else showToast(json.error || "未检测到模型提供商配置", "error");
				} catch (e) {
					showToast("获取模型配置失败: " + e?.message, "error");
				} finally {
					setLoading(false);
				}
			}, [ctx]);
			(0, react.useEffect)(() => {
				fetchData();
			}, [fetchData]);
			const toggleExpand = (providerKey) => {
				setExpandedMap((prev) => ({
					...prev,
					[providerKey]: !prev[providerKey]
				}));
			};
			const handleSyncAll = async () => {
				setSyncingAll(true);
				try {
					const json = await (await fetch("/api/dsh-models-sync/sync", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ groups })
					})).json();
					if (json.success && Array.isArray(json.data)) {
						setGroups(json.data);
						showToast(`已成功同步 ${json.updatedCount || 0} 个模型的参数！`, "success");
					} else showToast(json.error || "同步失败", "error");
				} catch (e) {
					showToast("同步请求失败: " + e?.message, "error");
				} finally {
					setSyncingAll(false);
				}
			};
			const handleSyncProvider = async (providerKey, e) => {
				e.stopPropagation();
				setSyncingProviders((prev) => ({
					...prev,
					[providerKey]: true
				}));
				try {
					const json = await (await fetch("/api/dsh-models-sync/sync", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							groups,
							providerKey
						})
					})).json();
					if (json.success && Array.isArray(json.data)) {
						setGroups(json.data);
						showToast(`供应商模型参数已成功同步！`, "success");
					} else showToast(json.error || "同步失败", "error");
				} catch (e) {
					showToast("同步失败: " + e?.message, "error");
				} finally {
					setSyncingProviders((prev) => ({
						...prev,
						[providerKey]: false
					}));
				}
			};
			const handleSaveAll = async () => {
				setSaving(true);
				try {
					const json = await (await fetch("/api/dsh-models-sync/save", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ groups })
					})).json();
					if (json.success) showToast("已全量保存并写回 .dsh/settings.yaml！", "success");
					else showToast(json.error || "保存失败", "error");
				} catch (e) {
					showToast("保存失败: " + e?.message, "error");
				} finally {
					setSaving(false);
				}
			};
			const handleTestAll = async () => {
				setTestingAll(true);
				try {
					const json = await (await fetch("/api/dsh-models-sync/test", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ groups })
					})).json();
					if (json.success && Array.isArray(json.data)) {
						setGroups(json.data);
						showToast("全部模型可用性检测已完成！", "success");
					} else showToast(json.error || "测试失败", "error");
				} catch (e) {
					showToast("测试请求异常: " + e?.message, "error");
				} finally {
					setTestingAll(false);
				}
			};
			const handleTestProvider = async (providerKey, e) => {
				e.stopPropagation();
				setTestingProviders((prev) => ({
					...prev,
					[providerKey]: true
				}));
				try {
					const json = await (await fetch("/api/dsh-models-sync/test", {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({
							groups,
							providerKey
						})
					})).json();
					if (json.success && Array.isArray(json.data)) {
						setGroups(json.data);
						showToast("该供应商模型检测完成！", "success");
					} else showToast(json.error || "测试失败", "error");
				} catch (e) {
					showToast("测试失败: " + e?.message, "error");
				} finally {
					setTestingProviders((prev) => ({
						...prev,
						[providerKey]: false
					}));
				}
			};
			const updateModelField = (providerKey, modelId, updates) => {
				setGroups((prev) => prev.map((g) => {
					if (g.key !== providerKey) return g;
					return {
						...g,
						models: g.models.map((m) => m.id === modelId ? {
							...m,
							...updates
						} : m)
					};
				}));
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(Component, {
				style: styles.container,
				children: [
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.header,
						children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.titleContainer,
							children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.headerTitle,
								children: "模型参数填充"
							}), loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
								style: styles.loadingTag,
								children: "加载中..."
							})]
						}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							style: styles.buttonGroup,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: {
										...styles.btn,
										...testingAll ? styles.btnDisabled : {}
									},
									onClick: handleTestAll,
									disabled: testingAll || loading,
									children: testingAll ? "测试中..." : "测试全部"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: {
										...styles.btn,
										...syncingAll ? styles.btnDisabled : {}
									},
									onClick: handleSyncAll,
									disabled: syncingAll || loading,
									children: syncingAll ? "同步中..." : "同步全部"
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									style: {
										...styles.btn,
										...styles.btnPrimary,
										...saving ? styles.btnDisabled : {}
									},
									onClick: handleSaveAll,
									disabled: saving || loading,
									children: saving ? "保存中..." : "保存全部"
								})
							]
						})]
					}),
					toast && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
						style: {
							...styles.toast,
							backgroundColor: toast.type === "success" ? "rgba(34, 197, 94, 0.12)" : toast.type === "error" ? "rgba(239, 68, 68, 0.12)" : "rgba(59, 130, 246, 0.12)",
							borderColor: toast.type === "success" ? "rgba(34, 197, 94, 0.4)" : toast.type === "error" ? "rgba(239, 68, 68, 0.4)" : "rgba(59, 130, 246, 0.4)",
							color: toast.type === "success" ? "#22c55e" : toast.type === "error" ? "#ef4444" : "#3b82f6"
						},
						children: toast.message
					}),
					/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
						style: styles.providerList,
						children: [groups.length === 0 && !loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
							style: styles.emptyTip,
							children: "未检测到已配置的模型提供商"
						}), groups.map((group) => {
							const isExpanded = !!expandedMap[group.key];
							const isSyncing = syncingProviders[group.key];
							const isTesting = testingProviders[group.key];
							return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
								style: styles.providerWrapper,
								children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									style: styles.providerHeader,
									onClick: () => toggleExpand(group.key),
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.providerTitleWrapper,
										children: [
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.collapseArrow,
												children: isExpanded ? "▼" : "▶"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.providerTitle,
												children: group.title
											}),
											group.isCustom && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
												style: styles.customBadge,
												children: "自定义"
											}),
											/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												style: styles.modelCount,
												children: [
													"(",
													group.models.length,
													"个模型)"
												]
											})
										]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										style: styles.providerActions,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											style: styles.smallBtn,
											onClick: (e) => handleTestProvider(group.key, e),
											disabled: isTesting,
											children: isTesting ? "测试中" : "测试"
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											style: styles.smallBtn,
											onClick: (e) => handleSyncProvider(group.key, e),
											disabled: isSyncing,
											children: isSyncing ? "同步中" : "同步"
										})]
									})]
								}), isExpanded && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									style: styles.modelContainer,
									children: group.models.map((model, idx) => {
										const displayName = model.name && model.name.trim() && model.name !== model.id ? model.name : model.id;
										const supportedLevels = Array.isArray(model.availableReasoningLevels) ? model.availableReasoningLevels.filter((lvl) => lvl && lvl !== "off") : [];
										const validLevels = ["off", ...supportedLevels];
										const isLast = idx === group.models.length - 1;
										return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											style: {
												...styles.modelRow,
												...isLast ? { borderBottom: "none" } : {}
											},
											children: [
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.rowBetween,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: styles.modelIdentity,
														children: [
															/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: styles.modelNameText,
																children: displayName
															}),
															model.testStatus === "success" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
																style: styles.badgeSuccess,
																title: model.testMessage,
																children: ["🟢 正常 ", model.testMessage]
															}),
															model.testStatus === "failed" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: styles.badgeFailed,
																children: "🔴 异常"
															}),
															model.testStatus === "testing" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
																style: styles.badgeTesting,
																children: "🟡 检测中..."
															})
														]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: styles.modalityWrapper,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
															style: styles.checkboxLabel,
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "图片" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																type: "checkbox",
																checked: model.supportsImages,
																onChange: (e) => updateModelField(group.key, model.id, { supportsImages: e.target.checked }),
																style: styles.checkbox
															})]
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
															style: styles.checkboxLabel,
															children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: "文本" }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																type: "checkbox",
																checked: model.supportsText,
																onChange: (e) => updateModelField(group.key, model.id, { supportsText: e.target.checked }),
																style: styles.checkbox
															})]
														})]
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.rowBetween,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: styles.fieldItem,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: styles.fieldLabel,
															children: "上下文:"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "number",
															value: model.contextWindow ?? "",
															onChange: (e) => updateModelField(group.key, model.id, { contextWindow: e.target.value ? parseInt(e.target.value, 10) : void 0 }),
															style: styles.numberInput
														})]
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: styles.fieldItem,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: styles.fieldLabel,
															children: "最大输出:"
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
															type: "number",
															value: model.maxOutput ?? "",
															onChange: (e) => updateModelField(group.key, model.id, { maxOutput: e.target.value ? parseInt(e.target.value, 10) : void 0 }),
															style: styles.numberInput
														})]
													})]
												}),
												/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.reasoningRow,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														style: styles.fieldLabel,
														children: "推理等级:"
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
														style: styles.levelGroup,
														children: [validLevels.map((lvl) => {
															const label = LEVEL_LABEL_MAP[lvl] || lvl;
															return /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("label", {
																style: styles.radioLabel,
																children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { children: label }), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
																	type: "radio",
																	name: `reasoning-${group.key}-${model.id}`,
																	checked: model.reasoningLevel === lvl,
																	onChange: () => updateModelField(group.key, model.id, { reasoningLevel: lvl }),
																	style: styles.radio
																})]
															}, lvl);
														}), supportedLevels.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															style: styles.unsupportedTip,
															children: "（该模型不支持思考等级）"
														})]
													})]
												}),
												model.testStatus === "failed" && model.testMessage && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.errorNotice,
													children: ["⚠️ ", model.testMessage]
												}),
												model.fallbackNote && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
													style: styles.fallbackNotice,
													children: ["💡 ", model.fallbackNote]
												})
											]
										}, model.id);
									})
								})]
							}, group.key);
						})]
					})
				]
			});
		};
		const styles = {
			container: {
				margin: "16px 0 24px 0",
				padding: "14px 16px",
				backgroundColor: "transparent",
				border: "0.5px solid var(--dsw-alias-border-l4, rgba(255, 255, 255, 0.12))",
				borderRadius: "16px",
				color: "var(--dsw-alias-label-primary, inherit)",
				fontFamily: "-apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, sans-serif"
			},
			header: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				paddingBottom: "12px",
				borderBottom: "0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))",
				marginBottom: "12px"
			},
			titleContainer: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			headerTitle: {
				fontSize: "14px",
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, inherit)"
			},
			loadingTag: {
				fontSize: "12px",
				color: "var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.45))"
			},
			buttonGroup: {
				display: "flex",
				gap: "8px"
			},
			btn: {
				boxSizing: "border-box",
				height: "28px",
				padding: "0 12px",
				fontSize: "12px",
				lineHeight: "18px",
				fontWeight: 400,
				cursor: "pointer",
				backgroundColor: "transparent",
				border: "0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.15))",
				color: "var(--dsw-alias-label-primary, inherit)",
				borderRadius: "14px",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				transition: "all 0.15s ease"
			},
			btnPrimary: {
				border: "0.5px solid var(--dsw-alias-border-brand, #3b82f6)",
				color: "#3b82f6",
				backgroundColor: "rgba(59, 130, 246, 0.08)",
				fontWeight: 500
			},
			btnDisabled: {
				opacity: .45,
				cursor: "not-allowed"
			},
			toast: {
				padding: "8px 12px",
				border: "0.5px solid",
				borderRadius: "8px",
				marginBottom: "12px",
				fontSize: "12px",
				fontWeight: 500
			},
			providerList: {
				display: "flex",
				flexDirection: "column",
				gap: "8px"
			},
			emptyTip: {
				textAlign: "center",
				padding: "20px",
				color: "var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.45))",
				fontSize: "13px"
			},
			providerWrapper: {
				backgroundColor: "transparent",
				border: "0.5px solid var(--dsw-alias-border-l4, rgba(255, 255, 255, 0.12))",
				borderRadius: "16px",
				overflow: "hidden",
				transition: "border-color 0.15s ease"
			},
			providerHeader: {
				display: "flex",
				alignItems: "center",
				justifyContent: "space-between",
				padding: "12px 14px",
				cursor: "pointer",
				userSelect: "none"
			},
			providerTitleWrapper: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			collapseArrow: {
				fontSize: "10px",
				color: "var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.5))",
				display: "inline-block",
				width: "12px"
			},
			providerTitle: {
				fontSize: "14px",
				fontWeight: 500,
				color: "var(--dsw-alias-label-primary, inherit)"
			},
			modelCount: {
				fontSize: "12px",
				color: "var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.45))"
			},
			customBadge: {
				fontSize: "11px",
				lineHeight: "16px",
				padding: "1px 6px",
				border: "0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.15))",
				color: "var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.65))",
				borderRadius: "4px"
			},
			providerActions: {
				display: "flex",
				gap: "8px"
			},
			smallBtn: {
				boxSizing: "border-box",
				height: "28px",
				padding: "0 12px",
				fontSize: "12px",
				lineHeight: "18px",
				cursor: "pointer",
				backgroundColor: "transparent",
				border: "0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.15))",
				color: "var(--dsw-alias-label-primary, inherit)",
				borderRadius: "14px",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: "center",
				transition: "all 0.15s ease"
			},
			modelContainer: {
				borderTop: "0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))",
				padding: "0 14px"
			},
			modelRow: {
				padding: "12px 0",
				borderBottom: "0.5px solid var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.08))",
				display: "flex",
				flexDirection: "column",
				gap: "10px"
			},
			rowBetween: {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				width: "100%"
			},
			modelIdentity: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			modelNameText: {
				fontSize: "13px",
				fontWeight: 600,
				color: "var(--dsw-alias-label-primary, inherit)"
			},
			modalityWrapper: {
				display: "flex",
				alignItems: "center",
				gap: "16px"
			},
			checkboxLabel: {
				display: "flex",
				alignItems: "center",
				gap: "6px",
				fontSize: "12px",
				cursor: "pointer",
				color: "var(--dsw-alias-label-secondary, inherit)"
			},
			checkbox: {
				cursor: "pointer",
				accentColor: "#3b82f6",
				width: "14px",
				height: "14px"
			},
			fieldItem: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			fieldLabel: {
				fontSize: "12px",
				color: "var(--dsw-alias-label-secondary, rgba(255, 255, 255, 0.7))"
			},
			numberInput: {
				boxSizing: "border-box",
				width: "120px",
				height: "26px",
				padding: "0 8px",
				backgroundColor: "transparent",
				border: "0.5px solid var(--dsw-alias-border-l3, rgba(255, 255, 255, 0.18))",
				color: "inherit",
				fontSize: "12px",
				borderRadius: "6px",
				outline: "none"
			},
			reasoningRow: {
				display: "flex",
				alignItems: "center",
				gap: "12px",
				fontSize: "12px"
			},
			levelGroup: {
				display: "flex",
				alignItems: "center",
				gap: "12px",
				flexWrap: "wrap"
			},
			radioLabel: {
				display: "flex",
				alignItems: "center",
				gap: "4px",
				fontSize: "12px",
				cursor: "pointer",
				color: "var(--dsw-alias-label-secondary, inherit)"
			},
			radio: {
				cursor: "pointer",
				accentColor: "#3b82f6"
			},
			unsupportedTip: {
				fontSize: "12px",
				color: "var(--dsw-alias-label-tertiary, rgba(255, 255, 255, 0.45))"
			},
			fallbackNotice: {
				fontSize: "12px",
				color: "#eab308",
				padding: "2px 0",
				display: "block"
			},
			badgeSuccess: {
				fontSize: "11px",
				color: "#22c55e",
				border: "0.5px solid rgba(34, 197, 94, 0.3)",
				borderRadius: "4px",
				padding: "1px 6px"
			},
			badgeFailed: {
				fontSize: "11px",
				color: "#ef4444",
				border: "0.5px solid rgba(239, 68, 68, 0.3)",
				borderRadius: "4px",
				padding: "1px 6px",
				display: "inline-block",
				verticalAlign: "middle"
			},
			errorNotice: {
				marginTop: "6px",
				padding: "6px 10px",
				fontSize: "12px",
				lineHeight: "1.4",
				color: "#ef4444",
				backgroundColor: "rgba(239, 68, 68, 0.08)",
				border: "0.5px solid rgba(239, 68, 68, 0.25)",
				borderRadius: "6px",
				wordBreak: "break-word"
			},
			badgeTesting: {
				fontSize: "11px",
				color: "#eab308",
				border: "0.5px solid rgba(234, 179, 8, 0.3)",
				borderRadius: "4px",
				padding: "1px 6px"
			}
		};
		//#endregion
		//#region src/client/index.tsx
		const name = "dsh-models-sync-client";
		const inject = [
			"slots",
			"modelDirectories",
			"sessions",
			"remote",
			"remote.session"
		];
		function apply(ctx) {
			try {
				ctx.slots.inject("settings.models.footer", () => ctx.slots.register({
					name: "settings.models.footer",
					id: "dsh-models-sync",
					order: -999999
				}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelsSyncCard, {
					...props,
					ctx
				})));
				ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
					name: "settings.plugin.item",
					key: "dsh-models-sync",
					priority: -999999
				}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelsSyncCard, {
					...props,
					as: "li",
					ctx
				})));
				ctx.slots.inject("plugins.bundle.config", () => ctx.slots.register({
					name: "plugins.bundle.config",
					key: "dsh-models-sync"
				}, (props) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)(ModelsSyncCard, {
					...props,
					ctx
				})));
			} catch (error) {
				console.error("[dsh-models-sync] 前端卡片注册失败:", error);
			}
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		exports.name = name;
		return module.exports;
	}
});
