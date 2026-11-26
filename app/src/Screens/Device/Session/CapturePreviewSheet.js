import { QrCode as QrIcon } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";
import QrCode from "@/components/QrCode";
import { FormSheet } from "@/components/pattern";
import StatusToggle from "@/components/pattern/StatusToggle";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { formatElapsed } from "@/utils/dynaCam";

/**
 * CR-013 / CR-040: a finished save on the courtside device. Videos go from the
 * venue's recorder box straight to the court's Google Drive and players get
 * them only there, so the sheet shows the save's Drive link as a QR for the
 * player to scan — one per camera on a two-camera court (Cam 1 / Cam 2).
 */
const CapturePreviewSheet = ({ capture, onClose }) => {
  const onDrive = useMemo(
    () => (capture?.videos ?? []).filter((video) => video.status === "Ready" && video.driveUrl),
    [capture],
  );
  const [camera, setCamera] = useState(null);
  const chosen = onDrive.find((video) => video.camera === camera) ?? onDrive[0] ?? null;

  // Opening another save starts on its first camera
  useEffect(() => setCamera(null), [capture?.captureId]);

  const twoCameras = onDrive.length > 1;
  const options = onDrive.map((video) => ({ value: video.label, accent: false }));

  return (
    <FormSheet
      open={Boolean(capture)}
      onClose={onClose}
      icon={QrIcon}
      title={capture ? `Save ${capture.number}` : "Save"}
      subtitle={
        capture
          ? `${formatElapsed(capture.fromSeconds)} – ${formatElapsed(capture.toSeconds)} of the game`
          : undefined
      }
      footer={
        <Button variant="outline" onPress={onClose} className="h-12 flex-1">
          <Text>Close</Text>
        </Button>
      }
    >
      <View className="w-full max-w-[640px] gap-3 self-center pt-1">
        {twoCameras ? (
          <StatusToggle
            value={chosen?.label}
            onChange={(label) =>
              setCamera(onDrive.find((video) => video.label === label)?.camera ?? null)
            }
            options={options}
          />
        ) : null}

        <View className="border-border bg-card items-center gap-3 rounded-[18px] border p-5">
          {chosen ? (
            <>
              <QrCode value={chosen.driveUrl} size={220} />
              <Text className="text-center text-[14px]">
                Scan to open {capture ? `Save ${capture.number}` : "this save"}
                {twoCameras ? ` (${chosen.label})` : ""} in Google Drive — watch or download it
                there.
              </Text>
            </>
          ) : (
            <Text className="text-muted-foreground text-center text-[14px]">
              This save isn&apos;t on Google Drive yet.
            </Text>
          )}
        </View>

        <Text className="text-muted-foreground text-center text-[12.5px]">
          Players also get it from the game&apos;s page — the QR on this screen.
        </Text>
      </View>
    </FormSheet>
  );
};

export default CapturePreviewSheet;
