import { Express, Request, Response } from "express";

const VERIFY = process.env.WHATSAPP_VERIFY_TOKEN || "";
const ACCESS  = process.env.WHATSAPP_ACCESS_TOKEN || "";
const PHONE   = process.env.WABA_PHONE_NUMBER_ID || "";

export function registerWhatsappRoutes(app: Express) {
  // אימות (GET) – מטא שולחת hub.challenge
  app.get("/whatsapp/webhook", (req: Request, res: Response) => {
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    if (mode === "subscribe" && token === VERIFY) {
      return res.status(200).send(challenge);
    }
    return res.status(403).send("Forbidden");
  });

  // אירועים (POST)
  app.post("/whatsapp/webhook", async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      console.log("WhatsApp incoming:", JSON.stringify(body));
      // כאן תוכל לנתח הודעות, לשמור ל-Firestore, לזמן Brain וכו'
      return res.status(200).send("EVENT_RECEIVED");
    } catch (err: any) {
      console.error("POST /whatsapp/webhook error:", err);
      return res.status(500).send("ERROR");
    }
  });
}
