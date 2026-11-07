"use client";

import TermModal from "./primitives/TermModal";
import TermButton from "./primitives/TermButton";

function ConfirmModal({ message, onConfirm, onCancel }: {
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <TermModal
      open={true}
      onClose={onCancel}
      maxWidth={380}
      title="Confirm"
      footer={
        <>
          <TermButton variant="dim" onClick={onCancel}>No</TermButton>
          <TermButton variant="danger" onClick={onConfirm}>Yes</TermButton>
        </>
      }
    >
      <div style={{ textAlign: "center", lineHeight: 1.6 }}>
        {message}
      </div>
    </TermModal>
  );
}

export default ConfirmModal;
