import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { Order } from "@/lib/types";

// Intégration CamPay (mobile money MTN/Orange) — addendum 3 du plan. Doc API
// consultée directement sur leur Postman documenter (auth par jeton
// permanent, /api/collect/, /api/transaction/(reference)/, webhook signé).
const BASE_URL = process.env.CAMPAY_BASE_URL || "https://demo.campay.net";

function authHeaders(): Record<string, string> {
  return {
    Authorization: `Token ${process.env.CAMPAY_PERMANENT_ACCESS_TOKEN}`,
    "Content-Type": "application/json",
  };
}

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null);
  return body?.detail || body?.message || fallback;
}

export type CampayCollectOutcome = "rejected" | "unknown";

/**
 * Un refus HTTP explicite est définitif et permet une nouvelle tentative.
 * Une panne réseau, un timeout, une erreur serveur ou une réponse invalide
 * sont ambigus : la requête a pu atteindre CamPay. Dans ce cas on ne doit
 * surtout pas libérer le stock ni relancer immédiatement un second débit.
 */
export class CampayCollectError extends Error {
  constructor(message: string, readonly outcome: CampayCollectOutcome) {
    super(message);
    this.name = "CampayCollectError";
  }
}

export interface CampayCollectInput {
  amount: number;
  from: string;
  description: string;
  externalReference: string;
}

export interface CampayCollectResult {
  reference: string;
  ussd_code: string;
  operator: string;
}

function collectOutcomeForHttpStatus(status: number): CampayCollectOutcome {
  // 5xx : le fournisseur peut avoir effectué une partie du traitement avant
  // de renvoyer l'erreur. 408/409/425 sont également ambigus pour un flux de
  // paiement. La priorité est d'éviter un double débit, même si cela impose
  // une réconciliation manuelle dans un cas rare.
  if (status >= 500 || status === 408 || status === 409 || status === 425) return "unknown";
  return "rejected";
}

/** Déclenche un prompt de paiement Mobile Money sur le téléphone du client. */
export async function campayCollect(input: CampayCollectInput): Promise<CampayCollectResult> {
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}/api/collect/`, {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        amount: String(input.amount),
        currency: "XAF",
        from: input.from,
        description: input.description,
        external_reference: input.externalReference,
      }),
    });
  } catch {
    throw new CampayCollectError(
      "CamPay est temporairement injoignable. Ne relancez pas immédiatement le paiement : nous vérifions la première tentative.",
      "unknown"
    );
  }

  if (!res.ok) {
    const outcome = collectOutcomeForHttpStatus(res.status);
    throw new CampayCollectError(
      await readErrorMessage(
        res,
        outcome === "unknown"
          ? "CamPay a renvoyé une réponse incertaine. Ne relancez pas immédiatement le paiement."
          : "CamPay a refusé la demande de paiement."
      ),
      outcome
    );
  }

  const body = await res.json().catch(() => null);
  if (
    !body ||
    typeof body.reference !== "string" || !body.reference ||
    typeof body.ussd_code !== "string" ||
    typeof body.operator !== "string"
  ) {
    throw new CampayCollectError(
      "Réponse CamPay incomplète. Ne relancez pas immédiatement le paiement : nous vérifions la première tentative.",
      "unknown"
    );
  }
  return body as CampayCollectResult;
}

export interface CampayTransactionStatus {
  reference: string;
  external_reference: string;
  status: "PENDING" | "SUCCESSFUL" | "FAILED";
  amount: number;
  currency: string;
  operator: string;
  reason: string | null;
}

/** Compare la transaction relue chez CamPay à ce que la commande attend. */
export function campayTransactionMismatch(order: Order, transaction: CampayTransactionStatus): string | null {
  if (order.campayReference && transaction.reference !== order.campayReference) return "Référence CamPay incohérente.";
  if (!order.paymentReference || transaction.external_reference !== order.paymentReference) return "Référence externe incohérente.";
  if (!Number.isFinite(transaction.amount) || transaction.amount !== order.total) return "Montant CamPay incohérent.";
  if (transaction.currency !== "XAF") return "Devise CamPay incohérente.";
  return null;
}

/** Filet de secours si le webhook tarde — voir checkPaymentStatusAction. */
export async function campayGetTransaction(reference: string): Promise<CampayTransactionStatus> {
  const res = await fetch(`${BASE_URL}/api/transaction/${reference}/`, { headers: authHeaders() });
  if (!res.ok) {
    throw new Error(await readErrorMessage(res, "Impossible de vérifier le statut du paiement."));
  }
  return res.json();
}

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Vérifie manuellement un JWT HS256 (pas de nouvelle dépendance — voir le
 * plan, addendum 3, section Sécurité). Ne décode pas le payload : le webhook
 * CamPay envoie déjà status/reference/amount en clair à côté de `signature`,
 * ce champ ne sert qu'à prouver que la requête vient bien de CamPay.
 */
export function verifyCampayWebhookSignature(token: string, secret: string): boolean {
  if (!token || !secret) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [headerB64, payloadB64, signatureB64] = parts;

  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as { alg?: string };
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as { exp?: number; nbf?: number };
    const now = Math.floor(Date.now() / 1000);
    if (header.alg !== "HS256") return false;
    if (typeof payload.exp === "number" && payload.exp < now) return false;
    if (typeof payload.nbf === "number" && payload.nbf > now + 60) return false;
  } catch {
    return false;
  }

  const expected = base64url(createHmac("sha256", secret).update(`${headerB64}.${payloadB64}`).digest());
  const provided = Buffer.from(signatureB64);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return timingSafeEqual(provided, expectedBuf);
}
