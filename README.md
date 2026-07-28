# Bruno MCP

A read-only Model Context Protocol server and indexer for
[Bruno](https://www.usebruno.com/) API collections.

Bruno MCP discovers `.bru` request files, parses them with Bruno's official
filestore package, builds a sanitized AI-oriented index, and gives MCP clients
deterministic tools for endpoint discovery. It never sends API requests.

> Status: early `0.x` release. The index schema may evolve before `1.0`.

## Features

- Automatic recursive discovery of `.bru` requests
- Official Bruno parser via `@usebruno/filestore`
- HTTP, GraphQL, gRPC, and WebSocket request indexing
- Sanitized contracts that omit header, parameter, and auth values
- Explainable, field-aware search with scores and matched fields
- Explicit and folder-derived tags
- Versioned persistent JSON index with source fingerprints
- Automatic loading of fresh `docs/api-index.json` or `.bruno-mcp/api-index.json`
- Paginated folder hierarchy with subtree/depth filtering
- Batch contract retrieval by stable endpoint IDs
- Complete saved response examples without extra source parsing
- Automatic reindexing while the MCP server is running
- A reusable TypeScript API

## Requirements

- Node.js 20.11 or newer
- A Bruno collection directory (a `bruno.json` file is recommended but not
  required)

## Quick start

Run the MCP server against a collection:

```bash
npx -y @dmpv/bruno-mcp serve ./path/to/collection
```

Generate a persistent index:

```bash
npx -y @dmpv/bruno-mcp index ./path/to/collection \
  --output ./generated/api-index.json
```

Inspect a collection without writing files:

```bash
npx -y @dmpv/bruno-mcp inspect ./path/to/collection
```

The unscoped npm name `bruno-mcp` is owned by another publisher, so this
project is distributed as `@dmpv/bruno-mcp`. Its executable is still named
`bruno-mcp`.

## MCP client configuration

Example configuration for clients that support local stdio servers:

```json
{
  "mcpServers": {
    "bruno": {
      "command": "npx",
      "args": [
        "-y",
        "@dmpv/bruno-mcp@0.4.0",
        "serve",
        "/absolute/path/to/bruno-collection"
      ]
    }
  }
}
```

Pin a version in team configuration. During local development, replace the
package command with `node /absolute/path/to/bruno-mcp/dist/cli.js`.

## MCP tools

| Tool | Purpose |
| --- | --- |
| `list_collections` | Describe the active collection |
| `list_folders` | List the folder hierarchy and endpoint counts |
| `list_endpoints` | Filter endpoint summaries |
| `search_endpoints` | Rank endpoints by a text query |
| `get_endpoint` | Get a sanitized contract by ID or method/path |
| `get_endpoints` | Get up to 25 contracts by stable ID in one call |
| `get_endpoint_examples` | Get saved response examples and complete bodies |
| `get_index_status` | Check generation time and parser warnings |

`get_endpoint` includes method, URL, normalized path, auth mode, body content,
field names, documentation, test/assertion presence, source file, and a stable
contract hash. Pass `include_examples: true` to include saved response examples
in the same call. Secret-bearing auth, header, and parameter values are not
indexed.

`get_endpoint_examples` returns examples already stored in the index, including
the saved response status, content type, and complete body, while omitting the
saved request and other response header values.

`search_endpoints` returns a numeric `score` and `matchedFields` with every
result. Its default `all` mode excludes matches found only in low-signal
documentation text. Use `search_mode: "docs"` for an intentional documentation
search, or `"contract"` to ignore docs entirely. Tag filters match both explicit
Bruno tags and `derivedTags` generated from the endpoint folder, method, request
type, and known current/legacy roots.

`list_folders` accepts `parent`, `depth`, `offset`, and `limit`. `get_endpoints`
accepts at most 25 stable IDs and reports missing IDs without failing the whole
batch.

## Index command

The generated JSON has a versioned top-level shape:

```json
{
  "schemaVersion": 3,
  "generatedAt": "2026-07-27T00:00:00.000Z",
  "generator": {
    "name": "@dmpv/bruno-mcp",
    "version": "0.4.0"
  },
  "collection": {
    "name": "Example API",
    "endpointCount": 2,
    "sourceFingerprint": "..."
  },
  "sources": [],
  "folders": [],
  "endpoints": [],
  "warnings": []
}
```

The default output is `.bruno-mcp/api-index.json`, which is ignored by Git.
Choose a tracked output path when the index is intended as a versioned build
artifact. `serve` automatically checks `docs/api-index.json` and
`.bruno-mcp/api-index.json`. It loads a persistent index only when its schema
is supported and its source fingerprint matches the current `.bru` files;
otherwise it safely rebuilds from source. Use `serve --index <file>` to select
an explicit index.

## Library API

```ts
import {
  buildBrunoIndex,
  searchIndex,
  writeBrunoIndex
} from "@dmpv/bruno-mcp";

const index = await buildBrunoIndex("./collection");
const endpoints = searchIndex(index, {
  query: "create order",
  method: "POST"
});

await writeBrunoIndex(index, "./generated/api-index.json");
```

## Development

```bash
npm install
npm run check
npm run dev -- serve ./tests/fixtures/sample-collection
```

`npm run check` runs type checking, linting, tests, a production build, and an
npm package dry run.

## Publishing

1. Confirm the npm account owns or has access to the `@dmpv` scope.
2. Add an npm automation token as the `NPM_TOKEN` repository secret.
3. Update `package.json` to the release version and merge it.
4. Push a matching version tag, such as `v0.1.0`.

The tag workflow validates the package and publishes it with npm provenance.
Publishing is intentionally not triggered by ordinary branch pushes. A GitHub
release can be created from the same tag after the package is available.

## Security and scope

Bruno MCP is read-only. Version `0.x` does not execute requests, scripts,
tests, or assertions. It only parses local files.

Body content is included because it is part of an endpoint contract. Do not
put real secrets in request bodies. Auth values, header values, and parameter
values are deliberately omitted from the index.

## License

MIT

