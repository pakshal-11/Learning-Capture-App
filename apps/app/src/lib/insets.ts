import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

// The browser measurement of the bottom safe area is unreliable on iPhone Safari (it once reported ~440px,
// which stretched the tab bar over half the screen). The real home-indicator inset is at most ~34px, so cap it on the web.
const WEB_MAX_BOTTOM = 34;

export function useBottomInset(): number {
  const { bottom } = useSafeAreaInsets();
  return Platform.OS === "web" ? Math.min(bottom, WEB_MAX_BOTTOM) : bottom;
}
