import { Redirect } from "expo-router";

// Android lands here when the Google sign-in browser hands control back via learninglog://auth-callback.
export default function AuthCallback() {
  return <Redirect href="/" />;
}
