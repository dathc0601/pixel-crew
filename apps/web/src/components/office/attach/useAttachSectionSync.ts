"use client";

import { useState } from "react";
import { useOfficeStore } from "@/store/office-store";
import { sectionForAttachChange, type AttachSnapshot, type SideSection } from "./sidePanelSelection";

/**
 * Keep the side panel on the selected agent when an external session joins the team
 * (it moves from "external" to "team") or leaves it again. Only that change moves the
 * tab; picking another agent does not (see sectionForAttachChange). The tab is adjusted
 * while rendering, so no frame shows the joined agent in a tab that no longer lists it.
 */
export function useAttachSectionSync<S extends SideSection>(selectedAgent: string | null, section: S, setSection: (s: S) => void): void {
  const isExternal = useOfficeStore((s) => (selectedAgent ? s.agents.get(selectedAgent)?.isExternal : undefined));
  const attached = useOfficeStore((s) => (selectedAgent ? s.agents.get(selectedAgent)?.attached : undefined));
  const cur: AttachSnapshot | null = selectedAgent ? { agentId: selectedAgent, attached, isExternal } : null;
  const [seen, setSeen] = useState<AttachSnapshot | null>(cur);
  if (seen?.agentId !== cur?.agentId || seen?.attached !== cur?.attached || seen?.isExternal !== cur?.isExternal) {
    setSeen(cur);
    const next = sectionForAttachChange(seen, cur, section);
    if (next && next !== section) setSection(next as S);
  }
}
