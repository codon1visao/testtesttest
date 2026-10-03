/** A Node system error code (EADDRINUSE, EACCES…): an identifier, never free text. */
const SAFE_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;

export interface ErrorMetadata {
  errorClass: string;
  code?: string;
}

/** Loggable facts about a failure: its class and a safe code, never its message or stack (S1). */
export function errorMetadata(error: unknown): ErrorMetadata {
  if (!(error instanceof Error)) return { errorClass: typeof error };
  const code = "code" in error ? error.code : undefined;
  return typeof code === "string" && SAFE_CODE.test(code)
    ? { errorClass: error.name, code }
    : { errorClass: error.name };
}
