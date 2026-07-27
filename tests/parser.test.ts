import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  normalizeEndpointPath,
  parseBruEndpoint,
  parseBruResponseExamples,
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

  it("keeps Bruno parser failures off stdout and restores the logger", () => {
    const root = path.resolve("tests/fixtures/sample-collection");
    const file = path.join(root, "broken.bru");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const error = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    try {
      expect(() =>
        parseBruEndpoint(
          `meta {
  name: Broken request
  type: http
  seq: 1
`,
          file,
          root,
        ),
      ).toThrow();
      expect(log).not.toHaveBeenCalled();
      expect(error).not.toHaveBeenCalled();
      expect(console.log).toBe(log);
      expect(console.error).toBe(error);
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  });
});

describe("parseBruResponseExamples", () => {
  it("returns complete saved response bodies without request data", () => {
    const examples = parseBruResponseExamples(`meta {
  name: Get user
  type: http
  seq: 1
}

get {
  url: {{baseUrl}}/users/123
  body: none
  auth: none
}

example {
  name: user found 200
  description: A saved user response.

  request: {
    url: {{baseUrl}}/users/123
    method: GET
    mode: none
  }

  response: {
    headers: {
      content-type: application/json
      set-cookie: session=not-exposed
    }

    status: {
      code: 200
      text: OK
    }

    body: {
      type: json
      content: '''
        {
          "id": 123,
          "name": "Ada"
        }
      '''
    }
  }
}`);

    expect(examples).toEqual([
      {
        name: "user found 200",
        description: "A saved user response.",
        response: {
          status: 200,
          statusText: "OK",
          contentType: "application/json",
          body: {
            type: "json",
            content: `{
  "id": 123,
  "name": "Ada"
}`,
          },
        },
      },
    ]);
    expect(JSON.stringify(examples)).not.toContain("not-exposed");
  });
});

