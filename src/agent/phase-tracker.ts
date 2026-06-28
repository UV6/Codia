import type { TaskPhase } from "./types.js";

const TASK_HEADER_RE = /^(?:#{1,6}\s*)?(?:任务|子任务|Agent|代理)\s*[\d一二三四五六七八九十A-Za-z_-]*\s*[:：]\s*(.+)$/;
const NUMBERED_STEP_RE = /^\s*(\d+)\.\s+(.+)$/;

function normalizeTaskTitle(text: string): string {
  return text.trim();
}

// parsePlanPhases —— 从可见“计划”文本中提取复杂任务阶段
export function parsePlanPhases(text: string): TaskPhase[] {
  if (!text.includes("计划")) return [];

  const lines = text.split("\n");
  const phases: TaskPhase[] = [];
  let currentTaskTitle: string | undefined;

  for (const line of lines) {
    const taskHeader = line.match(TASK_HEADER_RE);
    if (taskHeader) {
      currentTaskTitle = normalizeTaskTitle(taskHeader[1]);
      continue;
    }

    const step = line.match(NUMBERED_STEP_RE);
    if (!step) continue;

    phases.push({
      id: `phase-${phases.length + 1}`,
      title: step[2].trim(),
      taskTitle: currentTaskTitle,
      status: "pending",
    });
  }

  const taskGroupCount = new Set(phases.map((phase) => phase.taskTitle).filter(Boolean)).size;
  const isComplex = taskGroupCount >= 2 || phases.length >= 3;
  if (!isComplex) return [];

  return phases.map((phase, index) => ({
    ...phase,
    status: index === 0 ? "in_progress" : "pending",
  }));
}

// advancePhases —— 完成当前进行中的阶段，并推进到下一个待办阶段
export function advancePhases(phases: TaskPhase[]): TaskPhase[] {
  const currentIndex = phases.findIndex((phase) => phase.status === "in_progress");
  if (currentIndex === -1) return phases;

  return phases.map((phase, index) => {
    if (index === currentIndex) {
      return { ...phase, status: "completed" };
    }
    if (index === currentIndex + 1 && phase.status === "pending") {
      return { ...phase, status: "in_progress" };
    }
    return phase;
  });
}

// completePhases —— 任务结束时把剩余阶段标记为完成
export function completePhases(phases: TaskPhase[]): TaskPhase[] {
  return phases.map((phase) =>
    phase.status === "completed" ? phase : { ...phase, status: "completed" }
  );
}
