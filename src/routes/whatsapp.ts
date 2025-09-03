import { Router, Request, Response } from "express";

const router = Router();
const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN || "";

// Verification GET
router.get("/whatsapp/webhook", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === VERIFY) return res.status(200).send(challenge);
    return res.status(403).send("Forbidden");
});

// Events POST
router.post("/whatsapp/webhook", async (req: Request, res: Response) => {
    try {
      console.log("WhatsApp incoming:", JSON.stringify(req.body || {}));
      return res.status(200).send("EVENT_RECEIVED");
    } catch (e: any) {
      console.error("POST /whatsapp/webhook error:", e);
      return res.status(500).send("ERROR");
    }
});

export default router;
