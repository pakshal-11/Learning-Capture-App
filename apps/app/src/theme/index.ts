import { useColorScheme } from "react-native";
import { useStore } from "../lib/store";

export interface Colors {
  bg: string;
  surface: string;
  surfaceAlt: string;
  text: string;
  muted: string;
  border: string;
  primary: string;
  onPrimary: string;
  primarySoft: string;
  success: string;
  successSoft: string;
  warn: string;
  warnSoft: string;
  danger: string;
  dangerSoft: string;
  infoSoft: string;
  /** Text on solid success/danger buttons (dark mode uses light fills, so it needs dark text). */
  onStrong: string;
}

export const light: Colors = {
  bg: "#F6F6FA",
  surface: "#FFFFFF",
  surfaceAlt: "#F0F0F7",
  text: "#12131A",
  muted: "#5F6475",
  border: "#E2E4EC",
  primary: "#4F46E5",
  onPrimary: "#FFFFFF",
  primarySoft: "#E9E8FD",
  success: "#15803D",
  successSoft: "#DDF5E5",
  warn: "#B45309",
  warnSoft: "#FDF0D5",
  danger: "#B91C1C",
  dangerSoft: "#FBE0E0",
  infoSoft: "#E4EEFC",
  onStrong: "#FFFFFF",
};

export const dark: Colors = {
  bg: "#0D0E14",
  surface: "#171923",
  surfaceAlt: "#20222F",
  text: "#F1F2F6",
  muted: "#A0A5B8",
  border: "#2C2F3F",
  primary: "#6B63F0",
  onPrimary: "#FFFFFF",
  primarySoft: "#26254A",
  success: "#5BD184",
  successSoft: "#15301F",
  warn: "#F0B34D",
  warnSoft: "#35290F",
  danger: "#F27A7A",
  dangerSoft: "#3A1717",
  infoSoft: "#14263F",
  onStrong: "#0D0E14",
};

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const;
export const radius = { sm: 8, md: 12, lg: 16, pill: 999 } as const;

export function useScheme(): "light" | "dark" {
  const pref = useStore((s) => s.theme);
  const system = useColorScheme();
  return pref === "system" ? (system === "dark" ? "dark" : "light") : pref;
}

export function useTheme(): Colors {
  return useScheme() === "dark" ? dark : light;
}
