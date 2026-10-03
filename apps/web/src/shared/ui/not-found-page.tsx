import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";

export function NotFoundPage({ title = "Page not found" }: { title?: string }) {
  return (
    <main>
      <EmptyState
        title={title}
        headingLevel={1}
        description="Check the address, or open the Saturday Walk event."
        actions={<Button label="Open the event" href="/" />}
      />
    </main>
  );
}
