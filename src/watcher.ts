import { watch, type FSWatcher } from "chokidar";

import type { BrunoIndexStore } from "./indexer.js";

export interface WatchOptions {
  debounceMs?: number;
  onRebuild?: (endpointCount: number) => void;
  onError?: (error: unknown) => void;
}

export function watchBrunoCollection(
  store: BrunoIndexStore,
  options: WatchOptions = {},
): FSWatcher {
  let timer: NodeJS.Timeout | undefined;
  const debounceMs = options.debounceMs ?? 150;
  const watcher = watch(store.collectionPath, {
    ignoreInitial: true,
    ignored: [
      "**/.git/**",
      "**/.bruno-mcp/**",
      "**/dist/**",
      "**/node_modules/**",
    ],
  });

  watcher.on("all", (_event, changedPath) => {
    if (!changedPath.endsWith(".bru") && !changedPath.endsWith("bruno.json")) {
      return;
    }
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      void store
        .rebuild()
        .then((index) => options.onRebuild?.(index.collection.endpointCount))
        .catch((error: unknown) => options.onError?.(error));
    }, debounceMs);
  });

  return watcher;
}
