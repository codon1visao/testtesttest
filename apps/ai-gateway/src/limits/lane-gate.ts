import type { GatewayLane } from "@event-desk/contracts/gateway-rpc";

/** One in-flight provider call per lane, so a batch can never take the coordinator's slot (T5 §4). */
export class LaneGate {
  private readonly busy = new Set<GatewayLane>();

  /** Claims the lane and returns its release function, or null when the lane is busy. */
  tryEnter(lane: GatewayLane): (() => void) | null {
    if (this.busy.has(lane)) return null;
    this.busy.add(lane);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.busy.delete(lane);
    };
  }
}
