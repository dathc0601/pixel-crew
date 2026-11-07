"use client";

import { useEffect } from "react";
import { useOfficeStore } from "@/store/office-store";

/**
 * Keep the side panel on the selected agent when an external session joins the team
 * (it moves from "external" to "team") or leaves it again.
 */
export function useAttachSectionSync<S extends string>(selectedAgent: string | null, section: S, setSection: (s: S) => void): void {
  const isExternal = useOfficeStore((s) => (selectedAgent ? s.agents.get(selectedAgent)?.isExternal : undefined));
  const attached = useOfficeStore((s) => (selectedAgent ? s.agents.get(selectedAgent)?.attached : undefined));
  useEffect(() => {
    if (attached && section === "external") setSection("team" as S);
    else if (isExternal && attached === false && section === "team") setSection("external" as S);
  }, [attached, isExternal, section, setSection]);
}
