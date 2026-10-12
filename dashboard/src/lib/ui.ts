"use client";
import { create } from "zustand";

// Presentation mode: large fonts, config hidden, big A/B numbers.
interface UiState {
  presentation: boolean;
  togglePresentation: () => void;
}

export const useUi = create<UiState>((set) => ({
  presentation: false,
  togglePresentation: () => set((s) => ({ presentation: !s.presentation })),
}));
