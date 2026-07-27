export type BrunoRequestType =
  | "http-request"
  | "graphql-request"
  | "grpc-request"
  | "ws-request";

export interface IndexedField {
  name: string;
  enabled: boolean;
  type?: string;
}

export interface IndexedBody {
  mode: string;
  content?: unknown;
}

export interface BrunoResponseExample {
  name: string;
  description: string;
  response: {
    status: number;
    statusText: string;
    contentType: string;
    body: {
      type: string;
      content: unknown;
    };
  };
}

export interface BrunoSourceFile {
  file: string;
  hash: string;
}

export interface BrunoFolder {
  path: string;
  name: string;
  parent: string;
  endpointCount: number;
  directEndpointCount: number;
}

export interface BrunoEndpoint {
  id: string;
  name: string;
  type: BrunoRequestType;
  method: string;
  url: string;
  path: string;
  file: string;
  folder: string;
  sequence: number;
  tags: string[];
  auth: string;
  headers: IndexedField[];
  params: IndexedField[];
  body: IndexedBody;
  docs: string;
  hasTests: boolean;
  assertionCount: number;
  exampleCount: number;
  responseExamples: BrunoResponseExample[];
  sourceHash: string;
  metadata?: Record<string, string>;
  contractHash: string;
}

export interface IndexWarning {
  file: string;
  message: string;
}

export interface BrunoIndex {
  schemaVersion: 2;
  generatedAt: string;
  generator: {
    name: "@dmpv/bruno-mcp";
    version: string;
  };
  collection: {
    name: string;
    endpointCount: number;
    sourceFingerprint: string;
  };
  sources: BrunoSourceFile[];
  folders: BrunoFolder[];
  endpoints: BrunoEndpoint[];
  warnings: IndexWarning[];
}

export interface SearchOptions {
  query?: string | undefined;
  method?: string | undefined;
  type?: BrunoRequestType | undefined;
  folder?: string | undefined;
  pathPrefix?: string | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
}
