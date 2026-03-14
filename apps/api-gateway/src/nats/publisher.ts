import { connect, NatsConnection, StringCodec } from "nats";
import { NATS_SUBJECTS } from "@shelby-movie/shared-types";
import type { VideoAuthorizedPayload } from "@shelby-movie/shared-types";

let nc: NatsConnection;
const sc = StringCodec();

export async function connectNats() {
  nc = await connect({ servers: process.env.NATS_URL ?? "nats://localhost:4222" });
  console.log("NATS connected (api-gateway)");
}

export async function publishVideoAuthorized(payload: VideoAuthorizedPayload) {
  if (!nc) throw new Error("NATS not connected");
  nc.publish(NATS_SUBJECTS.VIDEO_AUTHORIZED, sc.encode(JSON.stringify(payload)));
}
