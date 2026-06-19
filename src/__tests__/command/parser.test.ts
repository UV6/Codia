import { describe, it, expect } from "vitest";
import { parseCommand } from "../../command/parser.js";

describe("parseCommand", () => {
  it("/help 解析为命令名 help，参数为空", () => {
    expect(parseCommand("/help")).toEqual({
      isCommand: true,
      name: "help",
      args: "",
    });
  });

  it("/plan 重构认证 解析为命令名 plan，参数 重构认证", () => {
    expect(parseCommand("/plan 重构认证")).toEqual({
      isCommand: true,
      name: "plan",
      args: "重构认证",
    });
  });

  it("大小写不敏感：/Help 解析为 help", () => {
    expect(parseCommand("/Help")).toEqual({
      isCommand: true,
      name: "help",
      args: "",
    });
  });

  it("普通文本 hello 不是命令", () => {
    expect(parseCommand("hello")).toEqual({
      isCommand: false,
      name: "",
      args: "",
    });
  });

  it("仅 / 不是命令", () => {
    expect(parseCommand("/")).toEqual({
      isCommand: false,
      name: "",
      args: "",
    });
  });

  it("空字符串不是命令", () => {
    expect(parseCommand("")).toEqual({
      isCommand: false,
      name: "",
      args: "",
    });
  });

  it("/   (斜杠加空格) 不是命令", () => {
    expect(parseCommand("/ ")).toEqual({
      isCommand: false,
      name: "",
      args: "",
    });
  });

  it("带多余空格的参数正确 trim", () => {
    expect(parseCommand("/plan   重构认证模块  ")).toEqual({
      isCommand: true,
      name: "plan",
      args: "重构认证模块",
    });
  });

  it("只有命令名无参数", () => {
    expect(parseCommand("/status")).toEqual({
      isCommand: true,
      name: "status",
      args: "",
    });
  });
});
