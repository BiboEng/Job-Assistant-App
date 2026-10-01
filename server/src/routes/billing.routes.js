import { Router } from "express";
import {
  getMyBilling,
  openPortal,
  startCheckout,
  syncMine,
} from "../controllers/billing.controller.js";

// The signed-in billing endpoints. The public price list and the Stripe
// webhook are mounted separately in index.js: one needs no sign-in, the other
// needs the raw request body and Stripe's signature instead of a user token.
export const billingRouter = Router();

billingRouter.get("/me", getMyBilling);
billingRouter.post("/checkout", startCheckout);
billingRouter.post("/portal", openPortal);
billingRouter.post("/sync", syncMine);
