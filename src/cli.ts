#!/usr/bin/env node

import path from "node:path";

import { Command } from "commander";

import {
  buildBrunoIndex,
  writeBrunoIndex,
} from "./indexer.js";
import { runStdioServer } from "./server.js";
import { packageVersion } from "./version.js";

const program = new Command()
  .name("bruno-mcp")
  .description("Index Bruno collections and expose them through MCP.")
  .version(packageVersion);

program
  .command("serve", { isDefault: true })
  .description("Start the read-only MCP server over stdio.")
  .argument("[collection]", "Bruno collection directory", ".")
  .option("--no-watch", "Disable automatic reindexing")
  .option(
    "--index <file>",
    "Persistent index to load when it matches the collection",
  )
  .action(
    async (
      collection: string,
      options: { watch: boolean; index?: string | undefined },
    ) => {
      await runStdioServer(path.resolve(collection), {
        watch: options.watch,
        indexPath: options.index ? path.resolve(options.index) : undefined,
      });
    },
  );

program
  .command("index")
  .description("Generate a persistent JSON index.")
  .argument("[collection]", "Bruno collection directory", ".")
  .option(
    "-o, --output <file>",
    "Output file",
    ".bruno-mcp/api-index.json",
  )
  .action(async (collection: string, options: { output: string }) => {
    const index = await buildBrunoIndex(collection);
    await writeBrunoIndex(index, options.output);
    process.stdout.write(
      `Indexed ${String(index.collection.endpointCount)} endpoints to ${path.resolve(options.output)}\n`,
    );
    if (index.warnings.length > 0) {
      process.stderr.write(
        `[bruno-mcp] Completed with ${String(index.warnings.length)} warning(s).\n`,
      );
    }
  });

program
  .command("inspect")
  .description("Print a collection summary without writing an index.")
  .argument("[collection]", "Bruno collection directory", ".")
  .action(async (collection: string) => {
    const index = await buildBrunoIndex(collection);
    const methods = index.endpoints.reduce<Record<string, number>>(
      (counts, endpoint) => {
        const key = endpoint.method || endpoint.type;
        counts[key] = (counts[key] ?? 0) + 1;
        return counts;
      },
      {},
    );
    process.stdout.write(
      `${JSON.stringify(
        {
          ...index.collection,
          generatedAt: index.generatedAt,
          warningCount: index.warnings.length,
          methods,
        },
        null,
        2,
      )}\n`,
    );
  });

program.parseAsync().catch((error: unknown) => {
  process.stderr.write(
    `[bruno-mcp] ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 1;
});
