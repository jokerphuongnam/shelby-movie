import express, { Request, Response, NextFunction } from "express";
import mongoose from "mongoose";
import { connectNats } from "./nats/publisher";
import movieRouter from "./routes/movie.routes";
import paymentRouter from "./routes/payment.routes";
import accessRouter from "./routes/access.routes";
import adminRouter, { seedIfEmpty } from "./routes/admin.routes";

const app = express();
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

const corsOrigin = process.env.CORS_ORIGIN ?? "*";
app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", corsOrigin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-session-token");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.get("/health", (_req: Request, res: Response) => res.json({ status: "ok" }));

app.use("/api/movies", movieRouter);
app.use("/api/payment", paymentRouter);
app.use("/api/access", accessRouter);
app.use("/api/admin", adminRouter);

async function bootstrap() {
  await mongoose.connect(process.env.MONGO_URI!, {
    maxPoolSize: 10,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
  console.log("MongoDB connected");

  if (process.env.ALPHA_SEED === "true") {
    await seedIfEmpty();
  }

  await connectNats();

  const port = process.env.PORT ?? 3000;
  app.listen(port, () => console.log(`api-gateway running on :${port}`));
}

bootstrap().catch(console.error);
