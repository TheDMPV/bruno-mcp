import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const IGNORED_DIRECTORIES = new Set([
  ".bruno-mcp",
  ".git",
  "dist",
  "node_modules",
]);

export async function discoverBruFiles(root: string): Promise<string[]> {
  const files: string[] = [];

  async function visit(directory: string): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        const absolutePath = path.join(directory, entry.name);

        if (entry.isDirectory()) {
          if (!IGNORED_DIRECTORIES.has(entry.name)) {
            await visit(absolutePath);
          }
          return;
        }

        if (
          entry.isFile() &&
          entry.name.endsWith(".bru") &&
          entry.name !== "folder.bru"
        ) {
          files.push(absolutePath);
        }
      }),
    );
  }

  await visit(root);
  return files.sort((left, right) => left.localeCompare(right));
}

export async function readCollectionName(root: string): Promise<string> {
  try {
    const raw = await readFile(path.join(root, "bruno.json"), "utf8");
    const config = JSON.parse(raw) as { name?: unknown };
    if (typeof config.name === "string" && config.name.trim()) {
      return config.name.trim();
    }
  } catch {
    // A directory of .bru files is still useful without bruno.json.
  }

  return path.basename(root);
}

