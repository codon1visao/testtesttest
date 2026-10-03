import { Banner } from "@astryxdesign/core/Banner";
import { Button } from "@astryxdesign/core/Button";
import { Spinner } from "@astryxdesign/core/Spinner";

/** Astryx Spinner renders its own role="status" element, named by the visible label. */
export function LoadingState({ label }: { label: string }) {
  return <Spinner label={label} />;
}

export function LoadErrorState({
  title,
  reason,
  onRetry,
}: {
  title: string;
  reason: string;
  onRetry: () => void;
}) {
  return (
    <Banner
      status="error"
      title={title}
      description={reason}
      endContent={<Button label="Retry" variant="secondary" onClick={onRetry} />}
    />
  );
}
