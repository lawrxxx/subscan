"use client";
// Hands a file picked on one page (e.g. the overview drop zone) to the import
// flow on another, in memory only. The file is never stored.
let pending: File | null = null;
export function setPendingUpload(f: File) {
  pending = f;
}
export function takePendingUpload(): File | null {
  const f = pending;
  pending = null;
  return f;
}
