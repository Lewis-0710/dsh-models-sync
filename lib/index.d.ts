import { Context } from "@deepseek-ai/cordis";
//#region src/index.d.ts
declare const name = "dsh-models-sync";
declare const inject: string[];
/**
 * 动态根据配置为 Model 组装符合 DSH Desktop 规范的 reasoning 对象
 */
declare function buildDshReasoning(availableLevels?: string[], defaultLevel?: string): {
  efforts: Array<{
    id: string;
    name: string;
  }>;
  defaultEffort: string;
} | undefined;
declare function apply(ctx: Context): void;
//#endregion
export { apply, buildDshReasoning, inject, name };