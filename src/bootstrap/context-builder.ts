import type {
  BootstrapContext,
  BootstrapDiagnostics,
  SessionSummary,
  SessionRecoveryResult,
} from "./types.js";
import { loadForProject } from "../instruction/loader.js";
import { loadIndexes, renderIndexText } from "../memory/store.js";
import { recoverSession } from "../chat/recovery.js";
import { sessionPath } from "../chat/history.js";
import { scanAll } from "../skill/loader.js";
import type { Skill, SkillDiagnostic } from "../skill/types.js";

export interface BuildOptions {
  projectRoot: string;
  now: Date;
  maxContextTokens?: number;
}

// buildNewSessionContext —— 新会话启动上下文
export function buildNewSessionContext(options: BuildOptions): BootstrapContext {
  const diag: BootstrapDiagnostics = { entries: [] };

  // 加载指令
  let instructionText = "";
  try {
    const ir = loadForProject(options.projectRoot);
    instructionText = ir.text;
    diag.entries.push(...ir.diagnostics);
  } catch (e) {
    diag.entries.push({
      source: "instruction",
      level: "error",
      message: `指令加载失败：${(e as Error).message}`,
      code: "INSTRUCTION_LOAD_ERROR",
    });
  }

  // 加载记忆索引
  let memoryText = "";
  try {
    const bundle = loadIndexes(options.projectRoot);
    memoryText = renderIndexText(bundle);
  } catch (e) {
    diag.entries.push({
      source: "memory",
      level: "warning",
      message: `记忆索引加载失败：${(e as Error).message}`,
      code: "MEMORY_LOAD_ERROR",
    });
  }

  // 扫描 Skill
  let skills: Skill[] = [];
  let skillDiagnostics: SkillDiagnostic[] = [];
  try {
    const result = scanAll(options.projectRoot);
    skills = result.skills;
    skillDiagnostics = result.diagnostics;
  } catch (e) {
    diag.entries.push({
      source: "skill",
      level: "warning",
      message: `Skill 扫描失败：${(e as Error).message}`,
      code: "SKILL_SCAN_ERROR",
    });
  }

  // 合并 Skill 诊断
  for (const sd of skillDiagnostics) {
    diag.entries.push({
      source: "skill",
      level: sd.level,
      message: sd.message,
      code: sd.level === "error" ? "SKILL_ALLOWED_TOOL_INVALID" : "SKILL_PARSE_WARNING",
    });
  }

  return {
    instructionText,
    memoryText,
    recoveredMessages: [],
    diagnostics: diag,
    skillScanData: { skills, diagnostics: skillDiagnostics },
  };
}

// buildResumeContext —— 恢复旧会话上下文
export function buildResumeContext(
  options: BuildOptions,
  sessionId: string,
): BootstrapContext {
  const base = buildNewSessionContext(options);
  const fp = sessionPath(sessionId, options.projectRoot);

  try {
    const recovery = recoverSession({
      sessionId,
      filePath: fp,
      now: options.now,
      maxContextTokens: options.maxContextTokens,
    });

    base.recoveredMessages = recovery.messages;
    if (recovery.warnings.length > 0) {
      recovery.warnings.forEach((w) => {
        base.diagnostics.entries.push({
          source: "session",
          level: "warning",
          message: w,
          code: "SESSION_RECOVERY_WARNING",
        });
      });
    }
  } catch (e) {
    base.diagnostics.entries.push({
      source: "session",
      level: "error",
      message: `会话恢复失败：${(e as Error).message}`,
      code: "SESSION_RECOVER_ERROR",
    });
  }

  return base;
}
