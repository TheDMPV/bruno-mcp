import { createHash } from "node:crypto";
import path from "node:path";

import { parseRequest } from "@usebruno/filestore";

import type {
  BrunoEndpoint,
  BrunoRequestType,
  IndexedBody,
  IndexedField,
} from "./types.js";

const REQUEST_TYPES = new Set<BrunoRequestType>([
  "http-request",
  "graphql-request",
  "grpc-request",
  "ws-request",
]);

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord {
  return value !== null && typeof value === "object"
    ? (value as UnknownRecord)
    : {};
}

function string(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function number(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function fields(value: unknown): IndexedField[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    const field = record(item);
    const name = string(field.name).trim();
    if (!name) {
      return [];
    }

    const result: IndexedField = {
      name,
      enabled: field.enabled !== false,
    };
    if (typeof field.type === "string" && field.type) {
      result.type = field.type;
    }
    return [result];
  });
}

function body(value: unknown): IndexedBody {
  const source = record(value);
  const mode = string(source.mode, "none");
  const result: IndexedBody = { mode };
  const content = source[mode];

  if (content !== undefined && content !== null && content !== "") {
    result.content = content;
  }
  return result;
}

export function normalizeEndpointPath(url: string): string {
  const withoutVariables = url.replace(/^\s*\{\{[^}]+}}\s*/, "");
  try {
    const parsed = new URL(withoutVariables);
    return parsed.pathname || "/";
  } catch {
    const withoutQuery = withoutVariables.split(/[?#]/, 1)[0] ?? "";
    if (!withoutQuery) {
      return "/";
    }
    return withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  }
}

function contractHash(endpoint: Omit<BrunoEndpoint, "contractHash">): string {
  return createHash("sha256")
    .update(JSON.stringify(endpoint))
    .digest("hex");
}

function parseRequestWithoutStdout(content: string): unknown {
  const originalLog = console.log;

  try {
    // Bruno logs grammar failures with console.log before throwing. MCP reserves
    // stdout for protocol messages, so those diagnostics must not reach it.
    console.log = () => undefined;
    return parseRequest(content, { format: "bru" });
  } finally {
    console.log = originalLog;
  }
}

export function parseBruEndpoint(
  content: string,
  absoluteFile: string,
  collectionRoot: string,
): BrunoEndpoint | null {
  if (!/\bmeta\s*\{/.test(content)) {
    return null;
  }

  const parsed = record(parseRequestWithoutStdout(content));
  const type = string(parsed.type) as BrunoRequestType;
  if (!REQUEST_TYPES.has(type)) {
    return null;
  }

  const request = record(parsed.request);
  const url = string(request.url).trim();
  const name = string(parsed.name).trim();
  if (!name || !url) {
    return null;
  }

  const relativeFile = path
    .relative(collectionRoot, absoluteFile)
    .split(path.sep)
    .join("/");
  const folder = path.posix.dirname(relativeFile);
  const method = string(request.method).toUpperCase();
  const endpointWithoutHash: Omit<BrunoEndpoint, "contractHash"> = {
    id: `endpoint:${method || type}:${normalizeEndpointPath(url)}:${relativeFile}`,
    name,
    type,
    method,
    url,
    path: normalizeEndpointPath(url),
    file: relativeFile,
    folder: folder === "." ? "" : folder,
    sequence: number(parsed.seq, 1),
    tags: strings(parsed.tags),
    auth: string(record(request.auth).mode, "none"),
    headers: fields(request.headers),
    params: fields(request.params),
    body: body(request.body),
    docs: string(request.docs),
    hasTests: string(request.tests).trim().length > 0,
    assertionCount: Array.isArray(request.assertions)
      ? request.assertions.length
      : 0,
    exampleCount: Array.isArray(parsed.examples) ? parsed.examples.length : 0,
  };

  return {
    ...endpointWithoutHash,
    contractHash: contractHash(endpointWithoutHash),
  };
}

