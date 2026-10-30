import { Ionicons } from "@expo/vector-icons";
import { View } from "react-native";
import { syncAll } from "../lib/sync";
import { useStore } from "../lib/store";
import { useTheme } from "../theme";
import { Text } from "./index";

/** One quiet line: synced, syncing, or offline with how many changes are waiting. */
export function SyncLine() {
  const c = useTheme();
  const status = useStore((s) => s.sync.status);
  const error = useStore((s) => s.sync.error);
  const waiting = useStore((s) => s.outbox.length);

  let icon: keyof typeof Ionicons.glyphMap = "cloud-done-outline";
  let color = c.muted;
  let text = "Synced";
  if (status === "syncing") { icon = "sync-outline"; text = "Syncing…"; }
  else if (status === "offline") { icon = "cloud-offline-outline"; color = c.warn; text = waiting ? `Offline: ${waiting} change${waiting === 1 ? "" : "s"} waiting` : "Offline: everything is saved on this device"; }
  else if (status === "error") { icon = "alert-circle-outline"; color = c.danger; text = error ? `Sync problem: ${error.slice(0, 80)}` : "Sync problem"; }
  else if (waiting) { text = `${waiting} change${waiting === 1 ? "" : "s"} waiting to sync`; icon = "cloud-upload-outline"; }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }} accessibilityRole="text">
      <Ionicons name={icon} size={16} color={color} />
      <Text variant="small" color={color}>{text}</Text>
      {status === "offline" || status === "error" ? <Text variant="small" bold color={c.primary} onPress={() => void syncAll()}>Retry</Text> : null}
    </View>
  );
}
