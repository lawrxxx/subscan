export function validEmail(e: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e.trim());
}
export function passwordProblem(p: string): string | undefined {
  if (p.length < 8) return "Use at least 8 characters.";
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return "Mix letters and numbers.";
  return undefined;
}
