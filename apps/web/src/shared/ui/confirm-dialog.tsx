import { AlertDialog } from "@astryxdesign/core/AlertDialog";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Losing work asks in the destructive style; a confirmation that loses nothing sets this false. */
  isDestructive?: boolean;
}

/** Explicit confirmation before losing human work (F2 conflict reload, F5 discard). */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  actionLabel,
  onConfirm,
  onCancel,
  isDestructive = true,
}: ConfirmDialogProps) {
  return (
    <AlertDialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={title}
      description={description}
      cancelLabel="Cancel"
      actionLabel={actionLabel}
      actionVariant={isDestructive ? "destructive" : "primary"}
      onAction={onConfirm}
    />
  );
}
