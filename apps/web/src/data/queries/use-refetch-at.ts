import type { EventId } from "@event-desk/contracts";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { queryKeys } from "./query-keys";

const MARGIN_MS = 250;
/** First follow-up for a time that has already passed; doubles per read that still shows one. */
const FOLLOW_UP_MS = 1_000;
const MAX_FOLLOW_UP_MS = 30_000;

/**
 * Re-reads the event at each given future time (cooldown end, batch cutoff), which no server push
 * announces. `readAt` is when the times were read (the query's dataUpdatedAt): a read that returns
 * a time already past by this browser's clock (a clock ahead of the server's) gets one short
 * follow-up re-read, so the server's own clock can clear the state (M4); a state that lasts is
 * re-read less and less often.
 */
export function useRefetchAt(
  eventId: EventId,
  times: readonly (string | null | undefined)[],
  readAt: number,
): void {
  const queryClient = useQueryClient();
  const followUps = useRef(0);
  const key = times.filter((time): time is string => typeof time === "string").join("|");
  useEffect(() => {
    if (key === "") {
      followUps.current = 0;
      return;
    }
    const refetch = () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.event(eventId) });
    };
    const now = Date.now();
    const waits = key
      .split("|")
      .map((time) => Date.parse(time) - now + MARGIN_MS)
      .filter((wait) => !Number.isNaN(wait));
    const timers = waits.filter((wait) => wait > 0).map((wait) => setTimeout(refetch, wait));
    const passed = waits.some((wait) => wait <= 0);
    let pendingFollowUp = false;
    if (passed) {
      const delay = Math.min(FOLLOW_UP_MS * 2 ** followUps.current, MAX_FOLLOW_UP_MS);
      followUps.current += 1;
      pendingFollowUp = true;
      timers.push(
        setTimeout(() => {
          pendingFollowUp = false;
          refetch();
        }, delay),
      );
    } else {
      followUps.current = 0;
    }
    return () => {
      for (const timer of timers) clearTimeout(timer);
      // A follow-up that never ran (re-render, unmount) does not count towards the back-off.
      if (pendingFollowUp) followUps.current -= 1;
    };
  }, [eventId, key, queryClient, readAt]);
}
