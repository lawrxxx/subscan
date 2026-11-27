"use client";
// Parser registry. To support a new bank layout, add a StatementParser here.
import { csvParser } from "./csv";
import { pdfParser } from "./pdf";
import type { ExtractOptions, ExtractResult, StatementParser } from "./types";

export const PARSERS: StatementParser[] = [pdfParser, csvParser];

export const MAX_FILE_BYTES = 15 * 1024 * 1024;

export async function extractStatement(file: File, opts: ExtractOptions): Promise<ExtractResult & { parser: string }> {
  if (file.size > MAX_FILE_BYTES) throw new Error("That file is larger than 15 MB.");
  const parser = PARSERS.find((p) => p.accepts(file));
  if (!parser) throw new Error("Unsupported file. Upload a CSV export or a digital PDF statement.");
  return { ...(await parser.extract(file, opts)), parser: parser.id };
}
