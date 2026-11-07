"use client";

// Promise-based confirm dialog. The dialog itself (Radix + scroll lock) loads on first use,
// so it stays out of the /office first-load bundle (plan P4.3).

import { useState, useCallback } from "react";
import dynamic from "next/dynamic";

const ConfirmModal = dynamic(() => import("./ConfirmModal"), { ssr: false });

export function useConfirm() {
  const [state, setState] = useState<{ message: string; resolve: (v: boolean) => void } | null>(null);
  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise((resolve) => {
      setState({ message, resolve });
    });
  }, []);
  const handleConfirm = useCallback(() => {
    state?.resolve(true);
    setState(null);
  }, [state]);
  const handleCancel = useCallback(() => {
    state?.resolve(false);
    setState(null);
  }, [state]);
  const modal = state ? (
    <ConfirmModal message={state.message} onConfirm={handleConfirm} onCancel={handleCancel} />
  ) : null;
  return { confirm, modal };
}
