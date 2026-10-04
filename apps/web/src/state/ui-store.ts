import { create } from "zustand";

/** Which briefing the editor works on when both a selected preview and a saved briefing exist. */
export type ActiveView = "preview" | "saved";

/** Cross-panel UI state only — never server data (T1, T3 §11). */
interface UiState {
  attendanceDirty: boolean;
  setAttendanceDirty: (dirty: boolean) => void;
  briefingDirty: boolean;
  setBriefingDirty: (dirty: boolean) => void;
  /** The briefing editor shows its text areas: the header offers Cancel and Save, not Generate. */
  briefingEditing: boolean;
  setBriefingEditing: (editing: boolean) => void;
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  /** Open source disclosures, by item scope (`${generationId}:themes.0`); they survive editor remounts. */
  openSources: Readonly<Record<string, true>>;
  setSourceOpen: (key: string, open: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  attendanceDirty: false,
  setAttendanceDirty: (attendanceDirty) => {
    set({ attendanceDirty });
  },
  briefingDirty: false,
  setBriefingDirty: (briefingDirty) => {
    set({ briefingDirty });
  },
  briefingEditing: false,
  setBriefingEditing: (briefingEditing) => {
    set({ briefingEditing });
  },
  activeView: "preview",
  setActiveView: (activeView) => {
    set({ activeView });
  },
  openSources: {},
  setSourceOpen: (key, open) => {
    set(({ openSources }) => ({
      openSources: open
        ? { ...openSources, [key]: true }
        : Object.fromEntries(Object.entries(openSources).filter(([openKey]) => openKey !== key)),
    }));
  },
}));
