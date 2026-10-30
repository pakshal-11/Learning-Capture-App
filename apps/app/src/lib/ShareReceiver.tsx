// Android: receives text, links and pictures shared from other apps ("Share > Learning Log") and opens Capture with them.
import { useRouter } from "expo-router";
import { useShareIntent } from "expo-share-intent";
import { useEffect } from "react";

export function ShareReceiver({ enabled }: { enabled: boolean }) {
  const router = useRouter();
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntent({ disabled: !enabled });

  useEffect(() => {
    if (!enabled || !hasShareIntent) return;
    const image = shareIntent.files?.find((f) => f.mimeType?.startsWith("image/"));
    const params: Record<string, string> = {};
    if (image) params.image = image.path;
    else if (shareIntent.webUrl) {
      params.url = shareIntent.webUrl;
      if (shareIntent.meta?.title) params.title = shareIntent.meta.title;
    } else if (shareIntent.text) params.text = shareIntent.text;
    resetShareIntent();
    if (Object.keys(params).length) router.push({ pathname: "/capture", params });
  }, [enabled, hasShareIntent]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
