import { AppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import { colorVars, spacingVars } from "@astryxdesign/core/theme/tokens.stylex";
import * as stylex from "@stylexjs/stylex";
import type { ReactNode } from "react";
import { ThemeSwitch } from "../../shared/ui/theme-switch";

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
  // One strip: tighter vertical padding and a subtle bottom border. The bar is a size container,
  // so the row below can take exactly its width (Astryx keeps the heading slot from shrinking).
  topNav: {
    containerType: "inline-size",
    paddingBlock: spacingVars["--spacing-1-5"],
    borderBlockEndWidth: "1px",
    borderBlockEndStyle: "solid",
    borderBlockEndColor: colorVars["--color-border"],
  },
  // Title block on the left (it shrinks and wraps), the status and theme switch pinned right.
  barRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacingVars["--spacing-3"],
    width: "100cqi",
  },
  title: { flex: "1 1 auto", minWidth: 0 },
  end: {
    display: "flex",
    alignItems: "center",
    gap: spacingVars["--spacing-2"],
    flexShrink: 0,
  },
});

/**
 * The coordinator dashboard (spec 2026-10-04): an Astryx app shell whose top bar names the event,
 * with the live status (when known) and the theme switch on the right. The shell owns the page's
 * banner and main landmarks.
 */
export function EventDashboardLayout({
  heading,
  status = null,
  children,
}: {
  heading: ReactNode;
  status?: ReactNode;
  children: ReactNode;
}) {
  const bar = (
    <div {...stylex.props(styles.barRow)}>
      <div {...stylex.props(styles.title)}>{heading}</div>
      <div {...stylex.props(styles.end)}>
        {status}
        <ThemeSwitch />
      </div>
    </div>
  );
  return (
    <AppShell topNav={<TopNav label="Event Desk" heading={bar} xstyle={styles.topNav} />}>
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
