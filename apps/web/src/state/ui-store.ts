import { create } from "zustand";

/** Cross-panel UI state only — never server data (T1, T3 §11). */
interface UiState {
  attendanceDirty: boolean;
  setAttendanceDirty: (dirty: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  attendanceDirty: false,
  setAttendanceDirty: (attendanceDirty) => {
    set({ attendanceDirty });
  },
}));
