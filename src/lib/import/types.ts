// Statement import pipeline types. Parsers turn a file into ExtractedRows; the
// user reviews them; only reviewed rows become Transactions.

/** Plain-language reasons a row needs the user's attention. */
export const ISSUE = {
  direction: "Not sure if money came in or went out",
  amount: "Amount missing",
  date: "Date couldn't be read",
  description: "No description",
  repeat: "Appears twice in this statement",
} as const;

export interface ExtractedRow {
  id: string;
  date: string; // yyyy-mm-dd ("" when unreadable)
  description: string;
  amount: number; // positive
  direction: "debit" | "credit";
  currency: string;
  balance?: number;
  /** Problems the parser could not resolve. Rows with issues start excluded. */
  issues: string[];
  include: boolean;
  /** Set when an identical transaction already exists from an earlier import. */
  duplicateOf?: string;
  /** How the direction was decided (for the detail view); undefined when unsure. */
  directionFrom?: "columns" | "balance" | "sign" | "marker" | "type column" | "you";
  /** A guess from the wording, shown to the user only when the direction is unsure. Never applied automatically. */
  hint?: "debit" | "credit";
  /** The user chose not to import this row. */
  skipped?: boolean;
  /** Original date text when it couldn't be read. */
  rawDate?: string;
}

export interface ColumnMapping {
  date?: string;
  description?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  type?: string;
  currency?: string;
}

export interface ExtractResult {
  format: string; // human label, e.g. "CSV", "PDF · column layout"
  rows: ExtractedRow[];
  warnings: string[];
  /** CSV only: detected headers and mapping, so the user can correct it. */
  headers?: string[];
  mapping?: ColumnMapping;
  needsMapping?: boolean;
}

/** A parser for one statement format. Add new bank layouts by adding parsers. */
export interface StatementParser {
  id: string;
  label: string;
  accepts(file: { name: string; type: string }): boolean;
  extract(file: File, opts: ExtractOptions): Promise<ExtractResult>;
}

export interface ExtractOptions {
  homeCurrency: string;
  mapping?: ColumnMapping;
  password?: string;
}
