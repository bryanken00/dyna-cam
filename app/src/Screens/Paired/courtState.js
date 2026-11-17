/**
 * A paired-API court (`{ hasCamera, recorderOnline, canRecord, recording }`)
 * → what staff read on its card and its screen.
 */
export const pairedCourtState = (court) => {
  if (!court) return { label: "", tone: "muted" };
  if (court.recording) return { label: "Recording", tone: "danger" };
  if (court.canRecord) return { label: "Ready to record", tone: "success" };
  if (!court.hasCamera) return { label: "No camera", tone: "muted" };
  return { label: "Camera offline", tone: "danger" };
};

export default pairedCourtState;
