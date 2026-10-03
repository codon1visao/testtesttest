import { Banner } from "@astryxdesign/core/Banner";
import { Component, type ReactNode } from "react";

interface Props {
  name: string;
  children: ReactNode;
}

/** One failing panel never blanks the page (T3 §10: an error boundary per panel). */
export class PanelErrorBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <Banner
          status="error"
          title={`${this.props.name} could not be displayed`}
          description="Reload the page to try again. Other panels are unaffected."
        />
      );
    }
    return this.props.children;
  }
}
