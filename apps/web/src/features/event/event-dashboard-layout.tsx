import { AppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";

const styles = stylex.create({
  content: {
    boxSizing: "border-box",
    width: "100%",
    maxWidth: 1440,
    marginInline: "auto",
    padding: "1.5rem",
  },
  grid: {
    display: "grid",
    gap: "1.5rem",
    alignItems: "start",
    gridTemplateColumns: {
      default: "minmax(0, 1fr)",
      "@media (min-width: 900px)": "minmax(0, 2fr) minmax(0, 1fr)",
    },
  },
  column: { display: "flex", flexDirection: "column", gap: "1.5rem", minWidth: 0 },
});

/**
 * The coordinator dashboard (spec 2026-10-04): an Astryx app shell whose top bar names the event.
 * The shell owns the page's banner and main landmarks.
 */
export function EventDashboardLayout({
  heading,
  children,
}: {
  heading: ReactNode;
  children: ReactNode;
}) {
  return (
    <AppShell topNav={<TopNav label="Event Desk" heading={heading} />}>
      <div {...stylex.props(styles.content)}>{children}</div>
    </AppShell>
  );
}

/** Briefing in the wide main column; attendance and feedback beside it, stacked below 900 px. */
export function DashboardGrid({ main, side }: { main: ReactNode; side: ReactNode }) {
  return (
    <div {...stylex.props(styles.grid)}>
      <div {...stylex.props(styles.column)}>{main}</div>
      <div {...stylex.props(styles.column)}>{side}</div>
    </div>
  );
}
