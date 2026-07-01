import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "../provider/openai.js";
import type { ChatConfig, Message } from "../provider/types.js";
import type { ToolMeta } from "../tool/types.js";

function stringToStream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe("OpenAIProvider", () => {
  const config: ChatConfig = {
    protocol: "openai",
    model: "gpt-5.4",
    baseUrl: "https://api.openai.com",
    apiKey: "test-key",
  };

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("请求体包含 OpenAI tools 格式，并正确回灌 tool 消息", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body as string;
      expect(body).toBeTruthy();
      const parsed = JSON.parse(body);

      expect(parsed.model).toBe("gpt-5.4");
      expect(parsed.stream).toBe(true);
      expect(parsed.stream_options).toEqual({ include_usage: true });
      expect(parsed.tool_choice).toBe("auto");
      expect(parsed.tools).toEqual([{
        type: "function",
        function: {
          name: "LoadSkill",
          description: "加载 Skill",
          parameters: {
            type: "object",
            properties: {
              name: { type: "string", description: "Skill 名称" },
            },
            required: ["name"],
          },
        },
      }]);
      expect(parsed.messages).toEqual([
        { role: "system", content: "system prompt" },
        { role: "user", content: "先看一下项目" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: {
              name: "Read",
              arguments: "{\"path\":\"package.json\"}",
            },
          }],
        },
        {
          role: "tool",
          tool_call_id: "call_1",
          content: "package.json 内容",
        },
      ]);

      return new Response(stringToStream("data: [DONE]\n\n"));
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider();
    const messages: Message[] = [
      {
        role: "user",
        content: "先看一下项目",
        timestamp: "2026-07-01T00:00:00.000Z",
      },
      {
        role: "assistant",
        content: "",
        timestamp: "2026-07-01T00:00:01.000Z",
        toolCalls: [{
          id: "call_1",
          name: "Read",
          input: { path: "package.json" },
        }],
      },
      {
        role: "user",
        content: "package.json 内容",
        timestamp: "2026-07-01T00:00:02.000Z",
        toolResults: [{
          toolUseId: "call_1",
          result: { status: "success", content: "package.json 内容" },
        }],
      },
    ];
    const tools: ToolMeta[] = [{
      name: "LoadSkill",
      description: "加载 Skill",
      input_schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill 名称" },
        },
        required: ["name"],
      },
    }];

    const chunks = [];
    for await (const chunk of provider.streamChat(
      messages,
      config,
      new AbortController().signal,
      tools as unknown as Record<string, unknown>[],
      "system prompt",
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([{ type: "done" }]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("解析 OpenAI 兼容协议返回的 tool_calls 流", async () => {
    const events = [
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "LoadSkill", arguments: "{" },
            }],
          },
          index: 0,
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: "\"name\":\"review\"" },
            }],
          },
          index: 0,
          finish_reason: null,
        }],
      },
      {
        choices: [{
          delta: {
            tool_calls: [{
              index: 0,
              function: { arguments: "}" },
            }],
          },
          index: 0,
          finish_reason: null,
        }],
      },
      {
        choices: [{ delta: {}, index: 0, finish_reason: "tool_calls" }],
      },
    ];

    const fetchMock = vi.fn(async () => new Response(stringToStream(
      ...events.map((event) => `data: ${JSON.stringify(event)}\n\n`),
      "data: [DONE]\n\n",
    )));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAIProvider();
    const chunks = [];
    for await (const chunk of provider.streamChat(
      [{
        role: "user",
        content: "加载 review skill",
        timestamp: "2026-07-01T00:00:00.000Z",
      }],
      config,
      new AbortController().signal,
      [],
      undefined,
    )) {
      chunks.push(chunk);
    }

    expect(chunks).toContainEqual({ type: "tool_status", name: "LoadSkill", param: "" });
    expect(chunks).toContainEqual({
      type: "tool_use",
      call: {
        id: "call_1",
        name: "LoadSkill",
        input: { name: "review" },
      },
    });
  });
});
