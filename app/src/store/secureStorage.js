import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/**
 * expo-secure-store (Keychain / Android Keystore) as a zustand `persist`
 * storage — for anything that is a credential: the session device's pairing
 * token, the player's tokens, and the app's mode.
 *
 * SecureStore doesn't exist on web, where nothing is remembered.
 * Keys allow letters, digits, ".", "-" and "_" only.
 */
export const secureStorage =
  Platform.OS === "web"
    ? {
        getItem: async () => null,
        setItem: async () => {},
        removeItem: async () => {},
      }
    : {
        getItem: (name) => SecureStore.getItemAsync(name),
        setItem: (name, value) => SecureStore.setItemAsync(name, value),
        removeItem: (name) => SecureStore.deleteItemAsync(name),
      };

export default secureStorage;
