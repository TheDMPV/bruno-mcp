import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  BrunoIndexStore,
  buildBrunoIndex,
  getEndpoint,
  isBrunoIndexFresh,
  readBrunoIndex,
  searchIndex,
  writeBrunoIndex,
} from "../src/indexer.js";

const fixture = path.resolve("tests/fixtures/sample-collection");

describe("buildBrunoIndex", () => {
  it("discovers request files and ignores environment files", async () => {
    const index = await buildBrunoIndex(fixture, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(index.collection).toMatchObject({
      name: "Sample API",
      endpointCount: 2,
    });
    expect(index.schemaVersion).toBe(2);
    expect(index.generator).toEqual({
      name: "@dmpv/bruno-mcp",
      version: "0.3.1",
    });
    expect(index.collection.sourceFingerprint).toHaveLength(64);
    expect(index.sources).toHaveLength(3);
    expect(index.folders).toContainEqual({
      path: "users",
      name: "users",
      parent: "",
      endpointCount: 2,
      directEndpointCount: 2,
    });
    expect(index.generatedAt).toBe("2026-07-27T00:00:00.000Z");
    expect(index.warnings).toEqual([]);
    expect(index.endpoints.map((endpoint) => endpoint.method)).toEqual([
      "GET",
      "POST",
    ]);
    expect(index.endpoints[0]?.tags).toEqual(["users", "smoke"]);
    expect(index.endpoints[0]?.sourceHash).toHaveLength(64);
    expect(index.endpoints[0]?.responseExamples).toHaveLength(1);
  });

  it("writes, reads, and loads a fresh persistent index", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bruno-mcp-index-"));
    const output = path.join(directory, "api-index.json");

    try {
      const built = await buildBrunoIndex(fixture);
      await writeBrunoIndex(built, output);

      const loaded = await readBrunoIndex(output);
      expect(await isBrunoIndexFresh(loaded, fixture)).toBe(true);

      const store = new BrunoIndexStore(fixture, { indexPath: output });
      await store.initialize();
      expect(store.source).toBe("persistent");
      expect(store.indexPath).toBe(output);
      expect(store.current.collection.endpointCount).toBe(2);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("rejects a stale persistent index and rebuilds from source", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "bruno-mcp-stale-"));
    const output = path.join(directory, "api-index.json");

    try {
      const built = await buildBrunoIndex(fixture);
      built.collection.sourceFingerprint = "stale";
      await writeBrunoIndex(built, output);

      const store = new BrunoIndexStore(fixture, { indexPath: output });
      await store.initialize();
      expect(store.source).toBe("generated");
      expect(store.indexPath).toBeNull();
      expect(store.current.collection.sourceFingerprint).not.toBe("stale");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe("index queries", () => {
  it("ranks and filters endpoints", async () => {
    const index = await buildBrunoIndex(fixture);
    const matches = searchIndex(index, {
      query: "create user",
      method: "POST",
    });

    expect(matches).toHaveLength(1);
    expect(matches[0]?.name).toBe("Create user");
  });

  it("filters endpoints by normalized path prefix", async () => {
    const index = await buildBrunoIndex(fixture);
    expect(
      searchIndex(index, { pathPrefix: "users/:id", limit: 100 }).map(
        (endpoint) => endpoint.name,
      ),
    ).toEqual(["Get user"]);
  });

  it("gets an endpoint by method and normalized path", async () => {
    const index = await buildBrunoIndex(fixture);
    expect(
      getEndpoint(index, { method: "GET", path: "/users/:id" }),
    ).toMatchObject({ name: "Get user" });
  });
});
