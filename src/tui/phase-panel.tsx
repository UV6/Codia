import { Box, Text } from "ink";
import type { TaskPhase } from "../agent/types.js";

interface PhasePanelProps {
  phases: TaskPhase[];
}

function phasePrefix(status: TaskPhase["status"]): string {
  switch (status) {
    case "completed":
      return "[✓]";
    case "in_progress":
      return "[~]";
    case "failed":
      return "[x]";
    default:
      return "[ ]";
  }
}

// PhasePanel —— 长任务阶段进度面板
export function PhasePanel({ phases }: PhasePanelProps) {
  if (phases.length === 0) return null;

  const groups = new Map<string, TaskPhase[]>();
  for (const phase of phases) {
    const key = phase.taskTitle ?? "";
    const list = groups.get(key) ?? [];
    list.push(phase);
    groups.set(key, list);
  }

  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold color="cyan">任务进度</Text>
      {Array.from(groups.entries()).map(([taskTitle, taskPhases]) => (
        <Box key={taskTitle || "default"} flexDirection="column">
          {taskTitle && <Text bold>{taskTitle}</Text>}
          {taskPhases.map((phase) => (
            <Text key={phase.id} color={phase.status === "in_progress" ? "yellow" : undefined}>
              {`${phasePrefix(phase.status)} ${phase.title}`}
            </Text>
          ))}
        </Box>
      ))}
    </Box>
  );
}
