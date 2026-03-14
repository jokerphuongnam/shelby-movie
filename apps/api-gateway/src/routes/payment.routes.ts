import { Router } from "express";
import * as paymentController from "../controllers/payment.controller";

const router = Router();

router.post("/verify", paymentController.verify);

export default router;
