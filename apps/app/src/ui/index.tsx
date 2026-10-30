// Small UI kit: everything screens need, themed for light and dark, with 44+ px touch targets.
import { Ionicons } from "@expo/vector-icons";
import { type ReactNode } from "react";
import {
  ActivityIndicator, Pressable, ScrollView, StyleSheet, Text as RNText, TextInput, type TextInputProps, type TextStyle, View,
  type ViewStyle,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { radius, space, useTheme } from "../theme";

type IconName = keyof typeof Ionicons.glyphMap;

// ---------------------------------------------------------------------------------------- layout

export function Screen({ children, scroll = true, footer, tabs }: { children: ReactNode; scroll?: boolean; footer?: ReactNode; tabs?: boolean }) {
  const c = useTheme();
  const body = <View style={styles.content}>{children}</View>;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: c.bg }} edges={["top", "left", "right"]}>
      {scroll
        ? <ScrollView contentContainerStyle={[styles.scroll, tabs && { paddingBottom: 110 }]} keyboardShouldPersistTaps="handled">{body}</ScrollView>
        : <View style={[styles.scroll, { flex: 1 }]}>{body}</View>}
      {footer ? <View style={[styles.footer, { backgroundColor: c.bg, borderColor: c.border }]}><View style={styles.content}>{footer}</View></View> : null}
    </SafeAreaView>
  );
}

export function Row({ children, gap = space.sm, style }: { children: ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ flexDirection: "row", alignItems: "center", gap }, style]}>{children}</View>;
}

export function Stack({ children, gap = space.md, style }: { children: ReactNode; gap?: number; style?: ViewStyle }) {
  return <View style={[{ gap }, style]}>{children}</View>;
}

export function Card({ children, onPress, tone, style }: { children: ReactNode; onPress?: () => void; tone?: "primary"; style?: ViewStyle }) {
  const c = useTheme();
  const base: ViewStyle = {
    backgroundColor: tone === "primary" ? c.primarySoft : c.surface,
    borderColor: c.border,
    borderWidth: 1,
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.sm,
  };
  if (!onPress) return <View style={[base, style]}>{children}</View>;
  return <Pressable accessibilityRole="button" onPress={onPress} style={({ pressed }) => [base, style, pressed && { opacity: 0.85 }]}>{children}</Pressable>;
}

// ---------------------------------------------------------------------------------------- text

type Variant = "title" | "h2" | "body" | "small" | "label";
const sizes: Record<Variant, TextStyle> = {
  title: { fontSize: 26, fontWeight: "700", lineHeight: 32 },
  h2: { fontSize: 18, fontWeight: "600", lineHeight: 24 },
  body: { fontSize: 16, lineHeight: 23 },
  small: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: "600", lineHeight: 18, textTransform: "uppercase", letterSpacing: 0.6 },
};

export function Text({ variant = "body", muted, color, bold, center, children, style, ...rest }: {
  variant?: Variant; muted?: boolean; color?: string; bold?: boolean; center?: boolean; children?: ReactNode; style?: TextStyle;
  numberOfLines?: number; selectable?: boolean; accessibilityRole?: "header" | "link" | "text"; onPress?: () => void;
}) {
  const c = useTheme();
  return (
    <RNText
      {...rest}
      style={[sizes[variant], { color: color ?? (muted || variant === "label" ? c.muted : c.text) }, bold && { fontWeight: "700" }, center && { textAlign: "center" }, style]}
    >
      {children}
    </RNText>
  );
}

// ---------------------------------------------------------------------------------------- controls

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "success";

export function Button({ title, onPress, variant = "primary", loading, disabled, icon, small, full = true }: {
  title: string; onPress?: () => void; variant?: ButtonVariant; loading?: boolean; disabled?: boolean; icon?: IconName; small?: boolean; full?: boolean;
}) {
  const c = useTheme();
  const palette: Record<ButtonVariant, { bg: string; fg: string; border?: string }> = {
    primary: { bg: c.primary, fg: c.onPrimary },
    success: { bg: c.success, fg: c.onStrong },
    danger: { bg: c.danger, fg: c.onStrong },
    secondary: { bg: c.surface, fg: c.text, border: c.border },
    ghost: { bg: "transparent", fg: c.primary },
  };
  const p = palette[variant];
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      disabled={off}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: p.bg, borderColor: p.border ?? "transparent", borderWidth: p.border ? 1 : 0, minHeight: small ? 40 : 48, alignSelf: full ? "stretch" : "flex-start" },
        off && { opacity: 0.5 },
        pressed && { opacity: 0.85 },
      ]}
    >
      {loading ? <ActivityIndicator color={p.fg} /> : (
        <>
          {icon ? <Ionicons name={icon} size={18} color={p.fg} /> : null}
          <RNText style={{ color: p.fg, fontSize: small ? 14 : 16, fontWeight: "600" }}>{title}</RNText>
        </>
      )}
    </Pressable>
  );
}

export function Input({ label, hint, error, multiline, style, ...rest }: TextInputProps & { label?: string; hint?: string; error?: string }) {
  const c = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text variant="label">{label}</Text> : null}
      <TextInput
        placeholderTextColor={c.muted}
        multiline={multiline}
        accessibilityLabel={label}
        {...rest}
        style={[
          styles.input,
          { backgroundColor: c.surface, borderColor: error ? c.danger : c.border, color: c.text },
          multiline && { minHeight: 120, textAlignVertical: "top", paddingTop: space.md },
          style,
        ]}
      />
      {error ? <Text variant="small" color={c.danger}>{error}</Text> : hint ? <Text variant="small" muted>{hint}</Text> : null}
    </View>
  );
}

export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: selected ? c.primary : c.surface, borderColor: selected ? c.primary : c.border }]}
    >
      {icon ? <Ionicons name={icon} size={14} color={selected ? c.onPrimary : c.muted} /> : null}
      <RNText style={{ color: selected ? c.onPrimary : c.text, fontSize: 14, fontWeight: "500" }}>{label}</RNText>
    </Pressable>
  );
}

export function Tag({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "success" | "warn" | "danger" | "primary" }) {
  const c = useTheme();
  const map = {
    neutral: [c.surfaceAlt, c.muted], success: [c.successSoft, c.success], warn: [c.warnSoft, c.warn],
    danger: [c.dangerSoft, c.danger], primary: [c.primarySoft, c.primary],
  } as const;
  const [bg, fg] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 3, alignSelf: "flex-start" }}>
      <RNText style={{ color: fg, fontSize: 12, fontWeight: "600" }}>{label}</RNText>
    </View>
  );
}

export function Banner({ tone = "info", children, action }: { tone?: "info" | "warn" | "error" | "success"; children: ReactNode; action?: { label: string; onPress: () => void } }) {
  const c = useTheme();
  const map = {
    info: [c.infoSoft, c.text, "information-circle"], warn: [c.warnSoft, c.warn, "alert-circle"],
    error: [c.dangerSoft, c.danger, "close-circle"], success: [c.successSoft, c.success, "checkmark-circle"],
  } as const;
  const [bg, fg, icon] = map[tone];
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.md, padding: space.md, flexDirection: "row", gap: space.sm, alignItems: "flex-start" }} accessibilityRole="alert">
      <Ionicons name={icon as IconName} size={20} color={fg} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 6 }}>
        <RNText style={{ color: fg, fontSize: 14, lineHeight: 20 }}>{children}</RNText>
        {action ? <Pressable onPress={action.onPress} accessibilityRole="button"><RNText style={{ color: fg, fontWeight: "700", fontSize: 14 }}>{action.label}</RNText></Pressable> : null}
      </View>
    </View>
  );
}

export function Loading({ label }: { label?: string }) {
  const c = useTheme();
  return (
    <View style={{ padding: space.xl, alignItems: "center", gap: space.sm }}>
      <ActivityIndicator color={c.primary} />
      {label ? <Text variant="small" muted>{label}</Text> : null}
    </View>
  );
}

export function Empty({ icon, title, hint, children }: { icon: IconName; title: string; hint?: string; children?: ReactNode }) {
  const c = useTheme();
  return (
    <View style={{ alignItems: "center", padding: space.xl, gap: space.sm }}>
      <Ionicons name={icon} size={40} color={c.muted} />
      <Text variant="h2" center>{title}</Text>
      {hint ? <Text muted center>{hint}</Text> : null}
      {children}
    </View>
  );
}

export function ListRow({ title, subtitle, right, onPress }: { title: string; subtitle?: string; right?: ReactNode; onPress?: () => void }) {
  const c = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? "button" : undefined}
      onPress={onPress}
      style={({ pressed }) => [styles.listRow, { borderColor: c.border, backgroundColor: c.surface }, pressed && onPress ? { opacity: 0.85 } : null]}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text bold numberOfLines={2}>{title}</Text>
        {subtitle ? <Text variant="small" muted numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {right}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: { padding: space.lg, paddingBottom: space.xxl, flexGrow: 1 },
  content: { width: "100%", maxWidth: 720, alignSelf: "center", gap: space.lg },
  footer: { padding: space.lg, borderTopWidth: 1 },
  button: { borderRadius: radius.md, paddingHorizontal: space.lg, alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8 },
  input: { borderWidth: 1, borderRadius: radius.md, paddingHorizontal: space.md, paddingVertical: 12, fontSize: 16, minHeight: 48 },
  chip: { flexDirection: "row", alignItems: "center", gap: 6, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 14, paddingVertical: 9, minHeight: 40 },
  listRow: { borderWidth: 1, borderRadius: radius.md, padding: space.md, flexDirection: "row", alignItems: "center", gap: space.md, minHeight: 56 },
});
