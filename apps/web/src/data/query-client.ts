import { MutationCache, QueryClient } from "@tanstack/react-query";
import { ApiError, describeApiError } from "./http/api-error";

export interface ToastMessage {
  type: "info" | "error";
  body: string;
}
export type Notify = (toast: ToastMessage) => void;

/** Per-mutation toast text; the policy below shows exactly one toast per settled mutation (T1). */
export interface MutationToastMeta extends Record<string, unknown> {
  successToast?: string;
  errorToast?: string;
  /** Shown instead of errorToast when the request may have landed (lost response). */
  unknownOutcomeToast?: string;
}

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: ApiError;
    mutationMeta: MutationToastMeta;
  }
}

export function createQueryClient(notify: Notify): QueryClient {
  return new QueryClient({
    mutationCache: new MutationCache({
      onSuccess: (_data, _variables, _context, mutation) => {
        const body = mutation.meta?.successToast;
        if (body !== undefined) notify({ type: "info", body });
      },
      onError: (error, _variables, _context, mutation) => {
        const meta = mutation.meta;
        if (meta === undefined) return;
        // Register types errors as ApiError, but a bug can still throw anything: check, don't trust.
        if (
          error instanceof ApiError &&
          error.outcomeUnknown &&
          meta.unknownOutcomeToast !== undefined
        ) {
          notify({ type: "error", body: meta.unknownOutcomeToast });
          return;
        }
        if (meta.errorToast !== undefined)
          notify({ type: "error", body: `${meta.errorToast}: ${describeApiError(error)}` });
      },
    }),
    defaultOptions: {
      queries: { retry: false, refetchOnWindowFocus: true },
      mutations: { retry: false },
    },
  });
}
