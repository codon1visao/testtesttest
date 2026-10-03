import { AlertDialog } from "@astryxdesign/core/AlertDialog";

interface ConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Explicit confirmation before losing human work (F2 conflict reload, F5 discard). */
export function ConfirmDialog({
  isOpen,
  title,
  description,
  actionLabel,
  onConfirm,
  onCancel,
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
      actionVariant="destructive"
      onAction={onConfirm}
    />
  );
}
