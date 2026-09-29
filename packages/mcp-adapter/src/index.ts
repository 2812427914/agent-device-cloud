import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type Tool
} from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import { z } from "zod";
import { AdcClient, buildInvocation, type InvocationContext } from "@adc/client";
import {
  ToolArgsSchemas,
  ToolNameSchema,
  isBuiltinTool,
  isSideEffectTool,
  type InvocationResult,
  type ToolCapability,
  type ToolId,
  type ToolName
} from "@adc/protocol";

export interface McpAdapterOptions {
  client: Pick<AdcClient, "invoke">;
  context: InvocationContext;
  loadContext?: () => Promise<InvocationContext>;
  defaultTarget?: { nodeId: string } | { projectId: string; affinity?: string };
  allowedTools?: ToolId[];
}

interface AdapterInput {
  args: unknown;
  target?: { nodeId: string } | { projectId: string; affinity?: string };
  idempotencyKey?: string;
}

const controlPlaneTools: ReadonlySet<ToolName> = new Set([
  "device.list",
  "device.status",
  "task.status",
  "task.result",
  "task.cancel"
]);

function nodeIdsForTool(context: InvocationContext, tool: ToolId): string[] | undefined {
  const advertised = context.toolNodeIds?.[tool];
  if (advertised === undefined) return undefined;
  const granted = new Set(context.nodeIds ?? []);
  return [...new Set(advertised.filter((nodeId) => granted.has(nodeId)))].sort();
}

function targetJsonSchema(
  context: InvocationContext,
  tool: ToolId
): Record<string, unknown> | undefined {
  if (isBuiltinTool(tool) && controlPlaneTools.has(tool)) {
    return {
      oneOf: [
        {
          type: "object",
          properties: { nodeId: { type: "string" } },
          required: ["nodeId"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            projectId: { type: "string" },
            affinity: { type: "string" }
          },
          required: ["projectId"],
          additionalProperties: false
        }
      ]
    };
  }
  const nodeIds = nodeIdsForTool(context, tool);
  if (nodeIds === undefined) {
    return {
      oneOf: [
        {
          type: "object",
          properties: { nodeId: { type: "string" } },
          required: ["nodeId"],
          additionalProperties: false
        },
        {
          type: "object",
          properties: {
            projectId: { type: "string" },
            affinity: { type: "string" }
          },
          required: ["projectId"],
          additionalProperties: false
        }
      ]
    };
  }
  if (nodeIds.length === 0) return undefined;
  return {
    type: "object",
    properties: {
      nodeId: {
        type: "string",
        enum: nodeIds,
        description: `Choose a device that advertises ${tool}.`
      }
    },
    required: ["nodeId"],
    additionalProperties: false
  };
}

function inputJsonSchema(
  argsSchema: Record<string, unknown>,
  targetSchema: Record<string, unknown>,
  sideEffect: boolean,
  targetRequired: boolean
): Tool["inputSchema"] {
  return {
    type: "object",
    properties: {
      args: argsSchema,
      target: targetSchema,
      idempotencyKey: { type: "string", minLength: 8, maxLength: 256 }
    },
    required: [
      "args",
      ...(targetRequired ? ["target"] : []),
      ...(sideEffect ? ["idempotencyKey"] : [])
    ],
    additionalProperties: false
  };
}

function toolDefinition(
  context: InvocationContext,
  tool: ToolId,
  capability?: ToolCapability
): Tool | undefined {
  const targetSchema = targetJsonSchema(context, tool);
  if (!targetSchema) return;
  const builtin = isBuiltinTool(tool);
  const argsSchema = builtin
    ? (z.toJSONSchema(ToolArgsSchemas[tool], {
        target: "draft-2020-12",
        unrepresentable: "any",
        reused: "inline",
        io: "input"
      }) as Record<string, unknown>)
    : capability?.inputSchema;
  if (!argsSchema) return;
  const sideEffect = isSideEffectTool(tool);
  const targetRequired = !(builtin && controlPlaneTools.has(tool));
  return {
    name: tool,
    ...(capability?.title ? { title: capability.title } : {}),
    description: builtin ? descriptionFor(tool) : capability?.description,
    inputSchema: inputJsonSchema(argsSchema, targetSchema, sideEffect, targetRequired),
    annotations: {
      readOnlyHint: !sideEffect,
      destructiveHint: sideEffect,
      idempotentHint: sideEffect,
      openWorldHint: !builtin
    }
  };
}

export function projectToolDefinitions(
  options: Pick<McpAdapterOptions, "context" | "allowedTools">
): Tool[] {
  const allowed = options.allowedTools ?? ToolNameSchema.options;
  return allowed.flatMap((tool) => {
    const definition = toolDefinition(
      options.context,
      tool,
      options.context.toolDefinitions?.[tool]
    );
    if (!definition) return [];
    if (!isBuiltinTool(tool)) {
      const schema = options.context.toolDefinitions?.[tool]?.inputSchema;
      if (!schema) return [];
      try {
        new AjvJsonSchemaValidator().getValidator(schema as JsonSchemaType);
      } catch {
        return [];
      }
    }
    return [definition];
  });
}

export class McpInvocationAdapter {
  constructor(private readonly options: McpAdapterOptions) {}

  async invoke(tool: ToolId, input: AdapterInput): Promise<InvocationResult> {
    const context = this.options.loadContext
      ? await this.options.loadContext()
      : this.options.context;
    if (context.allowedTools && !context.allowedTools.includes(tool)) {
      throw new Error(`Agent grant no longer allows ${tool}`);
    }
    const target = input.target ?? this.options.defaultTarget;
    const nodeIds = nodeIdsForTool(context, tool);
    if (!(isBuiltinTool(tool) && controlPlaneTools.has(tool)) && nodeIds !== undefined) {
      if (!target || !("nodeId" in target)) {
        throw new Error(`target.nodeId is required for ${tool}`);
      }
      if (!nodeIds.includes(target.nodeId)) {
        throw new Error(`Device ${target.nodeId} does not advertise ${tool}`);
      }
    }
    const invocation = buildInvocation({
      context,
      tool,
      args: input.args,
      ...(target ? { target } : {}),
      source: "mcp",
      ...(input.idempotencyKey ? { idempotencyKey: input.idempotencyKey } : {})
    });
    return this.options.client.invoke(invocation);
  }
}

export function createMcpServer(options: McpAdapterOptions): Server {
  const server = new Server(
    { name: "agent-device-cloud", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  const adapter = new McpInvocationAdapter(options);
  const allowed = options.allowedTools ?? ToolNameSchema.options;
  const argsValidators = new Map<
    ToolId,
    (
      input: unknown
    ) =>
      | { valid: true; data: unknown; errorMessage: undefined }
      | { valid: false; data: undefined; errorMessage: string }
  >();
  for (const tool of allowed) {
    if (isBuiltinTool(tool)) {
      argsValidators.set(tool, (input) => {
        const parsed = ToolArgsSchemas[tool].safeParse(input);
        return parsed.success
          ? { valid: true, data: parsed.data, errorMessage: undefined }
          : { valid: false, data: undefined, errorMessage: parsed.error.message };
      });
      continue;
    }
    const schema = options.context.toolDefinitions?.[tool]?.inputSchema;
    if (schema) {
      try {
        argsValidators.set(
          tool,
          new AjvJsonSchemaValidator().getValidator(schema as JsonSchemaType)
        );
      } catch {
        // An invalid Provider schema hides only that tool.
      }
    }
  }
  const tools = projectToolDefinitions(options).filter((tool) => argsValidators.has(tool.name));
  const toolsById = new Map(tools.map((tool) => [tool.name, tool]));

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = request.params.name as ToolId;
    if (!toolsById.has(tool)) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool is not available: ${tool}`);
    }
    const input = request.params.arguments as unknown as AdapterInput;
    const validation = argsValidators.get(tool)?.(input.args);
    if (!validation?.valid) {
      throw new McpError(
        ErrorCode.InvalidParams,
        validation?.errorMessage ?? `Invalid arguments for ${tool}`
      );
    }
    try {
      const result = await adapter.invoke(tool, { ...input, args: validation.data });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        structuredContent: result as unknown as Record<string, unknown>,
        isError: !["queued", "running", "succeeded"].includes(result.status)
      };
    } catch (error) {
      throw new McpError(
        ErrorCode.InvalidParams,
        error instanceof Error ? error.message : String(error)
      );
    }
  });
  return server;
}

function descriptionFor(tool: ToolName): string {
  const descriptions: Record<ToolName, string> = {
    "device.list": "List devices visible to the current agent grant.",
    "device.status": "Get the current state of one visible device.",
    "file.list": "List an absolute path on target.nodeId.",
    "file.read": "Read a UTF-8 file by absolute path on target.nodeId.",
    "file.search": "Search text below an absolute path on target.nodeId.",
    "file.write": "Atomically write an absolute path on target.nodeId.",
    "file.edit": "Apply an exact text replacement to an absolute path on target.nodeId.",
    "file.patch": "Apply a unified diff to an absolute path on target.nodeId.",
    "shell.exec": "Run a command at an absolute cwd on target.nodeId; local policy applies.",
    "command.template.list": "List locally configured commands for the authorized folders.",
    "command.template.run": "Run a locally configured command at an absolute cwd on target.nodeId.",
    "test.run": "Run a locally configured test command at an absolute cwd on target.nodeId.",
    "task.status": "Get the state of an asynchronous invocation.",
    "task.result": "Read the terminal result of an invocation.",
    "task.cancel": "Request cancellation of an asynchronous invocation."
  };
  return descriptions[tool];
}
