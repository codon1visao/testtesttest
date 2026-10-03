import { create } from "zustand";

/** Which briefing the editor works on when both a selected preview and a saved briefing exist. */
export type ActiveView = "preview" | "saved";

/** Cross-panel UI state only — never server data (T1, T3 §11). */
interface UiState {
  attendanceDirty: boolean;
  setAttendanceDirty: (dirty: boolean) => void;
  briefingDirty: boolean;
  setBriefingDirty: (dirty: boolean) => void;
  activeView: ActiveView;
  setActiveView: (view: ActiveView) => void;
  /** Open source disclosures, by `${disclosureScope}:${feedbackId}`; they survive editor remounts. */
  openSources: Readonly<Record<string, true>>;
  toggleSource: (key: string) => void;
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
  activeView: "preview",
  setActiveView: (activeView) => {
    set({ activeView });
  },
  openSources: {},
  toggleSource: (key) => {
    set(({ openSources }) => ({
      openSources:
        openSources[key] === true
          ? Object.fromEntries(Object.entries(openSources).filter(([open]) => open !== key))
          : { ...openSources, [key]: true },
    }));
  },
}));
