import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { discoverBruFiles, readCollectionName } from "./discovery.js";
import { parseBruEndpoint } from "./parser.js";
import type { BrunoEndpoint, BrunoIndex, SearchOptions } from "./types.js";

export interface BuildIndexOptions {
  now?: () => Date;
}

export async function buildBrunoIndex(
  collectionPath: string,
  options: BuildIndexOptions = {},
): Promise<BrunoIndex> {
  const root = path.resolve(collectionPath);
  const files = await discoverBruFiles(root);
  const endpoints: BrunoEndpoint[] = [];
  const warnings: BrunoIndex["warnings"] = [];

  for (const file of files) {
    const relativeFile = path.relative(root, file).split(path.sep).join("/");
    try {
      const endpoint = parseBruEndpoint(await readFile(file, "utf8"), file, root);
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
    schemaVersion: 1,
    generatedAt: (options.now?.() ?? new Date()).toISOString(),
    collection: {
      name: await readCollectionName(root),
      endpointCount: endpoints.length,
    },
    endpoints,
    warnings,
  };
}

export async function writeBrunoIndex(
  index: BrunoIndex,
  outputPath: string,
): Promise<void> {
  const absoluteOutput = path.resolve(outputPath);
  await mkdir(path.dirname(absoluteOutput), { recursive: true });
  await writeFile(absoluteOutput, `${JSON.stringify(index, null, 2)}\n`, "utf8");
}

function normalized(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

function score(endpoint: BrunoEndpoint, query: string): number {
  if (!query) {
    return 1;
  }

  const terms = normalized(query).split(/\s+/).filter(Boolean);
  const name = normalized(endpoint.name);
  const pathValue = normalized(endpoint.path);
  const searchable = normalized(
    [
      endpoint.name,
      endpoint.method,
      endpoint.url,
      endpoint.path,
      endpoint.file,
      endpoint.folder,
      endpoint.docs,
      ...endpoint.tags,
    ].join(" "),
  );

  return terms.reduce((total, term) => {
    if (name === term || pathValue === term) {
      return total + 25;
    }
    if (name.includes(term) || pathValue.includes(term)) {
      return total + 12;
    }
    return searchable.includes(term) ? total + 4 : total;
  }, 0);
}

export function searchIndex(
  index: BrunoIndex,
  options: SearchOptions = {},
): BrunoEndpoint[] {
  const query = normalized(options.query ?? "");
  const method = options.method?.toUpperCase();
  const folder = normalized(options.folder ?? "");
  const requiredTags = (options.tags ?? []).map(normalized);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);

  return index.endpoints
    .filter((endpoint) => {
      if (method && endpoint.method !== method) return false;
      if (options.type && endpoint.type !== options.type) return false;
      if (folder && !normalized(endpoint.folder).includes(folder)) return false;
      if (
        requiredTags.length > 0 &&
        !requiredTags.every((tag) => endpoint.tags.map(normalized).includes(tag))
      ) {
        return false;
      }
      return true;
    })
    .map((endpoint) => ({ endpoint, score: score(endpoint, query) }))
    .filter((result) => !query || result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.endpoint.path.localeCompare(right.endpoint.path),
    )
    .slice(0, limit)
    .map((result) => result.endpoint);
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

  constructor(readonly collectionPath: string) {}

  async rebuild(): Promise<BrunoIndex> {
    this.#index = await buildBrunoIndex(this.collectionPath);
    return this.#index;
  }

  get current(): BrunoIndex {
    if (!this.#index) {
      throw new Error("The Bruno index has not been built yet.");
    }
    return this.#index;
  }
}
