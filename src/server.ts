import { readFile } from "node:fs/promises";
import path from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  BrunoIndexStore,
  getEndpoint,
  searchIndex,
} from "./indexer.js";
import { parseBruResponseExamples } from "./parser.js";
import type { BrunoEndpoint } from "./types.js";
import { packageVersion } from "./version.js";
import { watchBrunoCollection } from "./watcher.js";

function result(value: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent: value,
  };
}

function endpointSummary(endpoint: BrunoEndpoint): Record<string, unknown> {
  return {
    id: endpoint.id,
    name: endpoint.name,
    method: endpoint.method,
    path: endpoint.path,
    type: endpoint.type,
    folder: endpoint.folder,
    tags: endpoint.tags,
    auth: endpoint.auth,
    file: endpoint.file,
    contractHash: endpoint.contractHash,
  };
}

export interface CreateServerOptions {
  watch?: boolean;
}

export async function createBrunoMcpServer(
  collectionPath: string,
  options: CreateServerOptions = {},
): Promise<{ server: McpServer; close: () => Promise<void> }> {
  const store = new BrunoIndexStore(collectionPath);
  await store.rebuild();

  const server = new McpServer({
    name: "bruno-mcp",
    version: packageVersion,
  });

  server.registerTool(
    "list_collections",
    {
      title: "List Bruno collections",
      description:
        "Returns the active Bruno collection and its endpoint count.",
      inputSchema: {},
    },
    () =>
      result({
        collections: [store.current.collection],
        warningCount: store.current.warnings.length,
      }),
  );

  server.registerTool(
    "list_endpoints",
    {
      title: "List Bruno endpoints",
      description:
        "Lists endpoint summaries, optionally filtered by method, request type, folder, or tags.",
      inputSchema: {
        method: z.string().optional(),
        type: z
          .enum([
            "http-request",
            "graphql-request",
            "grpc-request",
            "ws-request",
          ])
          .optional(),
        folder: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(100).default(50),
      },
    },
    (input) => {
      const endpoints = searchIndex(store.current, input);
      return result({
        count: endpoints.length,
        endpoints: endpoints.map(endpointSummary),
      });
    },
  );

  server.registerTool(
    "search_endpoints",
    {
      title: "Search Bruno endpoints",
      description:
        "Searches names, URLs, paths, docs, folders, files, and tags. Results are deterministic and ranked by textual relevance.",
      inputSchema: {
        query: z.string().min(1),
        method: z.string().optional(),
        type: z
          .enum([
            "http-request",
            "graphql-request",
            "grpc-request",
            "ws-request",
          ])
          .optional(),
        folder: z.string().optional(),
        tags: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    (input) => {
      const endpoints = searchIndex(store.current, input);
      return result({
        count: endpoints.length,
        endpoints: endpoints.map(endpointSummary),
      });
    },
  );

  server.registerTool(
    "get_endpoint",
    {
      title: "Get a Bruno endpoint",
      description:
        "Returns a complete sanitized endpoint contract by stable ID, or by exact method and normalized path.",
      inputSchema: {
        id: z.string().optional(),
        method: z.string().optional(),
        path: z.string().optional(),
      },
    },
    (input) => {
      if (!input.id && !input.path) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Provide id, or provide path with an optional method.",
            },
          ],
        };
      }

      const endpoint = getEndpoint(store.current, input);
      if (!endpoint) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: "Endpoint not found." },
          ],
        };
      }
      return result({ endpoint });
    },
  );

  server.registerTool(
    "get_endpoint_examples",
    {
      title: "Get Bruno endpoint response examples",
      description:
        "Returns saved response examples for an endpoint, including status, content type, and the complete response body.",
      inputSchema: {
        id: z.string().optional(),
        method: z.string().optional(),
        path: z.string().optional(),
      },
    },
    async (input) => {
      if (!input.id && !input.path) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: "Provide id, or provide path with an optional method.",
            },
          ],
        };
      }

      const endpoint = getEndpoint(store.current, input);
      if (!endpoint) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: "Endpoint not found." },
          ],
        };
      }

      const collectionRoot = path.resolve(store.collectionPath);
      const sourceFile = path.resolve(collectionRoot, endpoint.file);
      const relativeSource = path.relative(collectionRoot, sourceFile);
      if (
        relativeSource.startsWith("..") ||
        path.isAbsolute(relativeSource)
      ) {
        return {
          isError: true,
          content: [
            { type: "text" as const, text: "Invalid endpoint source path." },
          ],
        };
      }

      try {
        const examples = parseBruResponseExamples(
          await readFile(sourceFile, "utf8"),
        );
        return result({
          endpoint: endpointSummary(endpoint),
          exampleCount: examples.length,
          examples,
        });
      } catch (error) {
        return {
          isError: true,
          content: [
            {
              type: "text" as const,
              text: `Unable to read endpoint examples: ${
                error instanceof Error ? error.message : String(error)
              }`,
            },
          ],
        };
      }
    },
  );

  server.registerTool(
    "get_index_status",
    {
      title: "Get Bruno index status",
      description:
        "Returns index generation time, endpoint count, and parser warnings.",
      inputSchema: {},
    },
    () =>
      result({
        schemaVersion: store.current.schemaVersion,
        generatedAt: store.current.generatedAt,
        collection: store.current.collection,
        warnings: store.current.warnings,
      }),
  );

  const watcher =
    options.watch === false
      ? null
      : watchBrunoCollection(store, {
          onRebuild: (count) => {
            console.error(`[bruno-mcp] Reindexed ${String(count)} endpoints.`);
          },
          onError: (error) => {
            console.error("[bruno-mcp] Reindex failed:", error);
          },
        });

  return {
    server,
    close: async () => {
      await watcher?.close();
      await server.close();
    },
  };
}

export async function runStdioServer(
  collectionPath: string,
  options: CreateServerOptions = {},
): Promise<void> {
  const { server } = await createBrunoMcpServer(collectionPath, options);
  await server.connect(new StdioServerTransport());
  console.error(`[bruno-mcp] Serving ${collectionPath} over stdio.`);
}
