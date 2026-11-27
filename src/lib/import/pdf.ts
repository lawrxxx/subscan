"use client";
// Digital PDF statements: text is extracted in the browser with pdf.js — the file
// never leaves the device. Scanned (image-only) PDFs have no text layer; OCR is
// not supported, so we say so instead of guessing.
import type { ExtractResult, StatementParser } from "./types";
import { linesFromItems, parseStatementLines, type TextLine } from "./pdf-lines";

export class PdfPasswordError extends Error {
  incorrect: boolean;
  constructor(incorrect: boolean) {
    super(incorrect ? "That password didn’t open the PDF." : "This PDF is password-protected.");
    this.incorrect = incorrect;
  }
}

async function loadLines(data: ArrayBuffer, password?: string): Promise<TextLine[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data), password, isEvalSupported: false }).promise;
  } catch (e) {
    const err = e as { name?: string; code?: number };
    if (err?.name === "PasswordException") throw new PdfPasswordError(err.code === 2);
    throw new Error("This file couldn’t be read as a PDF.");
  }
  const lines: TextLine[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    lines.push(...linesFromItems(p, content.items.filter((it): it is Extract<typeof it, { str: string }> => "str" in it)));
  }
  await doc.destroy();
  return lines;
}

export const pdfParser: StatementParser = {
  id: "pdf",
  label: "PDF statement (digital)",
  accepts: (f) => /\.pdf$/i.test(f.name) || f.type === "application/pdf",
  async extract(file, opts): Promise<ExtractResult> {
    const lines = await loadLines(await file.arrayBuffer(), opts.password);
    const chars = lines.reduce((n, l) => n + l.items.reduce((m, i) => m + i.str.length, 0), 0);
    if (chars < 40) {
      return {
        format: "PDF",
        rows: [],
        warnings: ["This PDF has no text layer — it looks scanned or photographed. subscan reads digital statements only; download the PDF or CSV from your internet banking instead."],
      };
    }
    const { rows, layout, warnings } = parseStatementLines(lines, opts.homeCurrency);
    return { format: `PDF · ${layout}`, rows, warnings };
  },
};
