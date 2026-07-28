import { createHash } from "node:crypto";
import path from "node:path";

import { parseRequest } from "@usebruno/filestore";

import { sourceHash } from "./source-hash.js";
import type {
  BrunoEndpoint,
  BrunoRequestType,
  BrunoResponseExample,
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

function parseRequestQuietly(content: string): unknown {
  const originalLog = console.log;
  const originalError = console.error;

  try {
    // Bruno logs some grammar failures before returning or throwing. MCP
    // reserves stdout for protocol messages, and bulk indexing should report
    // structured warnings instead of emitting parser internals.
    console.log = () => undefined;
    console.error = () => undefined;
    return parseRequest(content, { format: "bru" });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

function tag(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/([a-z\d])([A-Z])/g, "$1-$2")
    .replace(/[^a-zA-Z\d]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

function derivedTags(
  folder: string,
  method: string,
  type: BrunoRequestType,
): string[] {
  const segments = folder.split("/").filter(Boolean);
  const tags = new Set<string>();

  if (segments[0] === "endpoints") {
    tags.add("current");
    segments.shift();
  } else if (segments[0] === "endpoints-legacy") {
    tags.add("legacy");
    segments.shift();
  }

  for (const segment of segments) {
    const value = tag(segment);
    if (value) tags.add(value);
  }
  if (method) tags.add(method.toLowerCase());
  tags.add(type.replace(/-request$/, ""));
  return [...tags];
}

export function parseBruResponseExamples(
  content: string,
): BrunoResponseExample[] {
  const parsed = record(parseRequestQuietly(content));
  return responseExamples(parsed);
}

function responseExamples(parsed: UnknownRecord): BrunoResponseExample[] {
  if (!Array.isArray(parsed.examples)) {
    return [];
  }

  return parsed.examples.map((value, index) => {
    const example = record(value);
    const response = record(example.response);
    const responseBody = record(response.body);
    const responseHeaders = Array.isArray(response.headers)
      ? response.headers.map(record)
      : [];
    const contentTypeHeader = responseHeaders.find(
      (header) => string(header.name).toLowerCase() === "content-type",
    );

    return {
      name: string(example.name, `Example ${String(index + 1)}`),
      description: string(example.description),
      response: {
        status: number(response.status, 200),
        statusText: string(response.statusText, "OK"),
        contentType: string(contentTypeHeader?.value),
        body: {
          type: string(responseBody.type, "text"),
          content: responseBody.content ?? "",
        },
      },
    };
  });
}

export function parseBruEndpoint(
  content: string,
  absoluteFile: string,
  collectionRoot: string,
): BrunoEndpoint | null {
  if (!/\bmeta\s*\{/.test(content)) {
    return null;
  }

  const parsed = record(parseRequestQuietly(content));
  const type = string(parsed.type) as BrunoRequestType;
  if (!REQUEST_TYPES.has(type)) {
    return null;
  }

  const request = record(parsed.request);
  const examples = responseExamples(parsed);
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
    derivedTags: derivedTags(folder === "." ? "" : folder, method, type),
    auth: string(record(request.auth).mode, "none"),
    headers: fields(request.headers),
    params: fields(request.params),
    body: body(request.body),
    docs: string(request.docs),
    hasTests: string(request.tests).trim().length > 0,
    assertionCount: Array.isArray(request.assertions)
      ? request.assertions.length
      : 0,
    exampleCount: examples.length,
    responseExamples: examples,
    sourceHash: sourceHash(content),
  };

  return {
    ...endpointWithoutHash,
    contractHash: contractHash(endpointWithoutHash),
  };
}

