// "Continue with Google" through Supabase Auth. Hidden until EXPO_PUBLIC_GOOGLE_SIGNIN=1 (Google must be enabled in Supabase first).
import * as Linking from "expo-linking";
import * as WebBrowser from "expo-web-browser";
import { Platform } from "react-native";
import { supabase } from "./supabase";

export const googleEnabled = process.env.EXPO_PUBLIC_GOOGLE_SIGNIN === "1" && (Platform.OS === "web" || Platform.OS === "android");

WebBrowser.maybeCompleteAuthSession();

/** Returns an error message, or null on success (web leaves the page, so it never returns there). */
export async function signInWithGoogle(): Promise<string | null> {
  if (Platform.OS === "web") {
    const { error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: window.location.origin } });
    return error ? error.message : null;
  }
  const redirectTo = Linking.createURL("auth-callback");
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) return error?.message ?? "Couldn't start Google sign-in.";
  const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
  if (result.type !== "success") return null; // the user closed the browser: not an error
  // Implicit flow: the tokens come back in the URL fragment.
  const params = new URLSearchParams(result.url.split("#")[1] ?? "");
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) return params.get("error_description") ?? "Google sign-in didn't complete. Try again.";
  const { error: setErr } = await supabase.auth.setSession({ access_token, refresh_token });
  return setErr ? setErr.message : null;
}
