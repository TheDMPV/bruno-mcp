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
  contractHash: string;
}

export interface IndexWarning {
  file: string;
  message: string;
}

export interface BrunoIndex {
  schemaVersion: 1;
  generatedAt: string;
  collection: {
    name: string;
    endpointCount: number;
  };
  endpoints: BrunoEndpoint[];
  warnings: IndexWarning[];
}

export interface SearchOptions {
  query?: string | undefined;
  method?: string | undefined;
  type?: BrunoRequestType | undefined;
  folder?: string | undefined;
  tags?: string[] | undefined;
  limit?: number | undefined;
}
