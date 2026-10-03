import type { EventId } from "@event-desk/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { queryKeys } from "./query-keys";

const MARGIN_MS = 250;

/** Re-reads the event at each given future time (cooldown end, batch cutoff), which no server push announces. */
export function useRefetchAt(
  eventId: EventId,
  times: readonly (string | null | undefined)[],
): void {
  const queryClient = useQueryClient();
  const key = times.filter((time): time is string => typeof time === "string").join("|");
  useEffect(() => {
    if (key === "") return;
    const timers = key.split("|").flatMap((time) => {
      const wait = Date.parse(time) - Date.now() + MARGIN_MS;
      if (!(wait > 0)) return [];
      return [
        setTimeout(() => {
          void queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) });
        }, wait),
      ];
    });
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [eventId, key, queryClient]);
}
