import { useNavigation } from "@react-navigation/native";
import { Eye, EyeOff, KeyRound, Lock, LogOut } from "lucide-react-native";
import { useRef, useState } from "react";
import {
  Keyboard,
  KeyboardAvoidingView,
  ScrollView,
  TouchableOpacity,
  View,
} from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import ScreenHeader from "@/components/ScreenHeader";
import StyledInput from "@/components/StyledInput";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { useChangePassword, useLogout } from "@/services/requests/auth";
import { useUserAuthStore } from "@/store/useUserAuthStore";

/** Same floor as the API's `newPassword()` validator (back/…/validators/_helpers.js). */
const MIN_PASSWORD_LENGTH = 8;

const EMPTY = { currentPassword: "", newPassword: "", confirmPassword: "" };

/**
 * Change password.
 *
 * Two ways in:
 *  • **Forced** — the account has a temporary password
 *    (`user.mustChangePassword`). Navigation shows only this screen until the
 *    password is changed, so there is no back button, only Sign Out. The API
 *    refuses everything else with 403 `PASSWORD_CHANGE_REQUIRED` meanwhile.
 *  • **Voluntary** — opened from the Menu tab; has a back button.
 *
 * On success the API ends every other session and returns new tokens for this
 * device; `useChangePassword` stores them and clears the forced flag, which
 * sends Navigation back to the normal stack.
 */
const ChangePassword = () => {
  const navigation = useNavigation();
  const colors = useThemeColors();
  const forced = useUserAuthStore((s) => Boolean(s.user?.mustChangePassword));
  const { mutate: changePassword, isPending } = useChangePassword();
  const { mutate: logout, isPending: loggingOut } = useLogout();

  const [values, setValues] = useState(EMPTY);
  const [touched, setTouched] = useState({});
  const [showPass, setShowPass] = useState(false);
  const newRef = useRef(null);
  const confirmRef = useRef(null);

  const set = (field) => (text) => setValues((v) => ({ ...v, [field]: text }));
  const touch = (field) => () =>
    setTouched((t) => (t[field] ? t : { ...t, [field]: true }));

  // ── Validation ─────────────────────────────────────────────────────────────
  // Computed every render rather than stored, so it cannot go stale.
  const errors = {
    currentPassword: !values.currentPassword
      ? "Current password is required."
      : null,
    newPassword: !values.newPassword
      ? "New password is required."
      : values.newPassword.length < MIN_PASSWORD_LENGTH
        ? `Use at least ${MIN_PASSWORD_LENGTH} characters.`
        : values.newPassword === values.currentPassword
          ? "Choose a password different from the current one."
          : null,
    confirmPassword: !values.confirmPassword
      ? "Please confirm your new password."
      : values.confirmPassword !== values.newPassword
        ? "Passwords do not match."
        : null,
  };
  const isValid = !Object.values(errors).some(Boolean);

  const handleSubmit = () => {
    Keyboard.dismiss();
    if (!isValid) {
      setTouched({
        currentPassword: true,
        newPassword: true,
        confirmPassword: true,
      });
      return;
    }
    changePassword(
      {
        currentPassword: values.currentPassword,
        newPassword: values.newPassword,
      },
      {
        onSuccess: () => {
          setValues(EMPTY);
          setTouched({});
          if (!forced && navigation.canGoBack()) navigation.goBack();
        },
      },
    );
  };

  const eyeToggle = (
    <TouchableOpacity
      onPress={() => setShowPass((v) => !v)}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel={showPass ? "Hide passwords" : "Show passwords"}
    >
      {showPass ? (
        <EyeOff size={19} color={colors.mutedForeground} strokeWidth={2} />
      ) : (
        <Eye size={19} color={colors.mutedForeground} strokeWidth={2} />
      )}
    </TouchableOpacity>
  );

  return (
    <View className="bg-background flex-1">
      <ScreenHeader
        title="Change Password"
        onBack={forced ? undefined : navigation.goBack}
      />

      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          contentContainerClassName="items-center p-4 pb-10"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="w-full max-w-[440px]">
            {forced ? (
              <View className="border-border bg-card mb-5 flex-row items-start gap-3 rounded-xl border p-4">
                <KeyRound
                  size={20}
                  color={colors.foreground}
                  strokeWidth={2}
                />
                <View className="flex-1">
                  <Text className="text-[15px] font-sans-semibold">
                    Set your own password
                  </Text>
                  <Text className="text-muted-foreground mt-1 text-[13px]">
                    Your account has a temporary password. Choose a new one to
                    continue.
                  </Text>
                </View>
              </View>
            ) : null}

            <StyledInput
              label="Current password"
              value={values.currentPassword}
              onChangeText={set("currentPassword")}
              onBlur={touch("currentPassword")}
              error={touched.currentPassword ? errors.currentPassword : null}
              placeholder="Enter your current password"
              secureTextEntry={!showPass}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="next"
              onSubmitEditing={() => newRef.current?.focus()}
              Icon={Lock}
              rightElement={eyeToggle}
            />

            <StyledInput
              label="New password"
              value={values.newPassword}
              onChangeText={set("newPassword")}
              onBlur={touch("newPassword")}
              error={touched.newPassword ? errors.newPassword : null}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              secureTextEntry={!showPass}
              autoComplete="new-password"
              textContentType="newPassword"
              inputRef={newRef}
              returnKeyType="next"
              onSubmitEditing={() => confirmRef.current?.focus()}
              Icon={KeyRound}
            />

            <StyledInput
              label="Confirm new password"
              value={values.confirmPassword}
              onChangeText={set("confirmPassword")}
              onBlur={touch("confirmPassword")}
              error={touched.confirmPassword ? errors.confirmPassword : null}
              placeholder="Re-enter the new password"
              secureTextEntry={!showPass}
              autoComplete="new-password"
              textContentType="newPassword"
              inputRef={confirmRef}
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              Icon={KeyRound}
            />

            <Text className="text-muted-foreground mb-5 text-[12.5px]">
              Changing your password signs you out on your other devices.
            </Text>

            {/* Pressable while invalid on purpose: tapping it surfaces the
                errors. Only a request in flight blocks the press. */}
            <Button
              onPress={handleSubmit}
              disabled={isPending}
              className="h-[54px] flex-row gap-2"
              accessibilityState={{ disabled: !isValid, busy: isPending }}
            >
              {isPending ? (
                <>
                  <Text className="text-primary-foreground text-[15.5px] font-sans-bold">
                    Saving
                  </Text>
                  <DotsLoader color={colors.primaryForeground} />
                </>
              ) : (
                <Text className="text-primary-foreground text-[15.5px] font-sans-bold">
                  Change Password
                </Text>
              )}
            </Button>

            {forced ? (
              <Button
                variant="outline"
                onPress={() => logout()}
                disabled={loggingOut}
                className="mt-3 h-12 flex-row gap-2"
              >
                <LogOut
                  size={17}
                  color={colors.mutedForeground}
                  strokeWidth={2}
                />
                <Text className="text-muted-foreground text-[14.5px] font-sans-semibold">
                  {loggingOut ? "Signing out…" : "Sign Out"}
                </Text>
              </Button>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default ChangePassword;
