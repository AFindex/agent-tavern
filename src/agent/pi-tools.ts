import { Type } from "@earendil-works/pi-ai";
import type { Static } from "@earendil-works/pi-ai";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import type { JsonValue, Lorebook } from "../types.js";
import { matchLoreEntries } from "../st/lorebook.js";

export interface RuntimeToolContext {
  currentScene: string;
  summary: string;
  variables: Record<string, JsonValue>;
  lorebooks: Lorebook[];
  recentMessageText: string[];
  onUpdateState: (patch: {
    currentScene?: string;
    summary?: string;
    variables?: Record<string, JsonValue>;
  }) => void;
}

const UpdateSceneSchema = Type.Object({
  scene: Type.String({ description: "新的场景描述" }),
});

const UpdateSummarySchema = Type.Object({
  summary: Type.String({ description: "新的状态摘要" }),
});

const SetVariableSchema = Type.Object({
  key: Type.String({ description: "变量名" }),
  value: Type.Any({ description: "变量值（任意 JSON）" }),
});

const SearchLoreSchema = Type.Object({
  query: Type.String({ description: "检索关键词或短语" }),
});

export function createRuntimeTools(context: RuntimeToolContext): AgentTool[] {
  const updateSceneTool: AgentTool<typeof UpdateSceneSchema> = {
    name: "update_scene",
    label: "更新场景",
    description: "更新当前场景描述。",
    parameters: UpdateSceneSchema,
    async execute(_toolCallId, params: Static<typeof UpdateSceneSchema>) {
      context.onUpdateState({ currentScene: params.scene });
      return {
        content: [{ type: "text", text: "场景已更新。" }],
        details: { scene: params.scene },
      };
    },
  };

  const updateSummaryTool: AgentTool<typeof UpdateSummarySchema> = {
    name: "update_summary",
    label: "更新摘要",
    description: "更新会话状态摘要。",
    parameters: UpdateSummarySchema,
    async execute(_toolCallId, params: Static<typeof UpdateSummarySchema>) {
      context.onUpdateState({ summary: params.summary });
      return {
        content: [{ type: "text", text: "摘要已更新。" }],
        details: { summary: params.summary },
      };
    },
  };

  const setVariableTool: AgentTool<typeof SetVariableSchema> = {
    name: "set_variable",
    label: "设置变量",
    description: "设置或更新一个状态变量。",
    parameters: SetVariableSchema,
    async execute(_toolCallId, params: Static<typeof SetVariableSchema>) {
      const nextVariables = { ...context.variables, [params.key]: params.value as JsonValue };
      context.onUpdateState({ variables: nextVariables });
      return {
        content: [{ type: "text", text: `变量 ${params.key} 已设置。` }],
        details: { key: params.key, value: params.value },
      };
    },
  };

  const searchLoreTool: AgentTool<typeof SearchLoreSchema> = {
    name: "search_lore",
    label: "检索世界书",
    description: "根据当前输入检索相关的世界书条目。",
    parameters: SearchLoreSchema,
    async execute(_toolCallId, params: Static<typeof SearchLoreSchema>) {
      const entries = matchLoreEntries(
        context.lorebooks,
        params.query,
        context.recentMessageText,
      );
      const text =
        entries.length === 0
          ? "未找到相关世界书条目。"
          : entries
              .map((entry) => `- ${entry.title}: ${entry.content}`)
              .join("\n");
      return {
        content: [{ type: "text", text }],
        details: { entries: entries.map((e) => ({ id: e.id, title: e.title })) },
      };
    },
  };

  return [updateSceneTool, updateSummaryTool, setVariableTool, searchLoreTool];
}
