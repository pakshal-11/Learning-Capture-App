import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const DEV_PASSWORD_LOGIN = process.env.EXPO_PUBLIC_DEV_PASSWORD_LOGIN === "1";

export const supabase = createClient(SUPABASE_URL || "http://localhost", SUPABASE_ANON_KEY || "missing", {
  auth: {
    // web: supabase-js uses localStorage; native: AsyncStorage
    ...(Platform.OS === "web" ? {} : { storage: AsyncStorage }),
    autoRefreshToken: true,
    persistSession: true,
    // web: picks up the tokens Google sign-in returns in the URL; native handles the redirect itself (googleSignIn.ts)
    detectSessionInUrl: Platform.OS === "web",
  },
});

export const configured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
