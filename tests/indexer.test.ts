import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildBrunoIndex,
  getEndpoint,
  searchIndex,
} from "../src/indexer.js";

const fixture = path.resolve("tests/fixtures/sample-collection");

describe("buildBrunoIndex", () => {
  it("discovers request files and ignores environment files", async () => {
    const index = await buildBrunoIndex(fixture, {
      now: () => new Date("2026-07-27T00:00:00.000Z"),
    });

    expect(index.collection).toEqual({
      name: "Sample API",
      endpointCount: 2,
    });
    expect(index.generatedAt).toBe("2026-07-27T00:00:00.000Z");
    expect(index.warnings).toEqual([]);
    expect(index.endpoints.map((endpoint) => endpoint.method)).toEqual([
      "GET",
      "POST",
    ]);
    expect(index.endpoints[0]?.tags).toEqual(["users", "smoke"]);
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

  it("gets an endpoint by method and normalized path", async () => {
    const index = await buildBrunoIndex(fixture);
    expect(
      getEndpoint(index, { method: "GET", path: "/users/:id" }),
    ).toMatchObject({ name: "Get user" });
  });
});
