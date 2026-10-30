// Key-value persistence for native (Android/iOS). The web version lives in storage.web.ts (IndexedDB).
import AsyncStorage from "@react-native-async-storage/async-storage";

export const kv = {
  get: (key: string) => AsyncStorage.getItem(key),
  set: (key: string, value: string) => AsyncStorage.setItem(key, value),
  del: (key: string) => AsyncStorage.removeItem(key),
};
