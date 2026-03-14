export const NATS_SUBJECTS = {
  VIDEO_AUTHORIZED: "video.authorized",
  VIDEO_REQUESTED: "video.requested",
} as const;

export type NatsSubject = (typeof NATS_SUBJECTS)[keyof typeof NATS_SUBJECTS];
