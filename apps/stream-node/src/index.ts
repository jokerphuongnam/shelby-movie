import express, { Request, Response, NextFunction } from "express";
import { startSubscriber } from "./nats/subscriber";
import streamRouter from "./routes/stream.routes";
import uploadRouter from "./routes/upload.routes";

const app = express();
app.use(express.json());

const corsOrigin = process.env.CORS_ORIGIN ?? "*";
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-session-token");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req: Request, res: Response) => res.json({ status: "ok" }));

app.use("/stream", streamRouter);
app.use("/upload", uploadRouter);

async function bootstrap() {
  await startSubscriber();

  const port = process.env.PORT ?? 4000;
  app.listen(port, () => console.log(`stream-node running on :${port}`));
}

bootstrap().catch(console.error);
