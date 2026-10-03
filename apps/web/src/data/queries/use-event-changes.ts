import type { EventId } from "@event-desk/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { queryKeys } from "./query-keys";

/** F7 "How the page learns about changes": SSE `changed` → re-fetch the cached event read. */
export function useEventChanges(eventId: EventId): { live: boolean } {
  const queryClient = useQueryClient();
  const [live, setLive] = useState(false);
  useEffect(() => {
    if (typeof EventSource === "undefined") return;
    const source = new EventSource(`/api/events/${encodeURIComponent(eventId)}/changes`);
    let dropped = false;
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) });
    };
    source.addEventListener("changed", refresh);
    source.onopen = () => {
      setLive(true);
      if (dropped) refresh(); // changes may have happened while disconnected
      dropped = false;
    };
    source.onerror = () => {
      dropped = true;
      setLive(false); // the browser reconnects by itself (retry: 3000); polling covers the gap
    };
    return () => {
      source.removeEventListener("changed", refresh);
      source.close();
    };
  }, [eventId, queryClient]);
  return { live };
}
