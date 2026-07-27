import { createHash } from "node:crypto";

export function normalizeSourceText(content: string): string {
  return content.replace(/\r\n?/g, "\n");
}

export function sourceHash(content: string): string {
  return createHash("sha256")
    .update(normalizeSourceText(content))
    .digest("hex");
}
