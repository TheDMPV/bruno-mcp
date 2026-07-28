import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { describe, expect, it } from "vitest";

const fixture = path.resolve("tests/fixtures/sample-collection");

describe("Bruno MCP stdio server", () => {
  it(
    "exposes complete saved response examples through a dedicated tool",
    async () => {
      const client = new Client({
        name: "bruno-mcp-test",
        version: "1.0.0",
      });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          "--import",
          "tsx",
          "src/cli.ts",
          "serve",
          fixture,
          "--no-watch",
        ],
        stderr: "pipe",
      });

      try {
        await client.connect(transport);

        const tools = await client.listTools();
        expect(tools.tools.map((tool) => tool.name)).toContain(
          "get_endpoint_examples",
        );
        expect(tools.tools.map((tool) => tool.name)).toContain("get_endpoints");
        expect(tools.tools.map((tool) => tool.name)).toContain("list_folders");
        expect(tools.tools).toHaveLength(8);

        const foldersResponse = await client.callTool({
          name: "list_folders",
          arguments: { depth: 1, offset: 0, limit: 1 },
        });
        expect(foldersResponse.structuredContent).toMatchObject({
          total: 1,
          count: 1,
          hasMore: false,
          folders: [{ path: "users" }],
        });

        const searchResponse = await client.callTool({
          name: "search_endpoints",
          arguments: { query: "create user" },
        });
        const searchResult = searchResponse.structuredContent as {
          endpoints: Array<{
            id: string;
            score: number;
            matchedFields: string[];
          }>;
        };
        expect(searchResult.endpoints[0]?.score).toBeGreaterThan(0);
        expect(searchResult.endpoints[0]?.matchedFields).toContain("name");
        expect(searchResult.endpoints[0]?.matchedFields).toContain("path");

        const endpointResponse = await client.callTool({
          name: "get_endpoint",
          arguments: {
            method: "GET",
            path: "/users/:id",
            include_examples: true,
          },
        });
        const endpointResult = endpointResponse.structuredContent as {
          endpoint: { responseExamples: unknown[] };
        };
        expect(endpointResult.endpoint.responseExamples).toHaveLength(1);

        const listResponse = await client.callTool({
          name: "list_endpoints",
          arguments: { limit: 10 },
        });
        const listed = listResponse.structuredContent as {
          endpoints: Array<{ id: string }>;
        };
        const batchResponse = await client.callTool({
          name: "get_endpoints",
          arguments: {
            ids: [
              ...listed.endpoints.map((endpoint) => endpoint.id),
              "endpoint:missing",
            ],
          },
        });
        const batchResult = batchResponse.structuredContent as {
          requestedCount: number;
          count: number;
          missingIds: string[];
          endpoints: Array<Record<string, unknown>>;
        };
        expect(batchResult).toMatchObject({
          requestedCount: 3,
          count: 2,
          missingIds: ["endpoint:missing"],
        });
        expect(
          batchResult.endpoints.every(
            (endpoint) => !("responseExamples" in endpoint),
          ),
        ).toBe(true);

        const response = await client.callTool({
          name: "get_endpoint_examples",
          arguments: {
            method: "GET",
            path: "/users/:id",
          },
        });
        const structured = response.structuredContent as {
          exampleCount: number;
          examples: Array<{
            name: string;
            response: {
              status: number;
              contentType: string;
              body: { type: string; content: string };
            };
          }>;
        };

        expect(response.isError).not.toBe(true);
        expect(structured.exampleCount).toBe(1);
        expect(structured.examples[0]).toMatchObject({
          name: "user found 200",
          response: {
            status: 200,
            contentType: "application/json",
            body: {
              type: "json",
            },
          },
        });
        expect(JSON.parse(structured.examples[0]?.response.body.content ?? "")).toEqual(
          {
            id: 123,
            name: "Ada",
          },
        );
      } finally {
        await client.close();
      }
    },
    15_000,
  );
});
