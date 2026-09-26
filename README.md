# dsh-models-sync (模型参数同步与测活)

DeepSeek Harness (DSH Desktop) 核心生态插件：全动态解析模型列表，基于 `models.dev` 元数据按 4 级优先级智能补全更正上下文窗口、最大输出、模态与思考等级，支持模型可用性测活，并实现 `settings.yaml` 与连接器状态缓存文件的全量双向持久化，打通对话框思考等级选择链路。

---

## ✨ 核心特性

1. **零硬编码与全动态提供商发现**：
   - 100% 动态读取 `~/.dsh/settings.yaml` 及各连接器本地状态缓存文件（`state/*-catalog.json`）；
   - 自动识别所有已配置的模型提供商，分组名称与系统模型选择列表（如 `Trae`、`Trae Global`、`WorkBuddy`、`WorkBuddy Global`、`Qoder`、`HSB 补全`、`HSB 响应` 等）保持动态一致。

2. **严格的 4 级多层级匹配策略（基于 models.dev）**：
   - **优先级 1（精确 ID 匹配）**：优先使用模型 ID 与 `models.dev` 进行严格比对；
   - **优先级 2（别名匹配）**：若未命中，使用模型显示名称（Name）进行匹配；
   - **优先级 3（Latest 路由映射）**：针对 `latest` 逻辑路由 ID（如 `glm-latest`、`glm-latest-flash`），动态推导并匹配该系列在 `models.dev` 中的最新版本（如 `glm-5.3`）；
   - **优先级 4（同族模型回退匹配）**：若仍未命中，自动回退匹配同族数据（如 `mimo-2.7-flash` 匹配 `mimo-2.7`），并在界面显示明显的估算提示。

3. **思考等级智能识别与自动默认值**：
   - 动态提取每个模型支持的思考等级列表（关 / 低 / 中 / 高 / 极高 / 最大）；
   - 智能推荐默认选中的思考等级，支持界面直接下拉调整；
   - 完善处理不同连接器特有的参数规范（如 Trae 的 `light`/`high`/`extra_high` 映射及 WorkBuddy/Qoder 的 `supportedEfforts` 规范）。

4. **双向持久化与对话框无缝兼容**：
   - **保存全部**：将修改后的全部模型参数安全写回 `~/.dsh/settings.yaml`，保留原有 YAML 注释与缩进结构，并在写入前自动创建带时间戳的备份文件；
   - **打通对话框选择链路**：同步动态写回全部连接器插件本地的 `state/*-catalog.json` 缓存文件，确保 DSH Desktop 下方的 Composer 对话框输入区域能够完整识别思考等级，正常弹出并切换思考等级按钮。

5. **模型可用性测活与延迟感知（深度防误判）**：
   - **全量测活（测试全部）**：一键检测全部已配置模型的真实连通性与响应状态，实时显示延迟标签（毫秒）；
   - **上游正文错误精准拦截**：针对 Trae solo-bridge 等网关将错误信息（如 4008 额度耗尽、4120 权限不足等）伪装在流式 content 正文推送的特殊机制，内置深度特征实时拦截与渐进式防截断机制，坚决杜绝以 `content-start` 等空事件误判为连接正常；
   - **按供应商单测（测试）**：每个供应商卡片独立提供测试按钮，可单独进行连通性验证。

6. **原生多模态视觉支持与加权候选优选**：
   - **候选条目质量打分优选**：在 `models.dev` 多 Provider 竞态场景下，优先挑选包含 `image` 的官方完整条目，防止第三方残缺纯文本脏数据覆盖多模态能力；
   - **变体词干智能剥离**：支持通用剥离 `-luna`、`-ds`、`-flash`、`-pro`、`-ultraspeed` 等常见修饰词干，精准回退匹配同族数据；
   - **架构族原生多模态自适应兜底**：结合小米 MiMo-2.5/2.6 全系、Gemini、Claude、GPT-4o、Qwen-VL 等通用多模态架构族规则，确保在任何网络或数据缺失环境下 100% 自动识别并勾选图片支持。

7. **原生暗黑毛玻璃 UI 体验**：
   - 注入官方 `settings.models.footer` 插槽，展示在 DSH Desktop **设置 -> 模型** 页面底部；
   - 同时声明注册 `settings.plugin.item` 兼容席位，适配不同版本的 DSH 宿主环境；
   - 视觉样式与 DSH Desktop 原生界面风格严格保持一致。

---

## 🏗️ 目录结构

```text
dsh-models-sync/
├── cordis.patch.yml         # Cordis 宿主注入与插件声明
├── package.json             # 插件描述、构建与依赖配置
├── tsconfig.json            # Host 端 TypeScript 配置
├── tsconfig.client.json     # Client 端 TypeScript 配置
├── tsdown.config.ts         # 打包构建配置（双端 ESM / Browser 打包）
├── src/
│   ├── types.ts             # 核心数据结构与接口契约
│   ├── catalog.ts           # models.dev 元数据拉取与本地缓存
│   ├── matcher.ts           # 4 级优先级智能匹配算法
│   ├── reasoning-utils.ts   # 思考等级动态解析与默认值工具
│   ├── settings-manager.ts  # settings.yaml 与 state 缓存双向持久化
│   ├── probe.ts             # 模型可用性检测与延迟测试
│   ├── index.ts             # Host 端插件入口与 WebServer 路由
│   └── client/
│       ├── slot-contract.ts # 插槽契约扩展
│       ├── ModelsSyncCard.tsx # 模型参数同步卡片前端组件
│       └── index.tsx        # 前端入口与插槽注入注册
├── test/
│   ├── matcher.spec.ts      # 4 级匹配算法单测
│   ├── reasoning.spec.ts    # 思考等级解析与自动默认值单测
│   └── state-sync.spec.ts   # state 缓存文件双向持久化单测
└── lib/                     # 编译构建输出目录 (双端产物)
```

---

## 🛠️ 构建与测试

```bash
# 1. 安装项目依赖
pnpm install

# 2. 运行单元测试套件
pnpm test

# 3. 类型检查
pnpm run typecheck

# 4. 构建双端产物 (lib/index.js & lib/client.js)
pnpm run build
```

---

## 🚀 安装与使用

1. 将本插件克隆或软链接至 DSH Desktop 插件目录：
   ```bash
   ln -s /path/to/dsh-models-sync ~/.dsh/profiles/desktop/node_modules/dsh-models-sync
   ```
2. 重启或刷新 DSH Desktop（<kbd>Command</kbd> + <kbd>R</kbd>）；
3. 打开 **设置 (Settings) -> 模型 (Models)**，页面底部即可看到【模型参数同步与测活】功能面板；
4. 点击【同步全部】自动补全更正参数与思考等级，点击【保存全部】同时更新配置文件与本地状态缓存；
5. 在下方对话框输入区域切换模型，思考等级按钮将自动呈现并支持自由切换。

---

## 📄 License

MIT License.
