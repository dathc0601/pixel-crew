"use client";

import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";

function ConfirmModal({ message, title = "Confirm", details, confirmLabel = "Yes", cancelLabel = "No", onConfirm, onCancel }: {
  message: string;
  title?: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <TermModal
      open={true}
      onClose={onCancel}
      maxWidth={details?.length ? 440 : 380}
      title={title}
      footer={
        <>
          <TermButton variant="dim" onClick={onCancel}>{cancelLabel}</TermButton>
          <TermButton variant="danger" onClick={onConfirm}>{confirmLabel}</TermButton>
        </>
      }
    >
      <div style={{ textAlign: details?.length ? "left" : "center", lineHeight: 1.6 }} data-testid="confirm-message">
        {message}
        {details?.length ? (
          <ul style={{ margin: "8px 0 0", paddingLeft: 18, wordBreak: "break-all" }}>
            {details.map((d) => <li key={d}>{d}</li>)}
          </ul>
        ) : null}
      </div>
    </TermModal>
  );
}

export default ConfirmModal;
