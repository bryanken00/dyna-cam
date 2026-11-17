import { memo } from "react";
import { View } from "react-native";
import StatusChip from "@/components/StatusChip";
import { Text } from "@/components/ui/text";
import { CAMERA_STATE, formatSeenAgo } from "@/utils/dynaCam";

/** The box's connection in one chip. A revoked box is refused by the API. */
const deviceState = (device) => {
  if (device.status !== "Active") return { label: device.status, tone: "muted" };
  return device.online
    ? { label: "Online", tone: "success" }
    : { label: "Offline", tone: "danger" };
};

/**
 * One recorder box, with the per-camera status from its last heartbeat:
 *
 *   Front desk box                       ● Online
 *   Dink City · Seen just now · v1.0.0
 *     Court 1                         ● Recording
 *     Court 2   Connecting to camera  ● Starting
 *
 * Not pressable — everything there is to see is on the row.
 */
const DeviceRow = ({ device }) => {
  const state = deviceState(device);
  const meta = [
    device.venueName,
    formatSeenAgo(device.lastSeenSecondsAgo),
    device.agentVersion ? `v${device.agentVersion}` : null,
  ]
    .filter(Boolean)
    .join("  ·  ");

  return (
    <View className="px-4 py-3">
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Text className="font-sans-medium text-[14px]" numberOfLines={1}>
            {device.name}
          </Text>
          <Text className="text-muted-foreground mt-0.5 text-[12.5px]" numberOfLines={1}>
            {meta}
          </Text>
        </View>
        <StatusChip label={state.label} tone={state.tone} />
      </View>

      {device.cameras?.length ? (
        <View className="border-border mt-3 gap-2 border-l pl-3">
          {device.cameras.map((cam) => {
            const camState = CAMERA_STATE[cam.status] ?? {
              label: cam.status ?? "Unknown",
              tone: "muted",
            };
            return (
              <View key={cam.courtId ?? cam.courtName} className="flex-row items-center gap-2">
                <View className="min-w-0 flex-1">
                  <Text className="text-[13px]" numberOfLines={1}>
                    {cam.courtName ?? "Camera"}
                  </Text>
                  {cam.message ? (
                    <Text className="text-muted-foreground text-[12px]" numberOfLines={2}>
                      {cam.message}
                    </Text>
                  ) : null}
                </View>
                <StatusChip
                  // An offline box's last report is stale — say so
                  label={device.online ? camState.label : `${camState.label} (last seen)`}
                  tone={device.online ? camState.tone : "muted"}
                />
              </View>
            );
          })}
        </View>
      ) : (
        <Text className="text-muted-foreground mt-2 text-[12px]">
          No camera status reported yet.
        </Text>
      )}
    </View>
  );
};

export default memo(DeviceRow);
