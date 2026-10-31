// Draft privacy notice for the test build (India DPDP Act basics). Have it reviewed before any wider release.
export const GRIEVANCE_CONTACT = "pakshal@bananaclub.co.in";

export interface PrivacySection {
  title: string;
  points: string[];
}

export const PRIVACY_SUMMARY: string[] = [
  "Your notes are private. Only you can see them in the app.",
  "Text you save or type is sent to an AI service (Anthropic's Claude) to organise your notes, grade answers and find matches.",
  "You can export or delete all your data in Settings, any time.",
  "This test build is for adults (18+) only.",
];

export const PRIVACY_SECTIONS: PrivacySection[] = [
  {
    title: "What we collect",
    points: [
      "Your email address, to sign you in.",
      "The profile you give us: role, field, goals, interests, language, reminder times.",
      "Your notes, review answers and results, and your \"I'm stuck\" questions.",
      "Simple AI usage counts (calls, tokens, estimated cost) to keep costs under control.",
    ],
  },
  {
    title: "Why we use it",
    points: [
      "To run the app: save notes, schedule reviews, send reminders you ask for.",
      "To personalise AI replies (tone, depth, examples) from your profile.",
      "Nothing else. No ads, no selling data, no tracking of other apps. Capture only happens when you tap.",
    ],
  },
  {
    title: "AI processing",
    points: [
      "When you structure a note, answer a review question or ask \"I'm stuck\", the text involved is sent to Anthropic's Claude model.",
      "Only the relevant notes are sent, never your whole history.",
      "We do not use your notes to train AI models.",
      "Anthropic processes data outside India. By agreeing, you consent to this transfer.",
    ],
  },
  {
    title: "Web look-ups",
    points: [
      "If a note only names something (for example \"20 hook formulas\"), the app can look it up on the web so your note holds the real details.",
      "To do this, the text of that note is sent to Anthropic, who run the web search for us. The search results come back with links to their sources.",
      "Details found this way are clearly labelled \"Added from the web\", with their sources, and you can remove them before saving. Check them: web pages can be wrong.",
      "We never open links you paste. Only notes you choose to organise are looked up.",
    ],
  },
  {
    title: "Where it is stored",
    points: [
      "In Supabase, hosted in Mumbai, India, and on your own device so the app works offline.",
      "Entries are private by default. Other users cannot see them.",
      "The test team can technically access the database to fix problems. We will not read your notes unless you ask us to help with an issue.",
    ],
  },
  {
    title: "Your choices",
    points: [
      "Edit any note or your profile in the app.",
      "Export everything as a file: Settings > Export my data.",
      "Delete your account and all your data: Settings > Delete my account. Deleted notes are removed from the server within 30 days.",
      "Withdraw consent at any time by deleting your account.",
    ],
  },
  {
    title: "Permissions",
    points: [
      "We explain each permission (microphone, notifications, display over other apps) before asking, and only ask when you use the feature.",
      "Quick-capture only reacts when you tap it. It never reads other apps.",
    ],
  },
  {
    title: "Voice, screenshots and notifications",
    points: [
      "Voice: on Android, your phone's Google speech service turns your voice into text. Depending on your phone's settings it may send the audio to Google. We never receive or store audio.",
      "Screenshots and photos: the text is read on your device (Google ML Kit on Android; inside your browser on the web app). The picture is not uploaded or stored; only the text you choose to save is.",
      "Notifications: if you turn them on, we store a device address (a notification token) to send reminders. It is removed when you turn notifications off or delete your account.",
      "Google sign-in (if you use it): Google tells us your email address. We get nothing else.",
    ],
  },
  {
    title: "Questions or complaints",
    points: [`Email ${GRIEVANCE_CONTACT}. We aim to reply within 7 days.`],
  },
];
