import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const server = new McpServer({
  name: "adc-test-provider",
  version: "1.0.0"
});

server.registerTool(
  "echo",
  {
    description: "Echo a message from the local MCP Provider.",
    inputSchema: z.object({ message: z.string() }).strict()
  },
  async ({ message }) => ({
    content: [{ type: "text", text: `local:${message}` }],
    structuredContent: { message: `local:${message}` }
  })
);

await server.connect(new StdioServerTransport());
