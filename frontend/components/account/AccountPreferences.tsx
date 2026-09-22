"use client";
import { useEffect } from "react";

export function AccountPreferences() {
  useEffect(() => {
    const sync = () => { try { document.documentElement.dataset.accountDensity = localStorage.getItem("cantonstake:account-density") === "compact" ? "compact" : "comfortable"; } catch { /* Browser storage is optional. */ } };
    sync(); window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, []);
  return null;
}
