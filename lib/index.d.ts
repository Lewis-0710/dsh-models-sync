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
/**
 * 供应商 Key 宽容归一化对比，兼容 .models 后缀与大小写变体
 */
declare function isSameProviderKey(groupKey?: string, targetKey?: string): boolean;
declare function apply(ctx: Context): void;
//#endregion
export { apply, buildDshReasoning, inject, isSameProviderKey, name };