import { Mail, Phone, UserRound } from "lucide-react-native";
import { KeyboardAvoidingView, ScrollView, View } from "react-native";
import DotsLoader from "@/components/Loading/DotsLoader";
import ScreenHeader from "@/components/ScreenHeader";
import StyledInput from "@/components/StyledInput";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { SCREEN_NAVIGATION } from "@/constants/navigations";
import { useThemeColors } from "@/hooks/useTheme";
import { useSignOut } from "@/services/requests/player";
import { PHONE_MAX_LENGTH, PHONE_PLACEHOLDER } from "@/utils/phoneFormat";
import { useProfileForm } from "./useProfileForm";

/**
 * Two routes, one form (PLAN-009, PLAN-006's profile):
 *  • CompleteProfile — the first sign-in, before anything else (booking needs
 *    it). Saving switches to the tabs by itself; Sign out is the way out.
 *  • EditProfile — pushed from Me, with a back button; saving goes back.
 */
const CompleteProfileScreen = ({ navigation, route }) => {
  const colors = useThemeColors();
  const editing = route.name === SCREEN_NAVIGATION.EditProfile;
  const f = useProfileForm({ onSaved: editing ? navigation.goBack : undefined });
  const signOut = useSignOut();

  return (
    <View className="bg-background flex-1">
      <ScreenHeader
        title={editing ? "Edit profile" : "Your profile"}
        onBack={editing ? navigation.goBack : undefined}
      />
      <KeyboardAvoidingView className="flex-1" behavior="padding">
        <ScrollView
          contentContainerClassName="items-center p-5"
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View className="w-full max-w-[520px]">
            {!editing ? (
              <Text className="text-muted-foreground mb-5 text-[14px]">
                Check your name as venues will see it on your bookings. You can change it later.
              </Text>
            ) : null}

            <StyledInput
              label="Email"
              value={f.email}
              Icon={Mail}
              editable={false}
              className="opacity-70"
            />
            <StyledInput
              label="First name"
              value={f.values.firstName}
              onChangeText={f.set("firstName")}
              autoCapitalize="words"
              autoComplete="given-name"
              Icon={UserRound}
              error={f.errors.firstName}
            />
            <StyledInput
              label="Middle name (optional)"
              value={f.values.middleName}
              onChangeText={f.set("middleName")}
              autoCapitalize="words"
              autoComplete="additional-name"
              Icon={UserRound}
              error={f.errors.middleName}
            />
            <StyledInput
              label="Last name"
              value={f.values.lastName}
              onChangeText={f.set("lastName")}
              autoCapitalize="words"
              autoComplete="family-name"
              Icon={UserRound}
              error={f.errors.lastName}
            />
            <StyledInput
              label="Mobile number (optional)"
              value={f.values.phone}
              onChangeText={f.set("phone")}
              placeholder={PHONE_PLACEHOLDER}
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              maxLength={PHONE_MAX_LENGTH}
              Icon={Phone}
              error={f.errors.phone}
            />

            {f.saveError ? (
              <Text className="text-destructive mb-3 text-[13px]" accessibilityRole="alert">
                {f.saveError}
              </Text>
            ) : null}

            <Button
              onPress={f.submit}
              disabled={f.saving}
              className="mt-1 h-[52px] flex-row gap-2"
              accessibilityState={{ busy: f.saving }}
            >
              <Text className="text-primary-foreground font-sans-bold text-[15.5px]">
                {editing ? "Save" : "Save and continue"}
              </Text>
              {f.saving ? <DotsLoader color={colors.primaryForeground} /> : null}
            </Button>

            {!editing ? (
              <Button
                variant="ghost"
                onPress={() => signOut.mutate()}
                disabled={signOut.isPending}
                className="mt-3 h-11"
              >
                <Text className="text-muted-foreground font-sans-medium text-[14px]">
                  Sign out
                </Text>
              </Button>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
};

export default CompleteProfileScreen;
