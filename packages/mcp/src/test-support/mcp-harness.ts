import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Connect an SDK `Client` to an `McpServer` over a linked in-memory transport
 * pair, so tests drive tools/resources through the public client surface
 * (`listTools`, `callTool`, `listResources`, `readResource`, `getInstructions`)
 * rather than reaching into private fields.
 *
 * Returns the connected client; the caller is responsible for nothing else —
 * the transports are GC'd with the client when the test ends.
 */
export async function connectTestClient(server: McpServer): Promise<Client> {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}
