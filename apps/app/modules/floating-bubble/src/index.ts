import { requireOptionalNativeModule } from "expo";
import { Platform } from "react-native";

interface BubbleModule {
  canDrawOverlays(): boolean;
  isRunning(): boolean;
  openOverlaySettings(): void;
  start(): boolean;
  stop(): void;
}

/** Null everywhere except an Android build that includes the native module (not Expo Go, not web). */
const native: BubbleModule | null = Platform.OS === "android" ? requireOptionalNativeModule<BubbleModule>("FloatingBubble") : null;

export const bubbleAvailable = native !== null;
export const canDrawOverlays = () => native?.canDrawOverlays() ?? false;
export const isBubbleRunning = () => native?.isRunning() ?? false;
export const openOverlaySettings = () => native?.openOverlaySettings();
export const startBubble = () => native?.start() ?? false;
export const stopBubble = () => native?.stop();
