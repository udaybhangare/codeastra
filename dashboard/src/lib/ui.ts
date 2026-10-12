"use client";
import { create } from "zustand";

// Presentation mode: large fonts, secondary panels collapsed, sidebar to icon rail, big A/B numbers.
interface UiState {
  presentation: boolean;
  togglePresentation: () => void;
  /** User's own rail preference; presentation mode and narrow viewports collapse regardless. */
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /** Mock stream only: the simulated stream has no backend to flip isolation, so the switch is local. */
  mockIsolation: "on" | "off" | null;
  setMockIsolation: (m: "on" | "off") => void;
}

export const useUi = create<UiState>((set) => ({
  presentation: false,
  togglePresentation: () => set((s) => ({ presentation: !s.presentation })),
  sidebarCollapsed: false,
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  mockIsolation: null,
  setMockIsolation: (m) => set({ mockIsolation: m }),
}));
