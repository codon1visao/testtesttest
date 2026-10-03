import { useEffect } from "react";

/** Asks the browser to warn before leaving while unsaved work exists (F2, F5; best effort). */
export function useBeforeUnloadWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      window.removeEventListener("beforeunload", warn);
    };
  }, [active]);
}
