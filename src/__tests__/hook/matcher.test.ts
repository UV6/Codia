import { describe, it, expect } from "vitest";
import { matchCondition, matchField, getFieldValue } from "../../hook/matcher.js";
import type { FieldCondition, HookContext } from "../../hook/types.js";

describe("getFieldValue", () => {
  it("从 context 取顶层字段", () => {
    const ctx: HookContext = { name: "Alice", age: 30 };
    expect(getFieldValue(ctx, "name")).toBe("Alice");
    expect(getFieldValue(ctx, "age")).toBe("30");
  });

  it("从 context 取嵌套字段", () => {
    const ctx: HookContext = { params: { command: "git push" } };
    expect(getFieldValue(ctx, "params.command")).toBe("git push");
  });

  it("路径不存在时返回 undefined", () => {
    const ctx: HookContext = { name: "test" };
    expect(getFieldValue(ctx, "params.command")).toBeUndefined();
  });

  it("中间路径为非对象时返回 undefined", () => {
    const ctx: HookContext = { name: "test" };
    expect(getFieldValue(ctx, "name.nonexistent")).toBeUndefined();
  });
});

describe("matchField", () => {
  const ctx: HookContext = { tool_name: "Bash", params: { command: "git push --force" } };

  it("equals 精确匹配", () => {
    const fc: FieldCondition = { field: "tool_name", equals: "Bash" };
    expect(matchField(fc, ctx)).toBe(true);
  });

  it("equals 不匹配", () => {
    const fc: FieldCondition = { field: "tool_name", equals: "Read" };
    expect(matchField(fc, ctx)).toBe(false);
  });

  it("not 反向匹配", () => {
    const fc: FieldCondition = { field: "tool_name", not: "Read" };
    expect(matchField(fc, ctx)).toBe(true);
    const fc2: FieldCondition = { field: "tool_name", not: "Bash" };
    expect(matchField(fc2, ctx)).toBe(false);
  });

  it("regex 正则匹配", () => {
    const fc: FieldCondition = { field: "params.command", regex: "push" };
    expect(matchField(fc, ctx)).toBe(true);
  });

  it("regex 不匹配", () => {
    const fc: FieldCondition = { field: "params.command", regex: "pull" };
    expect(matchField(fc, ctx)).toBe(false);
  });

  it("glob 通配符匹配", () => {
    const fc: FieldCondition = { field: "params.command", glob: "git *" };
    expect(matchField(fc, ctx)).toBe(true);
  });

  it("glob 不匹配", () => {
    const fc: FieldCondition = { field: "params.command", glob: "npm *" };
    expect(matchField(fc, ctx)).toBe(false);
  });

  it("字段不存在时返回 false", () => {
    const fc: FieldCondition = { field: "nonexistent", equals: "value" };
    expect(matchField(fc, ctx)).toBe(false);
  });

  it("多个模式同时存在时全部满足才为 true", () => {
    const fc: FieldCondition = { field: "params.command", glob: "git *", regex: "push" };
    expect(matchField(fc, ctx)).toBe(true);
  });

  it("多个模式一个不满足则 false", () => {
    const fc: FieldCondition = { field: "params.command", glob: "git *", regex: "pull" };
    expect(matchField(fc, ctx)).toBe(false);
  });
});

describe("matchCondition", () => {
  const ctx: HookContext = { tool_name: "Bash", params: { command: "git push" } };

  it("condition 为 undefined 时返回 true（无条件触发）", () => {
    expect(matchCondition(undefined, ctx)).toBe(true);
  });

  it("fields 为空数组时返回 true", () => {
    expect(matchCondition({ match: "all", fields: [] }, ctx)).toBe(true);
  });

  it("match: all 全部满足时返回 true", () => {
    expect(
      matchCondition(
        {
          match: "all",
          fields: [
            { field: "tool_name", equals: "Bash" },
            { field: "params.command", glob: "git *" },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });

  it("match: all 部分不满足时返回 false", () => {
    expect(
      matchCondition(
        {
          match: "all",
          fields: [
            { field: "tool_name", equals: "Bash" },
            { field: "params.command", glob: "npm *" },
          ],
        },
        ctx,
      ),
    ).toBe(false);
  });

  it("match: any 任一满足时返回 true", () => {
    expect(
      matchCondition(
        {
          match: "any",
          fields: [
            { field: "tool_name", equals: "Read" },
            { field: "params.command", glob: "git *" },
          ],
        },
        ctx,
      ),
    ).toBe(true);
  });

  it("match: any 全不满足时返回 false", () => {
    expect(
      matchCondition(
        {
          match: "any",
          fields: [
            { field: "tool_name", equals: "Read" },
            { field: "params.command", glob: "npm *" },
          ],
        },
        ctx,
      ),
    ).toBe(false);
  });
});
