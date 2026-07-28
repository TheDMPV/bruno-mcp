import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import { discoverBruFiles, readCollectionName } from "./discovery.js";
import { parseBruEndpoint } from "./parser.js";
import { sourceHash } from "./source-hash.js";
import type {
  BrunoEndpoint,
  BrunoFolder,
  BrunoIndex,
  BrunoSourceFile,
  EndpointSearchResult,
  SearchMatchField,
  SearchOptions,
} from "./types.js";
import { packageVersion } from "./version.js";

export interface BuildIndexOptions {
  now?: () => Date;
}

async function sourceManifest(root: string): Promise<BrunoSourceFile[]> {
  const files = await discoverBruFiles(root);
  return Promise.all(
    files.map(async (file) => {
      const content = await readFile(file, "utf8");
      return {
        file: path.relative(root, file).split(path.sep).join("/"),
        hash: sourceHash(content),
      };
    }),
  );
}

function sourceFingerprint(sources: BrunoSourceFile[]): string {
  return createHash("sha256").update(JSON.stringify(sources)).digest("hex");
}

function folders(endpoints: BrunoEndpoint[]): BrunoFolder[] {
  const paths = new Set<string>();

  for (const endpoint of endpoints) {
    const parts = endpoint.folder.split("/").filter(Boolean);
    for (let index = 1; index <= parts.length; index += 1) {
      paths.add(parts.slice(0, index).join("/"));
    }
  }

  return [...paths]
    .sort((left, right) => left.localeCompare(right))
    .map((folderPath) => {
      const prefix = `${folderPath}/`;
      return {
        path: folderPath,
        name: path.posix.basename(folderPath),
        parent:
          path.posix.dirname(folderPath) === "."
            ? ""
            : path.posix.dirname(folderPath),
        endpointCount: endpoints.filter(
          (endpoint) =>
            endpoint.folder === folderPath ||
            endpoint.folder.startsWith(prefix),
        ).length,
        directEndpointCount: endpoints.filter(
          (endpoint) => endpoint.folder === folderPath,
        ).length,
      };
    });
}

export async function buildBrunoIndex(
  collectionPath: string,
  options: BuildIndexOptions = {},
): Promise<BrunoIndex> {
  const root = path.resolve(collectionPath);
  const files = await discoverBruFiles(root);
  const endpoints: BrunoEndpoint[] = [];
  const warnings: BrunoIndex["warnings"] = [];
  const sources: BrunoSourceFile[] = [];

  for (const file of files) {
    const relativeFile = path.relative(root, file).split(path.sep).join("/");
    try {
      const content = await readFile(file, "utf8");
      sources.push({
        file: relativeFile,
        hash: sourceHash(content),
      });
      const endpoint = parseBruEndpoint(content, file, root);
      if (endpoint) {
        endpoints.push(endpoint);
      }
    } catch (error) {
      warnings.push({
        file: relativeFile,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  endpoints.sort(
    (left, right) =>
      left.folder.localeCompare(right.folder) ||
      left.sequence - right.sequence ||
      left.name.localeCompare(right.name),
  );

  return {
    schemaVersion: 3,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    generator: {
      name: "@dmpv/bruno-mcp",
      version: packageVersion,
    },
    collection: {
      name: await readCollectionName(root),
      endpointCount: endpoints.length,
      sourceFingerprint: sourceFingerprint(sources),
    },
    sources,
    folders: folders(endpoints),
    endpoints,
    warnings,
  };
}

function isBrunoIndex(value: unknown): value is BrunoIndex {
  if (value === null || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<BrunoIndex>;
  return (
    candidate.schemaVersion === 3 &&
    candidate.generator?.name === "@dmpv/bruno-mcp" &&
    typeof candidate.generator.version === "string" &&
    typeof candidate.generatedAt === "string" &&
    typeof candidate.collection?.name === "string" &&
    typeof candidate.collection.sourceFingerprint === "string" &&
    Array.isArray(candidate.sources) &&
    Array.isArray(candidate.folders) &&
    Array.isArray(candidate.endpoints) &&
    candidate.endpoints.every((endpoint) =>
      Array.isArray(endpoint.derivedTags),
    ) &&
    Array.isArray(candidate.warnings)
  );
}

export async function readBrunoIndex(inputPath: string): Promise<BrunoIndex> {
  const parsed: unknown = JSON.parse(await readFile(inputPath, "utf8"));
  if (!isBrunoIndex(parsed)) {
    throw new Error("Unsupported or invalid Bruno index.");
  }
  return parsed;
}

export async function isBrunoIndexFresh(
  index: BrunoIndex,
  collectionPath: string,
): Promise<boolean> {
  const sources = await sourceManifest(path.resolve(collectionPath));
  return sourceFingerprint(sources) === index.collection.sourceFingerprint;
}

export async function writeBrunoIndex(
  index: BrunoIndex,
  outputPath: string,
): Promise<void> {
  const absoluteOutput = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  const temporaryOutput = `${absoluteOutput}.${String(process.pid)}.tmp`;
  try {
    await writeFile(
      temporaryOutput,
      `${JSON.stringify(index, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryOutput, absoluteOutput);
  } catch (error) {
    await unlink(temporaryOutput).catch(() => undefined);
    throw error;
  }
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

const SEARCH_FIELDS: Array<{
  field: SearchMatchField;
  weight: number;
  value: (endpoint: BrunoEndpoint) => string;
}> = [
  { field: "name", weight: 60, value: (endpoint) => endpoint.name },
  { field: "path", weight: 55, value: (endpoint) => endpoint.path },
  { field: "url", weight: 40, value: (endpoint) => endpoint.url },
  { field: "tags", weight: 35, value: (endpoint) => endpoint.tags.join(" ") },
  {
    field: "derivedTags",
    weight: 30,
    value: (endpoint) => endpoint.derivedTags.join(" "),
  },
  { field: "folder", weight: 25, value: (endpoint) => endpoint.folder },
  { field: "file", weight: 25, value: (endpoint) => endpoint.file },
  { field: "method", weight: 15, value: (endpoint) => endpoint.method },
  { field: "type", weight: 10, value: (endpoint) => endpoint.type },
  { field: "docs", weight: 3, value: (endpoint) => endpoint.docs },
];

function score(
  endpoint: BrunoEndpoint,
  query: string,
  searchMode: NonNullable<SearchOptions["searchMode"]>,
): Omit<EndpointSearchResult, "endpoint"> {
  if (!query) {
    return { score: 1, matchedFields: [] };
  }

  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const fields = SEARCH_FIELDS.filter(({ field }) => {
    if (searchMode === "docs") return field === "docs";
    if (searchMode === "contract") return field !== "docs";
    return true;
  }).map((entry) => ({
    ...entry,
    normalizedValue: normalized(entry.value(endpoint)),
  }));
  const matchedFields = new Set<SearchMatchField>();
  let total = 0;
  let matchedEveryTerm = true;

  for (const term of terms) {
    let matchedTerm = false;
    for (const field of fields) {
      if (!field.normalizedValue.includes(term)) continue;
      matchedTerm = true;
      matchedFields.add(field.field);
      total += field.normalizedValue === term ? field.weight * 2 : field.weight;
    }
    if (!matchedTerm) matchedEveryTerm = false;
  }

  if (!matchedEveryTerm) {
    return { score: 0, matchedFields: [] };
  }
  if (
    searchMode === "all" &&
    matchedFields.size === 1 &&
    matchedFields.has("docs")
  ) {
    return { score: 0, matchedFields: [] };
  }

  return { score: total, matchedFields: [...matchedFields] };
}

export function searchIndexWithScores(
  index: BrunoIndex,
  options: SearchOptions = {},
): EndpointSearchResult[] {
  const query = normalized(options.query ?? "");
  const method = options.method?.toUpperCase();
  const folder = normalized(options.folder ?? "");
  const pathPrefix = options.pathPrefix
    ? normalizePathPrefix(options.pathPrefix)
    : "";
  const requiredTags = (options.tags ?? []).map(normalized);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const searchMode = options.searchMode ?? "all";

  return index.endpoints
    .filter((endpoint) => {
      if (method && endpoint.method !== method) return false;
      if (options.type && endpoint.type !== options.type) return false;
      if (folder && !normalized(endpoint.folder).includes(folder)) return false;
      if (pathPrefix && !endpoint.path.startsWith(pathPrefix)) return false;
      const availableTags = [...endpoint.tags, ...endpoint.derivedTags].map(
        normalized,
      );
      if (
        requiredTags.length > 0 &&
        !requiredTags.every((requiredTag) =>
          availableTags.includes(requiredTag),
        )
      ) {
        return false;
      }
      return true;
    })
    .map((endpoint) => ({
      endpoint,
      ...score(endpoint, query, searchMode),
    }))
    .filter((result) => !query || result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.endpoint.path.localeCompare(right.endpoint.path),
    )
    .slice(0, limit);
}

export function searchIndex(
  index: BrunoIndex,
  options: SearchOptions = {},
): BrunoEndpoint[] {
  return searchIndexWithScores(index, options).map(
    (result) => result.endpoint,
  );
}

function normalizePathPrefix(value: string): string {
  const trimmed = value.trim().split(/[?#]/, 1)[0] ?? "";
  if (!trimmed) return "";
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function getEndpoint(
  index: BrunoIndex,
  input: {
    id?: string | undefined;
    method?: string | undefined;
    path?: string | undefined;
  },
): BrunoEndpoint | null {
  if (input.id) {
    return index.endpoints.find((endpoint) => endpoint.id === input.id) ?? null;
  }

  const method = input.method?.toUpperCase();
  return (
    index.endpoints.find(
      (endpoint) =>
        (!method || endpoint.method === method) &&
        (!input.path || endpoint.path === input.path),
    ) ?? null
  );
}

export class BrunoIndexStore {
  #index: BrunoIndex | null = null;
  #source: "generated" | "persistent" = "generated";
  #indexPath: string | null = null;

  constructor(
    readonly collectionPath: string,
    readonly options: { indexPath?: string | undefined } = {},
  ) {}

  async initialize(): Promise<BrunoIndex> {
    const root = path.resolve(this.collectionPath);
    const candidates = this.options.indexPath
      ? [path.resolve(this.options.indexPath)]
      : [
          path.join(root, "docs", "api-index.json"),
          path.join(root, ".bruno-mcp", "api-index.json"),
        ];

    for (const candidate of candidates) {
      try {
        const index = await readBrunoIndex(candidate);
        if (await isBrunoIndexFresh(index, root)) {
          this.#index = index;
          this.#source = "persistent";
          this.#indexPath = candidate;
          return index;
        }
      } catch {
        // Missing, stale, or incompatible indexes fall back to source parsing.
      }
    }

    return this.rebuild();
  }

  async rebuild(): Promise<BrunoIndex> {
    this.#index = await buildBrunoIndex(this.collectionPath);
    this.#source = "generated";
    this.#indexPath = null;
    return this.#index;
  }

  get source(): "generated" | "persistent" {
    return this.#source;
  }

  get indexPath(): string | null {
    return this.#indexPath;
  }

  get current(): BrunoIndex {
    if (!this.#index) {
      throw new Error("The Bruno index has not been built yet.");
    }
    return this.#index;
  }
}
