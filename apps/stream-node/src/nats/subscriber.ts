import { connect, StringCodec } from "nats";
import { NATS_SUBJECTS } from "@shelby-movie/shared-types";
import type { VideoAuthorizedPayload } from "@shelby-movie/shared-types";
import { setSession } from "../services/cache.service";

export async function startSubscriber() {
  const nc = await connect({ servers: process.env.NATS_URL ?? "nats://localhost:4222" });
  const sc = StringCodec();

  const sub = nc.subscribe(NATS_SUBJECTS.VIDEO_AUTHORIZED);

  (async () => {
    for await (const msg of sub) {
      const payload: VideoAuthorizedPayload = JSON.parse(sc.decode(msg.data));
      await setSession(payload.sessionToken, payload.blobId, payload.previewDuration, payload.totalDuration);
      console.log(`Session stored for ${payload.walletAddress} → blob ${payload.blobId}`);
    }
  })();

  console.log(`NATS subscriber listening on ${NATS_SUBJECTS.VIDEO_AUTHORIZED}`);
}
