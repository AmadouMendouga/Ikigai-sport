"use server";

import { createHash, randomInt, randomUUID } from "node:crypto";
import { verifyCustomerSession } from "@/lib/auth/dal";
import { adminDb } from "@/lib/firebase/admin";
import { getOrderById } from "@/lib/data/orders";
import { CampayCollectError, campayCollect, campayGetTransaction, campayTransactionMismatch } from "@/lib/campay";
import { applyPaymentResult } from "@/lib/paymentHelpers";
import { decrementQuotedStock, loadInventoryQuote } from "@/lib/orderInventory";
import { validateOrderItems } from "@/lib/orderValidation";
import type { Order, OrderItem, PaymentStatus } from "@/lib/types";

const INITIATION_LOCK_MS = 2 * 60 * 1000;

export interface InitiateCampayPaymentInput {
  items: OrderItem[];
  requestId: string;
}

export type InitiateCampayPaymentResult =
  | { ok: true; orderId: string; ussdCode: string; operator: string }
  | { ok: false; error: string; retrySafe?: boolean };

class PaymentInputError extends Error {}

function paymentOrderDocumentId(uid: string, requestId: string): string {
  return `campay-${createHash("sha256").update(`${uid}:${requestId}`).digest("hex").slice(0, 40)}`;
}

export async function initiateCampayPaymentAction(
  input: InitiateCampayPaymentInput
): Promise<InitiateCampayPaymentResult> {
  const session = await verifyCustomerSession();
  const validated = validateOrderItems(input?.items);
  if (!validated.ok) return validated;
  const requestId = String(input.requestId || "").trim();
  if (!/^[a-zA-Z0-9_-]{16,100}$/.test(requestId)) {
    return { ok: false, error: "Identifiant de paiement invalide." };
  }

  const profileSnap = await adminDb.collection("customers").doc(session.uid).get();
  if (!profileSnap.exists) return { ok: false, error: "Profil introuvable." };
  const profile = profileSnap.data() as { name: string; phone: string; defaultAddress?: string };
  const phone = String(profile.phone || "").replace(/\D/g, "");
  if (phone.length < 8 || phone.length > 15) return { ok: false, error: "Numéro Mobile Money invalide." };

  const paymentReference = randomUUID();
  const orderRef = adminDb.collection("orders").doc(paymentOrderDocumentId(session.uid, requestId));

  type Decision =
    | { kind: "collect"; total: number; reference: string }
    | { kind: "existing"; ussdCode: string; operator: string }
    | { kind: "pending" }
    | { kind: "busy" };

  let decision: Decision;
  try {
    decision = await adminDb.runTransaction(async (tx): Promise<Decision> => {
      const existingSnap = await tx.get(orderRef);
      if (existingSnap.exists) {
        const existing = { id: existingSnap.id, ...(existingSnap.data() as Omit<Order, "id">) };
        if (existing.uid !== session.uid) throw new PaymentInputError("Paiement invalide.");
        if (existing.campayReference && existing.ussdCode) {
          return { kind: "existing", ussdCode: existing.ussdCode, operator: existing.paymentOperator || "Mobile Money" };
        }
        if (existing.paymentStatus === "pending" && !existing.paymentInitiationStartedAt) {
          return { kind: "pending" };
        }
        const startedAt = existing.paymentInitiationStartedAt ? new Date(existing.paymentInitiationStartedAt).getTime() : Date.now();
        if (Date.now() - startedAt < INITIATION_LOCK_MS) return { kind: "busy" };
        // Une requête CamPay peut avoir atteint le fournisseur sans que la réponse
        // soit revenue jusqu'à nous. On ne déclenche donc jamais un second collect
        // automatiquement avec la même réservation : le webhook reste la source
        // de réconciliation de cette tentative.
        tx.update(orderRef, {
          paymentInitiationStartedAt: null,
          paymentFailureReason: "Vérification de la première tentative de paiement en cours. Ne payez pas une seconde fois.",
        });
        return { kind: "pending" };
      }

      const inventory = await loadInventoryQuote(tx, validated.items);
      if (!inventory.ok) throw new PaymentInputError(inventory.error);
      decrementQuotedStock(tx, inventory.quote);
      tx.set(orderRef, {
        customerName: profile.name,
        customerPhone: phone,
        orderSummary: inventory.quote.summary,
        address: typeof profile.defaultAddress === "string" ? profile.defaultAddress.trim().slice(0, 500) || null : null,
        locationToken: null,
        locationTokenExpiresAt: null,
        locationSharing: false,
        liveLocation: null,
        courierLocationToken: null,
        courierLocationTokenExpiresAt: null,
        courierLocationSharing: false,
        courierLiveLocation: null,
        items: inventory.quote.items,
        total: inventory.quote.total,
        checkoutRequestId: requestId,
        deliveryCode: String(randomInt(0, 10000)).padStart(4, "0"),
        status: "recue",
        statusHistory: [{ status: "recue", at: new Date().toISOString() }],
        createdAt: new Date().toISOString(),
        statusUpdatedAt: new Date().toISOString(),
        deliverySlot: null,
        deliveredAt: null,
        reviewToken: null,
        reviewSubmitted: false,
        uid: session.uid,
        paymentStatus: "pending",
        paymentReference,
        campayReference: null,
        ussdCode: null,
        paidAt: null,
        paymentFailureReason: null,
        paymentInitiationStartedAt: new Date().toISOString(),
        paymentOperator: null,
        stockState: "reserved",
        inventoryIssue: false,
      });
      return { kind: "collect", total: inventory.quote.total, reference: paymentReference };
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Impossible de réserver le stock." };
  }

  if (decision.kind === "existing") {
    return { ok: true, orderId: orderRef.id, ussdCode: decision.ussdCode, operator: decision.operator };
  }
  if (decision.kind === "pending") {
    return { ok: true, orderId: orderRef.id, ussdCode: "", operator: "Mobile Money" };
  }
  if (decision.kind === "busy") return { ok: false, error: "Initialisation du paiement déjà en cours." };

  let result;
  try {
    result = await campayCollect({
      amount: decision.total,
      from: phone,
      description: "IKIGAI Sport — commande en ligne",
      externalReference: decision.reference,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Échec de l'initialisation du paiement.";
    if (err instanceof CampayCollectError && err.outcome === "rejected") {
      await applyPaymentResult(orderRef.id, "FAILED", message);
      return { ok: false, error: message, retrySafe: true };
    }

    // Résultat ambigu (timeout, réseau, réponse tronquée) : CamPay a peut-être
    // déjà déclenché le débit. On garde donc la réservation et la même clé
    // d'idempotence, puis on laisse le webhook réconcilier cette tentative.
    await orderRef.update({
      paymentInitiationStartedAt: null,
      paymentFailureReason: message,
    }).catch(() => {});
    return { ok: true, orderId: orderRef.id, ussdCode: "", operator: "Mobile Money" };
  }

  // Le paiement a bien été initié chez le fournisseur. Une panne Firestore à
  // cet instant ne doit surtout pas libérer le stock ni qualifier l'opération
  // d'échec : le webhook pourra rattacher la référence et réconcilier l'état.
  try {
    await orderRef.update({
      campayReference: result.reference,
      ussdCode: result.ussd_code,
      paymentOperator: result.operator,
      paymentInitiationStartedAt: null,
      paymentFailureReason: null,
    });
  } catch {
    // Conservation volontaire de l'état pending/reserved, réconcilié par webhook.
  }
  return { ok: true, orderId: orderRef.id, ussdCode: result.ussd_code, operator: result.operator };
}

export type CheckPaymentStatusResult =
  | { ok: true; paymentStatus: PaymentStatus; paymentFailureReason: string | null }
  | { ok: false; error: string };

export async function checkPaymentStatusAction(
  orderId: string,
  opts?: { forceLiveCheck?: boolean }
): Promise<CheckPaymentStatusResult> {
  const session = await verifyCustomerSession();
  if (typeof orderId !== "string" || !/^[a-zA-Z0-9_-]{1,150}$/.test(orderId)) {
    return { ok: false, error: "Commande introuvable." };
  }
  let order = await getOrderById(orderId, session.uid);
  if (!order) return { ok: false, error: "Commande introuvable." };

  if (opts?.forceLiveCheck && (order.paymentStatus === "pending" || order.paymentStatus === "failed") && order.campayReference) {
    try {
      const live = await campayGetTransaction(order.campayReference);
      const mismatch = campayTransactionMismatch(order, live);
      if (mismatch) return { ok: false, error: mismatch };
      if (live.status === "SUCCESSFUL" || live.status === "FAILED") {
        await applyPaymentResult(order.id, live.status, live.reason);
        order = (await getOrderById(orderId, session.uid)) || order;
      }
    } catch {
      // Le statut Firestore courant reste la meilleure information disponible.
    }
  }

  return { ok: true, paymentStatus: order.paymentStatus, paymentFailureReason: order.paymentFailureReason };
}
