import { useLocalSearchParams, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { PRIVACY_SUMMARY } from "../src/content/privacy";
import { normalizeProfile } from "../src/lib/sync";
import { supabase } from "../src/lib/supabase";
import { useStore } from "../src/lib/store";
import { deviceTimezone, fmtTime, parseTimeInput } from "../src/lib/time";
import { CONSENT_VERSION } from "../src/lib/types";
import { useTheme } from "../src/theme";
import { Banner, Button, Card, Chip, Input, Row, Screen, Stack, Text } from "../src/ui";
import { Pressable, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

const YEARS = ["1st year", "2nd year", "3rd year", "4th year", "Postgraduate", "Other"];
const LEVELS = ["Beginner", "Junior (0-2 yrs)", "Mid (3-6 yrs)", "Senior (7+ yrs)", "Leader"];
const GOALS = ["Get better at my job", "Learn a new skill", "Crack an exam", "Build a project", "Switch careers", "Stay curious"];
const INTERESTS = ["Technology", "Business", "Finance", "Health", "Science", "Design", "Languages", "Writing", "Marketing", "Career"];
const LANGUAGES = ["English", "Hindi", "Marathi", "Gujarati", "Tamil", "Telugu", "Bengali", "Kannada", "Malayalam", "Punjabi"];
const TIMES = ["07:00", "08:00", "12:30", "18:00", "20:00", "21:30"];

type Step = "role" | "details" | "goals" | "language" | "reminders" | "consent";

function MultiPick({ options, value, onChange, max = 5, placeholder }: {
  options: string[]; value: string[]; onChange: (v: string[]) => void; max?: number; placeholder: string;
}) {
  const [custom, setCustom] = useState("");
  const all = [...options, ...value.filter((v) => !options.includes(v))];
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((v) => v !== o) : value.length < max ? [...value, o] : value);
  const add = () => {
    const t = custom.trim().slice(0, 60);
    if (t && !value.includes(t) && value.length < max) onChange([...value, t]);
    setCustom("");
  };
  return (
    <Stack gap={10}>
      <Row style={{ flexWrap: "wrap" }}>
        {all.map((o) => <Chip key={o} label={o} selected={value.includes(o)} onPress={() => toggle(o)} />)}
      </Row>
      <Row>
        <View style={{ flex: 1 }}>
          <Input value={custom} onChangeText={setCustom} placeholder={placeholder} onSubmitEditing={add} maxLength={60} />
        </View>
        <Button title="Add" variant="secondary" onPress={add} full={false} disabled={!custom.trim()} />
      </Row>
      <Text variant="small" muted>Pick up to {max}.</Text>
    </Stack>
  );
}

function Check({ checked, onToggle, children }: { checked: boolean; onToggle: () => void; children: React.ReactNode }) {
  const c = useTheme();
  return (
    <Pressable onPress={onToggle} accessibilityRole="checkbox" accessibilityState={{ checked }} style={{ flexDirection: "row", gap: 10, alignItems: "flex-start", minHeight: 44 }}>
      <Ionicons name={checked ? "checkbox" : "square-outline"} size={26} color={checked ? c.primary : c.muted} />
      <View style={{ flex: 1, paddingTop: 2 }}>{children}</View>
    </Pressable>
  );
}

export default function Onboarding() {
  const router = useRouter();
  const { edit } = useLocalSearchParams<{ edit?: string }>();
  const isEdit = edit === "1";
  const profile = useStore((s) => s.profile);
  const userId = useStore((s) => s.userId);

  const steps = useMemo<Step[]>(() => (isEdit ? ["role", "details", "goals", "language", "reminders"] : ["role", "details", "goals", "language", "reminders", "consent"]), [isEdit]);
  const [i, setI] = useState(0);
  const step = steps[i]!;

  const [role, setRole] = useState<"student" | "professional" | null>(profile?.role_type ?? null);
  const [field, setField] = useState(profile?.field_of_study ?? "");
  const [year, setYear] = useState(profile?.year ?? "");
  const [profession, setProfession] = useState(profile?.profession ?? "");
  const [industry, setIndustry] = useState(profile?.industry ?? "");
  const [roleTitle, setRoleTitle] = useState(profile?.role_title ?? "");
  const [level, setLevel] = useState(profile?.experience_level ?? "");
  const [goals, setGoals] = useState<string[]>(profile?.goals ?? []);
  const [interests, setInterests] = useState<string[]>(profile?.interests ?? []);
  const [language, setLanguage] = useState(profile?.language ?? "English");
  const [times, setTimes] = useState<string[]>(profile?.reminder_times ?? ["20:00"]);
  const [customTime, setCustomTime] = useState("");
  const [adult, setAdult] = useState(false);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const detailsOk = role === "student" ? !!field.trim() && !!year : !!profession.trim() && !!level;
  const canNext =
    step === "role" ? !!role : step === "details" ? detailsOk : step === "goals" ? goals.length > 0 : step === "language" ? !!language.trim()
      : step === "reminders" ? true : adult && agree;

  const addTime = () => {
    const t = parseTimeInput(customTime);
    if (!t) return setError("Use a time like 07:30 or 21:00.");
    setError(null);
    if (!times.includes(t) && times.length < 3) setTimes([...times, t].sort());
    setCustomTime("");
  };

  async function finish() {
    if (!userId) return;
    setBusy(true);
    setError(null);
    const student = role === "student";
    const patch: Record<string, unknown> = {
      role_type: role,
      field_of_study: student ? field.trim() : null,
      year: student ? year : null,
      profession: student ? null : profession.trim(),
      industry: student ? null : industry.trim() || null,
      role_title: student ? null : roleTitle.trim() || null,
      experience_level: student ? null : level,
      goals, interests,
      language: language.trim(),
      reminder_times: [...times].sort(),
      timezone: deviceTimezone(),
    };
    if (!isEdit) Object.assign(patch, { is_adult_confirmed: true, consent_version: CONSENT_VERSION, consent_at: new Date().toISOString() });
    const { data, error: e } = await supabase.from("profiles").update(patch).eq("id", userId).select("*").single();
    setBusy(false);
    if (e || !data) return setError(/fetch|network/i.test(e?.message ?? "") ? "You're offline. Connect to the internet to finish." : "Could not save. Please try again.");
    useStore.getState().setProfile(normalizeProfile(data));
    if (isEdit) router.back();
    else router.replace("/");
  }

  const next = () => (i < steps.length - 1 ? setI(i + 1) : void finish());

  return (
    <Screen
      footer={
        <Row>
          {i > 0 ? <View style={{ flex: 1 }}><Button title="Back" variant="secondary" onPress={() => setI(i - 1)} /></View> : isEdit ? <View style={{ flex: 1 }}><Button title="Cancel" variant="secondary" onPress={() => router.back()} /></View> : null}
          <View style={{ flex: 2 }}><Button title={i === steps.length - 1 ? (isEdit ? "Save" : "Finish") : "Next"} onPress={next} disabled={!canNext} loading={busy} /></View>
        </Row>
      }
    >
      <Stack gap={20}>
        <Stack gap={4}>
          <Text variant="small" muted>Step {i + 1} of {steps.length}</Text>
          <Text variant="title" accessibilityRole="header">
            {step === "role" ? "Who are you?" : step === "details" ? (role === "student" ? "Your studies" : "Your work") : step === "goals" ? "What do you want from this?" : step === "language" ? "Language" : step === "reminders" ? "Daily reminder" : "Privacy and consent"}
          </Text>
          <Text muted>
            {step === "role" ? "This helps the AI pick the right tone and examples." : step === "goals" ? "Goals and interests shape the examples you get." : step === "language" ? "AI replies and questions will use this language." : step === "reminders" ? "When should we nudge you to review? Up to 3 times." : step === "consent" ? "Two quick confirmations." : ""}
          </Text>
        </Stack>

        {step === "role" ? (
          <Stack>
            <Card onPress={() => setRole("student")} tone={role === "student" ? "primary" : undefined}><Text variant="h2">Student</Text><Text muted>School, college or exam prep</Text></Card>
            <Card onPress={() => setRole("professional")} tone={role === "professional" ? "primary" : undefined}><Text variant="h2">Working professional</Text><Text muted>Learning on the job or for your career</Text></Card>
          </Stack>
        ) : null}

        {step === "details" && role === "student" ? (
          <Stack>
            <Input label="Field of study" value={field} onChangeText={setField} placeholder="e.g. Computer Science" maxLength={100} />
            <Text variant="label">Year</Text>
            <Row style={{ flexWrap: "wrap" }}>{YEARS.map((y) => <Chip key={y} label={y} selected={year === y} onPress={() => setYear(y)} />)}</Row>
          </Stack>
        ) : null}

        {step === "details" && role === "professional" ? (
          <Stack>
            <Input label="Profession" value={profession} onChangeText={setProfession} placeholder="e.g. Product designer" maxLength={100} />
            <Input label="Industry (optional)" value={industry} onChangeText={setIndustry} placeholder="e.g. Fintech" maxLength={100} />
            <Input label="Role (optional)" value={roleTitle} onChangeText={setRoleTitle} placeholder="e.g. Senior designer" maxLength={100} />
            <Text variant="label">Experience level</Text>
            <Row style={{ flexWrap: "wrap" }}>{LEVELS.map((l) => <Chip key={l} label={l} selected={level === l} onPress={() => setLevel(l)} />)}</Row>
          </Stack>
        ) : null}

        {step === "goals" ? (
          <Stack gap={20}>
            <Stack><Text variant="label">Learning goals (pick at least 1)</Text><MultiPick options={GOALS} value={goals} onChange={setGoals} placeholder="Add your own goal" /></Stack>
            <Stack><Text variant="label">Interests (optional)</Text><MultiPick options={INTERESTS} value={interests} onChange={setInterests} placeholder="Add an interest" /></Stack>
          </Stack>
        ) : null}

        {step === "language" ? (
          <Stack>
            <Row style={{ flexWrap: "wrap" }}>{[...LANGUAGES, ...(LANGUAGES.includes(language) ? [] : [language])].map((l) => <Chip key={l} label={l} selected={language === l} onPress={() => setLanguage(l)} />)}</Row>
            <Input label="Other language" value={LANGUAGES.includes(language) ? "" : language} onChangeText={setLanguage} placeholder="Type a language" maxLength={40} />
            <Banner tone="info">Search by meaning works best in English. Notes in other languages still work, but matches may be weaker.</Banner>
          </Stack>
        ) : null}

        {step === "reminders" ? (
          <Stack>
            <Row style={{ flexWrap: "wrap" }}>
              {[...TIMES, ...times.filter((t) => !TIMES.includes(t))].map((t) => (
                <Chip key={t} label={fmtTime(t)} selected={times.includes(t)} onPress={() => setTimes(times.includes(t) ? times.filter((x) => x !== t) : times.length < 3 ? [...times, t].sort() : times)} />
              ))}
            </Row>
            <Row>
              <View style={{ flex: 1 }}><Input value={customTime} onChangeText={setCustomTime} placeholder="Custom time, e.g. 06:45" onSubmitEditing={addTime} maxLength={5} /></View>
              <Button title="Add" variant="secondary" onPress={addTime} full={false} disabled={!customTime} />
            </Row>
            <Text variant="small" muted>Time zone: {deviceTimezone()}. Notifications come with the Android app; you can skip this and set it later.</Text>
          </Stack>
        ) : null}

        {step === "consent" ? (
          <Stack gap={16}>
            <Card tone="primary">{PRIVACY_SUMMARY.map((p) => <Text key={p}>• {p}</Text>)}</Card>
            <Text accessibilityRole="link" bold onPress={() => router.push("/privacy")}>Read the full privacy notice</Text>
            <Check checked={adult} onToggle={() => setAdult(!adult)}><Text>I am 18 years or older.</Text></Check>
            <Check checked={agree} onToggle={() => setAgree(!agree)}><Text>I agree to the privacy notice, including sending my note text to an AI service (Anthropic) outside India to power the app.</Text></Check>
          </Stack>
        ) : null}

        {error ? <Banner tone="error">{error}</Banner> : null}
      </Stack>
    </Screen>
  );
}
