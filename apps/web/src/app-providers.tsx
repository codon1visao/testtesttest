import { LayerProvider } from "@astryxdesign/core/Layer";
import { Theme } from "@astryxdesign/core/theme";
import { useToast } from "@astryxdesign/core/Toast";
import { neutralTheme } from "@astryxdesign/theme-neutral/built";
import { QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import { createQueryClient, type ToastMessage } from "./data/query-client";
import {
  readStoredThemeMode,
  storeThemeMode,
  type ThemeMode,
  ThemeModeContext,
} from "./shared/theme/theme-mode";

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

/**
 * Light by default, never following the system setting; the top bar's switch toggles it and the
 * choice is remembered in this browser. Toasts and dialogs render inside the Theme, so they follow.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<ThemeMode>(readStoredThemeMode);
  const themeMode = useMemo(
    () => ({
      mode,
      toggle: () => {
        const next = mode === "light" ? "dark" : "light";
        storeThemeMode(next);
        setMode(next);
      },
    }),
    [mode],
  );
  return (
    <ThemeModeContext value={themeMode}>
      <Theme theme={neutralTheme} mode={mode}>
        <LayerProvider>
          <QueryProvider>{children}</QueryProvider>
        </LayerProvider>
      </Theme>
    </ThemeModeContext>
  );
}
