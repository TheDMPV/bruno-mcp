import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as z from "zod/v4";

import {
  BrunoIndexStore,
  getEndpoint,
  searchIndex,
  searchIndexWithScores,
} from "./indexer.js";
import type {
  BrunoEndpoint,
  BrunoFolder,
  EndpointSearchResult,
} from "./types.js";
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
    derivedTags: endpoint.derivedTags,
    auth: endpoint.auth,
    file: endpoint.file,
    contractHash: endpoint.contractHash,
  };
}

function endpointSearchSummary(
  match: EndpointSearchResult,
): Record<string, unknown> {
  return {
    ...endpointSummary(match.endpoint),
    score: match.score,
    matchedFields: match.matchedFields,
  };
}

function folderDepth(folderPath: string): number {
  return folderPath.split("/").filter(Boolean).length;
}

function selectFolders(
  folders: BrunoFolder[],
  input: {
    parent?: string | undefined;
    depth?: number | undefined;
    offset: number;
    limit: number;
  },
) {
  const parent = input.parent?.replace(/^\/+|\/+$/g, "") ?? "";
  const parentPrefix = parent ? `${parent}/` : "";
  const baseDepth = folderDepth(parent);
  const filtered = folders.filter((folder) => {
    if (parent && !folder.path.startsWith(parentPrefix)) return false;
    const relativeDepth = folderDepth(folder.path) - baseDepth;
    return input.depth === undefined || relativeDepth <= input.depth;
  });

  return {
    total: filtered.length,
    count: Math.max(
      Math.min(input.limit, filtered.length - input.offset),
      0,
    ),
    offset: input.offset,
    limit: input.limit,
    hasMore: input.offset + input.limit < filtered.length,
    folders: filtered.slice(input.offset, input.offset + input.limit),
  };
}

function endpointContract(
  endpoint: BrunoEndpoint,
  includeExamples: boolean,
): Record<string, unknown> {
  const { responseExamples, ...contract } = endpoint;
  return includeExamples ? { ...contract, responseExamples } : contract;
}

export interface CreateServerOptions {
  watch?: boolean;
  indexPath?: string | undefined;
}

export async function createBrunoMcpServer(
  collectionPath: string,
  options: CreateServerOptions = {},
): Promise<{ server: McpServer; close: () => Promise<void> }> {
  const store = new BrunoIndexStore(collectionPath, {
    indexPath: options.indexPath,
  });
  await store.initialize();

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
    "list_folders",
    {
      title: "List Bruno collection folders",
      description:
        "Returns a paginated collection folder hierarchy. Use parent and depth to explore a subtree without loading the complete hierarchy.",
      inputSchema: {
        parent: z.string().optional(),
        depth: z.number().int().min(1).max(20).optional(),
        offset: z.number().int().min(0).default(0),
        limit: z.number().int().min(1).max(100).default(50),
      },
    },
    (input) => result(selectFolders(store.current.folders, input)),
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
        pathPrefix: z.string().optional(),
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
        "Searches endpoints with field-aware ranking. Returns score and matchedFields for every result; docs-only matches are excluded by default.",
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
        pathPrefix: z.string().optional(),
        tags: z.array(z.string()).optional(),
        search_mode: z.enum(["all", "contract", "docs"]).default("all"),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    (input) => {
      const matches = searchIndexWithScores(store.current, {
        ...input,
        searchMode: input.search_mode,
      });
      return result({
        count: matches.length,
        endpoints: matches.map(endpointSearchSummary),
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
        include_examples: z.boolean().default(false),
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
      return result({
        endpoint: endpointContract(endpoint, input.include_examples),
      });
    },
  );

  server.registerTool(
    "get_endpoints",
    {
      title: "Get multiple Bruno endpoints",
      description:
        "Returns up to 25 complete sanitized endpoint contracts by stable ID in one call. Use include_examples only when complete saved responses are required.",
      inputSchema: {
        ids: z.array(z.string().min(1)).min(1).max(25),
        include_examples: z.boolean().default(false),
      },
    },
    (input) => {
      const uniqueIds = [...new Set(input.ids)];
      const endpoints: Record<string, unknown>[] = [];
      const missingIds: string[] = [];

      for (const id of uniqueIds) {
        const endpoint = getEndpoint(store.current, { id });
        if (endpoint) {
          endpoints.push(endpointContract(endpoint, input.include_examples));
        } else {
          missingIds.push(id);
        }
      }

      return result({
        requestedCount: uniqueIds.length,
        count: endpoints.length,
        missingIds,
        endpoints,
      });
    },
  );

  server.registerTool(
    "get_endpoint_examples",
    {
      title: "Get Bruno endpoint response examples",
      description:
        "Lean examples-only alternative to get_endpoint(include_examples: true). Returns saved status, content type, and complete response bodies without the full contract.",
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

      return result({
        endpoint: endpointSummary(endpoint),
        exampleCount: endpoint.responseExamples.length,
        examples: endpoint.responseExamples,
      });
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
        generator: store.current.generator,
        source: store.source,
        indexPath: store.indexPath,
        collection: store.current.collection,
        folderCount: store.current.folders.length,
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
