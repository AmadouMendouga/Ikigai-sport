"use server";

// Livreurs enregistrés — solution principale pour qui livre régulièrement
// (accès permanent à ses livraisons via /livreur/[token], sans coordination
// manuelle par commande). Le lien ponctuel généré depuis OrdersAdmin
// (lib/actions/orders.ts, getOrCreateLocationTokenAction) reste la solution
// de secours quand aucun livreur enregistré n'est disponible.
//
// getCourierDashboardAction n'appelle PAS verifyAdminSession — c'est une
// action publique gardée par le jeton personnel du livreur (même principe
// que reviewToken/locationToken, voir lib/actions/orders.ts), jamais par une
// vérification côté navigateur.
import { randomUUID } from "node:crypto";
import { orderStatusPatch } from "@/lib/orderStatusHistory";
import { verifyAdminSession } from "@/lib/auth/dal";
import { adminDb } from "@/lib/firebase/admin";
import type { Courier, Order } from "@/lib/types";
import { COURIER_ACCESS_STATUSES, normalizeOrderStatus, TERMINAL_ORDER_STATUSES } from "@/lib/orderWorkflow";

// Plafond de demandes en attente : l'inscription est publique (aucune
// session), donc sans borne n'importe qui pourrait remplir la collection de
// faux profils. Au-delà, on renvoie vers WhatsApp le temps que l'admin trie.
const MAX_PENDING_COURIERS = 20;
const MAX_COURIER_NAME_LENGTH = 80;

// Inscription publique : le profil est créé INACTIF et marqué « à valider ».
// Tant que l'admin ne l'a pas validé (setCourierActiveAction), il n'apparaît
// pas dans la liste d'assignation et son lien personnel n'ouvre rien — un
// inconnu qui trouve l'URL d'inscription ne devient jamais livreur tout seul.
export async function registerCourierAction(input: {
  name: string;
  phone: string;
}): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const name = String(input?.name || "").trim();
  const phone = String(input?.phone || "").replace(/\D/g, "");
  if (!name) return { ok: false, error: "Le nom est obligatoire." };
  if (name.length > MAX_COURIER_NAME_LENGTH) return { ok: false, error: "Le nom est trop long." };
  if (phone.length < 8 || phone.length > 15) {
    return { ok: false, error: "Le numéro WhatsApp doit contenir 8 à 15 chiffres." };
  }

  const couriers = adminDb.collection("couriers");
  // Un numéro = un profil. On ne renvoie jamais le lien existant : ce serait
  // donner l'accès d'un livreur à quiconque connaît son numéro.
  const samePhone = await couriers.where("phone", "==", phone).limit(1).get();
  if (!samePhone.empty) {
    return { ok: false, error: "Ce numéro est déjà enregistré. Contactez-nous sur WhatsApp si vous avez perdu votre lien." };
  }
  const pending = await couriers.where("pendingApproval", "==", true).limit(MAX_PENDING_COURIERS).get();
  if (pending.size >= MAX_PENDING_COURIERS) {
    return { ok: false, error: "Trop de demandes sont en attente pour le moment. Contactez-nous sur WhatsApp." };
  }

  const token = randomUUID();
  await couriers.add({
    name,
    phone,
    token,
    active: false,
    pendingApproval: true,
    createdAt: new Date().toISOString(),
  });

  return { ok: true, token };
}

export async function setCourierActiveAction(id: string, active: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  await verifyAdminSession();
  const ref = adminDb.collection("couriers").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "Livreur introuvable." };
  if (active) {
    // Activer vaut validation : la demande n'est plus « en attente ».
    await ref.update({ active: true, pendingApproval: false });
    return { ok: true };
  }

  // Désactivation et révocation des livraisons en cours dans un même batch.
  const assigned = await adminDb.collection("orders").where("assignedCourierId", "==", id).get();
  const batch = adminDb.batch();
  batch.update(ref, { active: false });
  assigned.docs.forEach((orderDoc) => {
    const order = orderDoc.data() as Order;
    if (!TERMINAL_ORDER_STATUSES.has(normalizeOrderStatus(order.status))) {
      batch.update(orderDoc.ref, {
        assignedCourierId: null,
        courierLocationToken: null,
        courierLocationSharing: false,
        courierLiveLocation: null,
      });
    }
  });
  await batch.commit();
  return { ok: true };
}

// Refuse une demande d'inscription jamais validée (faux profil, doublon…).
// Limité aux profils « à valider » : un livreur déjà validé peut avoir des
// livraisons et des gains rattachés, on le désactive mais on ne l'efface pas.
export async function rejectCourierAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await verifyAdminSession();
  const ref = adminDb.collection("couriers").doc(id);
  const snap = await ref.get();
  if (!snap.exists) return { ok: false, error: "Livreur introuvable." };
  if ((snap.data() as Courier).pendingApproval !== true) {
    return { ok: false, error: "Seule une demande en attente peut être refusée. Désactivez plutôt ce livreur." };
  }
  await ref.delete();
  return { ok: true };
}

// Rattache un livreur enregistré à une commande (ou détache si courierId est
// null). Le jeton de suivi (courierLocationToken) est réutilisé s'il existe
// déjà — un lien ponctuel généré avant coup n'est pas perdu, le livreur
// enregistré voit simplement la même livraison apparaître sur son lien
// personnel.
export async function assignCourierToOrderAction(
  orderId: string, courierId: string | null
): Promise<{ ok: true; patch: Partial<Order> } | { ok: false; error: string }> {
  await verifyAdminSession();
  const ref = adminDb.collection("orders").doc(orderId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { ok: false as const, error: "Commande introuvable." };
    const order = snap.data() as Order;
    const status = normalizeOrderStatus(order.status);
    if (TERMINAL_ORDER_STATUSES.has(status)) return { ok: false as const, error: "Cette commande est déjà clôturée." };
    if (status !== "prete" && status !== "livreur_assigne") return { ok: false as const, error: "Passez d'abord la commande à « Prête à livrer » ou reportez la course avant de changer de livreur." };
    if (courierId) {
      const courierSnap = await tx.get(adminDb.collection("couriers").doc(courierId));
      if (!courierSnap.exists || (courierSnap.data() as Courier).active !== true) return { ok: false as const, error: "Ce livreur n'est pas actif." };
    }
    const patch: Partial<Order> = {
      assignedCourierId: courierId,
      courierLocationToken: courierId ? randomUUID() : null,
      courierLocationTokenExpiresAt: courierId ? new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() : null,
      courierLocationSharing: false, courierLiveLocation: null,
      ...orderStatusPatch(order, courierId ? "livreur_assigne" : "prete", new Date().toISOString()),
    };
    tx.update(ref, patch);
    return { ok: true as const, patch };
  });
}

export interface CourierPayoutLine {
  orderSummary: string;
  amount: number;
  deliveredAt: string;
}

// Tableau de bord public d'un livreur enregistré (/livreur/[token]) : trouve
// sa livraison actuellement assignée (au plus une à la fois — un livreur
// enchaîne les commandes une par une, pas de gestion de tournée ici) et
// renvoie le jeton de suivi correspondant pour rediriger vers la page de
// partage de position déjà existante (/livraison/[token]) — aucune UI dupliquée.
// Sans livraison en cours, renvoie plutôt "Mes gains"/"Mes performances" —
// pas de "Planning" (pas de créneaux/tournées dans ce modèle) ni de note
// client (aucune évaluation par livreur n'existe, voir CLAUDE.md : jamais de
// donnée inventée).
export async function getCourierDashboardAction(token: string): Promise<
  | {
      ok: true;
      name: string;
      activeDeliveryToken: string | null;
      totalDelivered: number;
      totalEarned: number;
      recentPayouts: CourierPayoutLine[];
    }
  | { ok: false; error: string }
> {
  const cleanToken = String(token || "").trim();
  if (!cleanToken) return { ok: false, error: "Ce lien n'est pas valide." };

  const courierSnap = await adminDb.collection("couriers").where("token", "==", cleanToken).limit(1).get();
  if (courierSnap.empty) return { ok: false, error: "Ce lien n'est pas valide." };
  const courierDoc = courierSnap.docs[0];
  const courier = courierDoc.data() as Omit<Courier, "id">;
  if (!courier.active) {
    return {
      ok: false,
      error: courier.pendingApproval
        ? "Votre inscription est en attente de validation. Ce lien s'activera dès qu'elle sera validée."
        : "Ce profil livreur n'est plus actif. Contactez-nous pour en savoir plus.",
    };
  }

  const assignedSnap = await adminDb.collection("orders").where("assignedCourierId", "==", courierDoc.id).get();
  const orderDoc = assignedSnap.docs
    .filter((doc) => COURIER_ACCESS_STATUSES.has(normalizeOrderStatus((doc.data() as Order).status)))
    .sort((a, b) => String((a.data() as Order).createdAt).localeCompare(String((b.data() as Order).createdAt)))[0];

  // Faible volume par livreur — calcul des totaux en mémoire plutôt qu'un
  // index composite Firestore supplémentaire (même choix que
  // getOrdersForCustomer, lib/data/orders.ts).
  const deliveredSnap = await adminDb
    .collection("orders")
    .where("assignedCourierId", "==", courierDoc.id)
    .where("status", "==", "livree")
    .get();
  const delivered = deliveredSnap.docs.map((d) => d.data() as Order).sort((a, b) => (b.deliveredAt || "").localeCompare(a.deliveredAt || ""));
  const totalDelivered = delivered.length;
  const totalEarned = delivered.reduce((sum, o) => sum + (o.courierPayout || 0), 0);
  const recentPayouts: CourierPayoutLine[] = delivered
    .slice(0, 10)
    .map((o) => ({ orderSummary: o.orderSummary, amount: o.courierPayout || 0, deliveredAt: o.deliveredAt || "" }));

  if (!orderDoc) {
    return { ok: true, name: courier.name, activeDeliveryToken: null, totalDelivered, totalEarned, recentPayouts };
  }

  const order = orderDoc.data() as Order;
  let deliveryToken = order.courierLocationToken;
  if (!deliveryToken) {
    deliveryToken = randomUUID();
    await orderDoc.ref.update({ courierLocationToken: deliveryToken });
  }

  return { ok: true, name: courier.name, activeDeliveryToken: deliveryToken, totalDelivered, totalEarned, recentPayouts };
}
