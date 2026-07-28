import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { parseCollection } from "@usebruno/filestore";

import type { BrunoSourceFormat } from "./types.js";

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  ".agents",
  ".bruno-mcp",
  ".cursor",
  ".git",
  ".github",
  ".husky",
  "dist",
  "node_modules",
]);

const COLLECTION_FILES = new Set([
  "bruno.json",
  "opencollection.yml",
  "opencollection.yaml",
]);

const NON_REQUEST_FILES = new Set([
  "collection.bru",
  "folder.bru",
  "folder.yml",
  "folder.yaml",
  "opencollection.yml",
  "opencollection.yaml",
]);

export interface DiscoveredBrunoSource {
  absolutePath: string;
  relativePath: string;
  sourceFormat: BrunoSourceFormat | null;
  isRequest: boolean;
}

interface CollectionMetadata {
  name: string;
  ignoredPaths: string[];
}

function normalizedRelative(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\/|\/$/g, "");
}

function sourceFormat(filename: string): BrunoSourceFormat | null {
  const extension = path.extname(filename).toLowerCase();
  if (extension === ".bru") return "bru";
  if (extension === ".yml" || extension === ".yaml") {
    return "opencollection-yaml";
  }
  return null;
}

function parseCollectionQuietly(content: string): unknown {
  const originalLog = console.log;
  const originalError = console.error;
  try {
    console.log = () => undefined;
    console.error = () => undefined;
    return parseCollection(content, { format: "yml" });
  } finally {
    console.log = originalLog;
    console.error = originalError;
  }
}

async function collectionMetadata(root: string): Promise<CollectionMetadata> {
  const ignoredPaths = new Set<string>();
  let name = path.basename(root);

  for (const filename of ["opencollection.yml", "opencollection.yaml"]) {
    try {
      const parsed = parseCollectionQuietly(
        await readFile(path.join(root, filename), "utf8"),
      ) as { brunoConfig?: { name?: unknown; ignore?: unknown } };
      if (typeof parsed.brunoConfig?.name === "string") {
        name = parsed.brunoConfig.name.trim() || name;
      }
      if (Array.isArray(parsed.brunoConfig?.ignore)) {
        for (const value of parsed.brunoConfig.ignore) {
          if (typeof value === "string" && value.trim()) {
            ignoredPaths.add(normalizedRelative(value.trim()));
          }
        }
      }
      break;
    } catch {
      // Fall back to bruno.json or the directory name.
    }
  }

  try {
    const config = JSON.parse(
      await readFile(path.join(root, "bruno.json"), "utf8"),
    ) as { name?: unknown; ignore?: unknown };
    if (typeof config.name === "string" && config.name.trim()) {
      name = config.name.trim();
    }
    if (Array.isArray(config.ignore)) {
      for (const value of config.ignore) {
        if (typeof value === "string" && value.trim()) {
          ignoredPaths.add(normalizedRelative(value.trim()));
        }
      }
    }
  } catch {
    // OpenCollection YAML collections do not require bruno.json.
  }

  try {
    const ignoreFile = await readFile(path.join(root, ".brunoignore"), "utf8");
    for (const line of ignoreFile.split(/\r?\n/)) {
      const value = line.trim();
      if (value && !value.startsWith("#")) {
        ignoredPaths.add(normalizedRelative(value));
      }
    }
  } catch {
    // .brunoignore is optional.
  }

  return { name, ignoredPaths: [...ignoredPaths] };
}

function isIgnored(relativePath: string, ignoredPaths: string[]): boolean {
  const normalized = normalizedRelative(relativePath);
  const firstSegment = normalized.split("/", 1)[0] ?? normalized;
  if (DEFAULT_IGNORED_DIRECTORIES.has(firstSegment)) return true;
  return ignoredPaths.some(
    (ignored) => normalized === ignored || normalized.startsWith(`${ignored}/`),
  );
}

function isRequestFile(relativePath: string): boolean {
  const normalized = normalizedRelative(relativePath);
  const filename = path.posix.basename(normalized).toLowerCase();
  if (!sourceFormat(filename) || NON_REQUEST_FILES.has(filename)) return false;
  return !normalized.startsWith("environments/");
}

export async function discoverBrunoSources(
  root: string,
): Promise<DiscoveredBrunoSource[]> {
  const metadata = await collectionMetadata(root);
  const files: DiscoveredBrunoSource[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(directory, entry.name);
        const relativePath = normalizedRelative(path.relative(root, absolutePath));
        if (isIgnored(relativePath, metadata.ignoredPaths)) return;

        if (entry.isDirectory()) {
          await visit(absolutePath);
          return;
        }
        if (!entry.isFile()) return;

        const format = sourceFormat(entry.name);
        if (
          !format &&
          !COLLECTION_FILES.has(entry.name.toLowerCase()) &&
          entry.name !== ".brunoignore"
        ) {
          return;
        }
        files.push({
          absolutePath,
          relativePath,
          sourceFormat: format,
          isRequest: isRequestFile(relativePath),
        });
      }),
    );
  }

  await visit(root);
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export async function readCollectionName(root: string): Promise<string> {
  return (await collectionMetadata(root)).name;
}
