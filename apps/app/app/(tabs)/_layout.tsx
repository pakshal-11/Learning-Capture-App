import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../src/theme";

export default function TabsLayout() {
  const c = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const icon = (name: keyof typeof Ionicons.glyphMap, solid: keyof typeof Ionicons.glyphMap) =>
    (p: { color: unknown; focused: boolean }) => <Ionicons name={p.focused ? solid : name} size={24} color={p.color as string} />;

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{
          headerShown: false,
          tabBarActiveTintColor: c.primary,
          tabBarInactiveTintColor: c.muted,
          tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border, height: 62 + insets.bottom, paddingBottom: 8 + insets.bottom, paddingTop: 6 },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "600" },
        }}
      >
        <Tabs.Screen name="index" options={{ title: "Home", tabBarIcon: icon("home-outline", "home") }} />
        <Tabs.Screen name="browse" options={{ title: "Browse", tabBarIcon: icon("library-outline", "library") }} />
        <Tabs.Screen name="stuck" options={{ title: "I'm stuck", tabBarIcon: icon("help-buoy-outline", "help-buoy") }} />
        <Tabs.Screen name="settings" options={{ title: "Settings", tabBarIcon: icon("settings-outline", "settings") }} />
      </Tabs>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Capture a learning"
        onPress={() => router.push("/capture")}
        style={({ pressed }) => ({
          position: "absolute", right: 20, bottom: 86 + insets.bottom, width: 60, height: 60, borderRadius: 30, backgroundColor: c.primary,
          alignItems: "center", justifyContent: "center", opacity: pressed ? 0.85 : 1,
          shadowColor: "#000", shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 6,
        })}
      >
        <Ionicons name="add" size={32} color={c.onPrimary} />
      </Pressable>
    </View>
  );
}
