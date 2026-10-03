import { LayerProvider } from "@astryxdesign/core/Layer";
import { Theme } from "@astryxdesign/core/theme";
import { useToast } from "@astryxdesign/core/Toast";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import { createQueryClient, type ToastMessage } from "./data/query-client";

type ShowToast = ReturnType<typeof useToast>;

/** A stable notify target whose `showToast` can be swapped, so the once-created QueryClient never goes stale. */
function createToastSink(initial: ShowToast) {
  let current = initial;
  return {
    setShowToast: (next: ShowToast) => {
      current = next;
    },
    notify: (toast: ToastMessage) => {
      current({ type: toast.type, body: toast.body });
    },
  };
}

/** Owns the QueryClient and connects its toast policy to Astryx toasts (needs LayerProvider above). */
function QueryProvider({ children }: { children: ReactNode }) {
  const showToast = useToast();
  const [toastSink] = useState(() => createToastSink(showToast));
  useEffect(() => {
    toastSink.setShowToast(showToast);
  }, [toastSink, showToast]);
  const [queryClient] = useState(() => createQueryClient(toastSink.notify));
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <Theme theme={neutralTheme}>
      <LayerProvider>
        <QueryProvider>{children}</QueryProvider>
      </LayerProvider>
    </Theme>
  );
}
