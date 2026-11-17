import { CalendarPlus, Minus, Plus } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";
import ChoiceChips from "@/components/ChoiceChips";
import { FormSheet, SectionLabel, StatusToggle } from "@/components/pattern";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Text } from "@/components/ui/text";
import { useThemeColors } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";
import {
  SESSION_DURATIONS,
  SESSION_MAX_DAYS_AHEAD,
  formatDayLabel,
  formatMinutes,
  formatTime,
  manilaDays,
  manilaNow,
} from "@/utils/dynaCam";
import {
  PHONE_MAX_LENGTH,
  PHONE_PLACEHOLDER,
  formatPhoneOnChange,
  isValidPhoneNumber,
} from "@/utils/phoneFormat";

const PLAYER_NAME_MAX = 100;
const STEP = 15; // minutes per tap on the time stepper

const toHHmm = (minutes) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

/** Minutes past midnight of the next quarter hour, Manila time. */
const nextQuarter = () => {
  const [h, mi] = manilaNow().time.split(":").map(Number);
  return Math.min(23 * 60 + 45, Math.ceil((h * 60 + mi + 1) / STEP) * STEP);
};

const blank = (courtId) => ({
  courtId: courtId ?? null,
  when: "Now",
  day: manilaNow().date,
  minutes: nextQuarter(),
  durationMinutes: 60,
  playerName: "",
  phone: "",
});

/** One step of the time picker: "− 1h", "− 15m", "+ 15m", "+ 1h". */
const StepButton = ({ icon: Icon, label, onPress, disabled }) => {
  const colors = useThemeColors();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn(
        "border-border bg-secondary h-11 flex-1 flex-row items-center justify-center gap-1 rounded-lg border",
        disabled ? "opacity-40" : "active:bg-secondary",
      )}
    >
      <Icon size={14} color={colors.foreground} />
      <Text className="font-mono text-[12px]">{label.replace(/^\S+ /, "")}</Text>
    </Pressable>
  );
};

/**
 * Book a court for a full-session recording —
 * `{ open, onClose, onSubmit, courts, initialCourtId, saving }`.
 *
 * Times are Manila wall-clock, whatever the phone's zone: "Now" is read at
 * the moment Book is tapped (the API accepts a start up to a minute ago), and
 * "Later" picks one of the next 14 days plus a time in 15-minute steps — no
 * native date-picker module needed. Lengths are the web portal's choices.
 *
 * The phone is optional and typed as `0912 3456 789`; the API normalises it
 * again.
 */
const BookSessionSheet = ({
  open,
  onClose,
  onSubmit,
  courts,
  courtsLoading = false,
  initialCourtId,
  saving = false,
}) => {
  const [draft, setDraft] = useState(() => blank(initialCourtId));
  const [touchedPhone, setTouchedPhone] = useState(false);

  // A fresh form each time it opens, on the court it was opened for
  useEffect(() => {
    if (open) {
      setDraft(blank(initialCourtId));
      setTouchedPhone(false);
    }
  }, [open, initialCourtId]);

  const set = (key) => (value) => setDraft((d) => ({ ...d, [key]: value }));

  const days = useMemo(
    () => (open ? manilaDays(SESSION_MAX_DAYS_AHEAD + 1) : []),
    [open],
  );

  // ── Validation ─────────────────────────────────────────────────────────────
  const now = manilaNow();
  const startLater = `${draft.day} ${toHHmm(draft.minutes)}`;
  const inPast =
    draft.when === "Later" && startLater < `${now.date} ${now.time}`;
  const phoneError =
    draft.phone && !isValidPhoneNumber(draft.phone)
      ? `Enter a valid mobile number, e.g. ${PHONE_PLACEHOLDER}`
      : null;
  const courtMissing = !courts.some((c) => c.courtId === draft.courtId);
  const valid = !courtMissing && !inPast && !phoneError;
  const canSave = valid && !saving;

  const submit = () => {
    const start = draft.when === "Now" ? manilaNow() : null;
    onSubmit({
      courtId: draft.courtId,
      startAt: start ? `${start.date} ${start.time}` : startLater,
      durationMinutes: draft.durationMinutes,
      // Empty optionals are left out; the API treats missing as "none"
      ...(draft.playerName.trim() && { playerName: draft.playerName.trim() }),
      ...(draft.phone && { phone: draft.phone }),
    });
  };

  const shift = (delta) =>
    set("minutes")(Math.min(23 * 60 + 45, Math.max(0, draft.minutes + delta)));

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      icon={CalendarPlus}
      title="Book a session"
      subtitle="Record a court for the whole game"
      footer={
        <>
          <Button variant="outline" onPress={onClose} className="h-12 flex-1">
            <Text>Cancel</Text>
          </Button>
          <Button onPress={submit} disabled={!canSave} className="h-12 flex-1">
            <Text>{saving ? "Booking…" : "Book session"}</Text>
          </Button>
        </>
      }
    >
      <View className="w-full max-w-[560px] self-center">
        <SectionLabel>Court</SectionLabel>
        {courts.length ? (
          <ChoiceChips
            wrap
            value={draft.courtId}
            onChange={set("courtId")}
            options={courts.map((c) => ({
              value: c.courtId,
              label: `${c.name} · ${c.venueName}`,
            }))}
          />
        ) : (
          <Text className="text-muted-foreground text-[13px]">
            {courtsLoading ? "Loading courts…" : "No active courts to book."}
          </Text>
        )}

        <View className="mt-7">
          <SectionLabel>Start</SectionLabel>
          <StatusToggle
            value={draft.when}
            onChange={set("when")}
            options={[{ value: "Now" }, { value: "Later", accent: false }]}
          />

          {draft.when === "Later" ? (
            <View className="mt-4 gap-4">
              <ChoiceChips
                value={draft.day}
                onChange={set("day")}
                options={days.map((d) => ({ value: d, label: formatDayLabel(d) }))}
              />
              <View className="border-border bg-card gap-3 rounded-xl border p-3">
                <Text
                  className="font-sans-semibold text-center text-[22px]"
                  accessibilityLiveRegion="polite"
                >
                  {formatTime(toHHmm(draft.minutes))}
                </Text>
                {/* Four equal buttons under the time, so it fits at 320px */}
                <View className="flex-row gap-2">
                  <StepButton icon={Minus} label="Minus 1h" onPress={() => shift(-60)} disabled={draft.minutes < 60} />
                  <StepButton icon={Minus} label={`Minus ${STEP}m`} onPress={() => shift(-STEP)} disabled={draft.minutes === 0} />
                  <StepButton icon={Plus} label={`Plus ${STEP}m`} onPress={() => shift(STEP)} disabled={draft.minutes >= 23 * 60 + 45} />
                  <StepButton icon={Plus} label="Plus 1h" onPress={() => shift(60)} disabled={draft.minutes > 22 * 60 + 45} />
                </View>
              </View>
              <Text
                className={cn(
                  "text-[12px]",
                  inPast ? "text-destructive" : "text-muted-foreground",
                )}
              >
                {inPast
                  ? "That time has already passed — pick a later one, or choose Now."
                  : "Venue time (Philippines)."}
              </Text>
            </View>
          ) : (
            <Text className="text-muted-foreground mt-2 text-[12px]">
              Recording starts as soon as you book.
            </Text>
          )}
        </View>

        <View className="mt-7">
          <SectionLabel>Length</SectionLabel>
          <ChoiceChips
            wrap
            value={draft.durationMinutes}
            onChange={set("durationMinutes")}
            options={SESSION_DURATIONS.map((m) => ({
              value: m,
              label: formatMinutes(m),
            }))}
          />
        </View>

        <View className="mt-7">
          <SectionLabel>Player (optional)</SectionLabel>
          <View className="gap-4">
            <View className="gap-2">
              <Label nativeID="playerName">
                <Text className="font-sans-medium text-[13px]">Name</Text>
              </Label>
              <Input
                aria-labelledby="playerName"
                value={draft.playerName}
                onChangeText={set("playerName")}
                placeholder="e.g. Marco Reyes"
                maxLength={PLAYER_NAME_MAX}
                autoCapitalize="words"
                className="h-12"
              />
            </View>
            <View className="gap-2">
              <Label nativeID="phone">
                <Text className="font-sans-medium text-[13px]">Mobile number</Text>
              </Label>
              <Input
                aria-labelledby="phone"
                value={draft.phone}
                onChangeText={(v) => set("phone")(formatPhoneOnChange(v))}
                onBlur={() => setTouchedPhone(true)}
                placeholder={PHONE_PLACEHOLDER}
                keyboardType="phone-pad"
                maxLength={PHONE_MAX_LENGTH}
                className={cn("h-12", touchedPhone && phoneError && "border-destructive")}
              />
              {touchedPhone && phoneError ? (
                <Text className="text-destructive text-[12.5px]">{phoneError}</Text>
              ) : null}
            </View>
          </View>
        </View>
      </View>
    </FormSheet>
  );
};

export default BookSessionSheet;
