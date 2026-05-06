"use client";

import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { WalletPickerModal } from "@/components/WalletPickerModal";

type WalletPickerContextValue = {
  openPicker: () => void;
  closePicker: () => void;
};

const WalletPickerContext = createContext<WalletPickerContextValue | null>(null);

export function WalletPickerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);

  const value = useMemo<WalletPickerContextValue>(
    () => ({
      openPicker: () => setOpen(true),
      closePicker: () => setOpen(false),
    }),
    [],
  );

  return (
    <WalletPickerContext.Provider value={value}>
      {children}
      <WalletPickerModal open={open} onClose={value.closePicker} />
    </WalletPickerContext.Provider>
  );
}

export function useWalletPicker(): WalletPickerContextValue {
  const ctx = useContext(WalletPickerContext);
  if (!ctx) {
    throw new Error("useWalletPicker must be used inside WalletPickerProvider");
  }
  return ctx;
}
