import { describe, it, expect } from "vitest";
import { AgentRoleRegistry } from "../../../agent/role/registry.js";
import { builtinRoles } from "../../../agent/role/builtin.js";

describe("AgentRoleRegistry", () => {
  it("内置角色在 reload 后可用", () => {
    const registry = new AgentRoleRegistry("/tmp/test-project");
    registry.reload();

    expect(registry.list().length).toBeGreaterThanOrEqual(4);

    const explore = registry.resolve("Explore");
    expect(explore).not.toBeNull();
    expect(explore!.frontmatter.name).toBe("Explore");
    expect(explore!.source).toBe("builtin");
  });

  it("resolve 不存在的角色返回 null", () => {
    const registry = new AgentRoleRegistry("/tmp/test-project");
    registry.reload();

    expect(registry.resolve("nonexistent")).toBeNull();
  });

  it("list 返回所有角色", () => {
    const registry = new AgentRoleRegistry("/tmp/test-project");
    registry.reload();

    const roles = registry.list();
    const names = roles.map((r) => r.frontmatter.name);
    expect(names).toContain("Explore");
    expect(names).toContain("Plan");
    expect(names).toContain("general-purpose");
    expect(names).toContain("Verification");
  });

  it("getBuiltinRoles 返回四个内置角色", () => {
    const registry = new AgentRoleRegistry("/tmp/test-project");
    const builtins = registry.getBuiltinRoles();

    expect(builtins).toHaveLength(4);
    expect(builtins).toEqual(builtinRoles);
  });
});
