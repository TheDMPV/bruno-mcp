import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  normalizeEndpointPath,
  parseBruEndpoint,
} from "../src/parser.js";

describe("normalizeEndpointPath", () => {
  it("removes a Bruno base URL variable and query string", () => {
    expect(normalizeEndpointPath("{{baseUrl}}/users/:id?expand=profile")).toBe(
      "/users/:id",
    );
  });

  it("extracts the path from absolute URLs", () => {
    expect(normalizeEndpointPath("https://api.example.com/v1/users")).toBe(
      "/v1/users",
    );
  });
});

describe("parseBruEndpoint", () => {
  it("parses and sanitizes an HTTP request", () => {
    const root = path.resolve("tests/fixtures/sample-collection");
    const file = path.join(root, "example.bru");
    const endpoint = parseBruEndpoint(
      `meta {
  name: Get secrets safely
  type: http
  seq: 1
}

get {
  url: {{baseUrl}}/secrets
  body: none
  auth: bearer
}

headers {
  Authorization: Bearer super-secret
}`,
      file,
      root,
    );

    expect(endpoint).toMatchObject({
      name: "Get secrets safely",
      method: "GET",
      path: "/secrets",
      auth: "bearer",
      headers: [{ name: "Authorization", enabled: true }],
    });
    expect(JSON.stringify(endpoint)).not.toContain("super-secret");
  });
});

