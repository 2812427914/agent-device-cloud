import { createHash } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/sdk/validation/ajv";
import type { JsonSchemaType } from "@modelcontextprotocol/sdk/validation/types.js";
import {
  CustomToolIdSchema,
  ErrorCodes,
  ProtocolError,
  ToolCapabilitySchema,
  type ToolCapability
} from "@adc/protocol";
import type { ExternalToolExecutor } from "@adc/tool-runtime";
import type { McpProviderConfig } from "./config.ts";

interface ProviderClient {
  listTools(params?: {
    cursor?: string;
  }): Promise<{ tools: Tool[]; nextCursor?: string | undefined }>;
  callTool(
    params: { name: string; arguments?: Record<string, unknown> },
    options?: { signal: AbortSignal }
  ): Promise<Record<string, unknown>>;
  close(): Promise<void>;
}

export type McpProviderConnector = (config: McpProviderConfig) => Promise<ProviderClient>;

interface ProviderConnection {
  fingerprint: string;
  client: ProviderClient;
  tools: RegisteredMcpTool[];
  refreshedAt: number;
}

interface RegisteredMcpTool {
  capability: ToolCapability;
  providerId: string;
  sourceToolName: string;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

function sourceSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/^[_-]+|[_-]+$/g, "")
    .slice(0, 64);
  return slug || "tool";
}

export function mcpToolId(
  providerId: string,
  sourceToolName: string,
  inputSchema: Record<string, unknown>,
  outputSchema?: Record<string, unknown>
): string {
  const schemaHash = fingerprint({
    sourceToolName,
    inputSchema,
    outputSchema: outputSchema ?? null
  }).slice(0, 8);
  return CustomToolIdSchema.parse(`mcp.${providerId}.${sourceSlug(sourceToolName)}.${schemaHash}`);
}

async function connectProvider(config: McpProviderConfig): Promise<ProviderClient> {
  const client = new Client({
    name: `adc-node-${config.providerId}`,
    version: "0.1.0"
  });
  const transport =
    config.transport === "stdio"
      ? new StdioClientTransport({
          command: config.command,
          args: config.args,
          env: { ...getDefaultEnvironment(), ...config.env },
          ...(config.cwd ? { cwd: config.cwd } : {}),
          stderr: "inherit"
        })
      : new StreamableHTTPClientTransport(new URL(config.url), {
          requestInit: { headers: config.headers }
        });
  await client.connect(transport as unknown as Transport);
  return {
    listTools: (params) => client.listTools(params),
    callTool: async (params, options) =>
      (await client.callTool(params, undefined, options)) as Record<string, unknown>,
    close: () => client.close()
  };
}

export class McpProviderManager {
  private readonly connections = new Map<string, ProviderConnection>();
  private readonly tools = new Map<string, RegisteredMcpTool>();
  private updateQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly connector: McpProviderConnector = connectProvider,
    private readonly refreshIntervalMs = 30_000
  ) {}

  update(configs: McpProviderConfig[], force = false): Promise<void> {
    this.updateQueue = this.updateQueue
      .catch(() => {})
      .then(async () => {
        const next = new Map(configs.map((config) => [config.providerId, config]));
        for (const [providerId, connection] of this.connections) {
          const config = next.get(providerId);
          if (!config || connection.fingerprint !== fingerprint(config)) {
            this.connections.delete(providerId);
            await connection.client.close().catch(() => {});
          }
        }
        for (const config of configs) {
          const existing = this.connections.get(config.providerId);
          if (existing && !force && Date.now() - existing.refreshedAt < this.refreshIntervalMs) {
            continue;
          }
          let client: ProviderClient | undefined;
          try {
            client = existing?.client ?? (await this.connector(config));
            const discovered: Tool[] = [];
            let cursor: string | undefined;
            do {
              const page = await client.listTools(cursor ? { cursor } : undefined);
              discovered.push(...page.tools);
              cursor = page.nextCursor;
              if (discovered.length > 512) {
                throw new Error("MCP Provider exposes more than 512 tools.");
              }
            } while (cursor);
            const tools = discovered.flatMap((tool) => {
              const inputSchema = tool.inputSchema as Record<string, unknown>;
              const outputSchema = tool.outputSchema as Record<string, unknown> | undefined;
              try {
                new AjvJsonSchemaValidator().getValidator(inputSchema as JsonSchemaType);
              } catch {
                return [];
              }
              const capability = ToolCapabilitySchema.safeParse({
                name: mcpToolId(config.providerId, tool.name, inputSchema, outputSchema),
                version: "1.0.0",
                risk: "execute",
                sandboxProfiles: ["full-trust"],
                ...(tool.title ? { title: tool.title } : {}),
                ...(tool.description ? { description: tool.description } : {}),
                inputSchema,
                ...(outputSchema ? { outputSchema } : {}),
                provider: {
                  kind: "mcp",
                  providerId: config.providerId,
                  providerName: config.name,
                  sourceToolName: tool.name
                }
              });
              return capability.success
                ? [
                    {
                      capability: capability.data,
                      providerId: config.providerId,
                      sourceToolName: tool.name
                    }
                  ]
                : [];
            });
            this.connections.set(config.providerId, {
              fingerprint: fingerprint(config),
              client,
              tools,
              refreshedAt: Date.now()
            });
          } catch (error) {
            this.connections.delete(config.providerId);
            await client?.close().catch(() => {});
            console.error(
              JSON.stringify({
                level: "warn",
                component: "adc-node",
                providerId: config.providerId,
                message: "MCP Provider discovery failed",
                error: error instanceof Error ? error.message : String(error)
              })
            );
          }
        }
        this.rebuildTools();
      });
    return this.updateQueue;
  }

  capabilities(): ToolCapability[] {
    return [...this.tools.values()]
      .map((tool) => tool.capability)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  readonly execute: ExternalToolExecutor = async (toolId, args, signal) => {
    const tool = this.tools.get(toolId);
    if (!tool) {
      throw new ProtocolError(
        ErrorCodes.DENIED,
        "MCP tool is not currently registered on this device",
        false,
        { toolId }
      );
    }
    const connection = this.connections.get(tool.providerId);
    if (!connection) {
      throw new ProtocolError(ErrorCodes.OFFLINE, "MCP Provider is unavailable", true, {
        providerId: tool.providerId
      });
    }
    const result = await connection.client.callTool(
      { name: tool.sourceToolName, arguments: args },
      signal ? { signal } : undefined
    );
    return {
      output: result as Record<string, unknown>,
      artifactRefs: [],
      succeeded: result.isError !== true
    };
  };

  async close(): Promise<void> {
    await this.updateQueue.catch(() => {});
    const connections = [...this.connections.values()];
    this.connections.clear();
    this.tools.clear();
    await Promise.all(connections.map((connection) => connection.client.close().catch(() => {})));
  }

  private rebuildTools(): void {
    this.tools.clear();
    for (const connection of this.connections.values()) {
      for (const tool of connection.tools) this.tools.set(tool.capability.name, tool);
    }
  }
}
