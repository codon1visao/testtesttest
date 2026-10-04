import { Icon } from "@astryxdesign/core/Icon";
import { IconButton } from "@astryxdesign/core/IconButton";
import { useThemeMode } from "../theme/theme-mode";
import { MoonIcon, SunIcon } from "./theme-icons";

/** Light ↔ dark at once; the icon shows where the switch goes (a moon in light mode). */
export function ThemeSwitch() {
  const { mode, toggle } = useThemeMode();
  const label = mode === "light" ? "Switch to dark theme" : "Switch to light theme";
  return (
    <IconButton
      variant="ghost"
      size="sm"
      label={label}
      tooltip={label}
      icon={<Icon icon={mode === "light" ? MoonIcon : SunIcon} size="sm" />}
      onClick={toggle}
    />
  );
}
