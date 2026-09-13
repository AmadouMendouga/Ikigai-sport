"use client";

// Attente + suivi du paiement CamPay (addendum 3). Interroge
// checkPaymentStatusAction toutes les 3s (lecture Firestore, rapide/gratuite)
// tant que le statut est "pending" ; passé ~90s, propose une vérification en
// direct auprès de CamPay (filet de secours si le webhook tarde).
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { checkPaymentStatusAction } from "@/lib/actions/payments";
import type { PaymentStatus } from "@/lib/types";

const POLL_INTERVAL_MS = 3000;
const LIVE_CHECK_AFTER_POLLS = 30; // ~90s

export function PaymentStatusPoller({
  orderId,
  initialStatus,
  initialReason,
  ussdCode,
}: {
  orderId: string;
  initialStatus: PaymentStatus;
  initialReason: string | null;
  ussdCode: string | null;
}) {
  const { sport } = useParams<{ sport: string }>();
  const [status, setStatus] = useState<PaymentStatus>(initialStatus);
  const [reason, setReason] = useState<string | null>(initialReason);
  const [checking, setChecking] = useState(false);
  const [canCheckManually, setCanCheckManually] = useState(false);
  const pollCountRef = useRef(0);

  useEffect(() => {
    if (status !== "pending") return;

    const id = setInterval(async () => {
      pollCountRef.current += 1;
      if (pollCountRef.current >= LIVE_CHECK_AFTER_POLLS) setCanCheckManually(true);
      const result = await checkPaymentStatusAction(orderId);
      if (result.ok) {
        setStatus(result.paymentStatus);
        setReason(result.paymentFailureReason);
      }
    }, POLL_INTERVAL_MS);

    return () => clearInterval(id);
  }, [orderId, status]);

  useEffect(() => {
    if (status === "paid") {
      try {
        localStorage.removeItem("lmi_cart_v3");
      } catch {
        // stockage indisponible — pas bloquant, la commande est déjà enregistrée
      }
    }
  }, [status]);

  async function handleManualCheck() {
    setChecking(true);
    try {
      const result = await checkPaymentStatusAction(orderId, { forceLiveCheck: true });
      if (result.ok) {
        setStatus(result.paymentStatus);
        setReason(result.paymentFailureReason);
      }
    } finally {
      setChecking(false);
    }
  }

  if (status === "paid") {
    return (
      <div className="contact-card review-thanks">
        <Icon name="check-circle" size="xl" />
        <h3>Paiement confirmé !</h3>
        <p>Votre commande est enregistrée. Merci pour votre achat.</p>
        <Link href={`/${sport}/compte/commandes`} className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
          Voir mes commandes
        </Link>
      </div>
    );
  }

  if (status === "review") {
    return (
      <div className="contact-card">
        <Icon name="info" size="xl" />
        <h3>Paiement reçu — vérification nécessaire</h3>
        <p>{reason || "Votre paiement a été reçu, mais la disponibilité doit être vérifiée par notre équipe."}</p>
        <p className="form-note">Ne recommencez pas le paiement. Nous vous contacterons pour finaliser la commande.</p>
        <Link href={`/${sport}/compte/commandes`} className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
          Voir mes commandes
        </Link>
      </div>
    );
  }

  if (status === "failed") {
    return (
      <div className="contact-card">
        <h3>Paiement refusé</h3>
        <p>{reason || "La transaction n'a pas pu être complétée."}</p>
        <Link href={`/${sport}/boutique`} className="btn btn-primary btn-block" style={{ marginTop: 14 }}>
          Retourner à la boutique
        </Link>
      </div>
    );
  }

  const uncertain = Boolean(reason) && !ussdCode;

  return (
    <div className="contact-card">
      <h3>{uncertain ? "Paiement en cours de vérification" : "En attente de confirmation"}</h3>
      {uncertain ? (
        <div className="payment-warning" role="status" aria-live="polite">
          <Icon name="info" size="sm" />
          <div>
            <strong>Ne relancez pas le paiement.</strong>
            <p>{reason}</p>
          </div>
        </div>
      ) : ussdCode ? (
        <p>
          Composez <strong>{ussdCode}</strong> sur votre téléphone pour confirmer le paiement, ou
          validez le code PIN reçu par notification.
        </p>
      ) : (
        <p>Vérifiez votre téléphone pour confirmer le paiement.</p>
      )}
      <p className="form-note">Cette page se met à jour automatiquement — pas besoin de la rafraîchir.</p>
      {canCheckManually ? (
        <button
          type="button"
          className="btn btn-tonal btn-block"
          onClick={handleManualCheck}
          disabled={checking}
          style={{ marginTop: 14 }}
        >
          <Icon name="refresh" size="sm" />
          {checking ? "Vérification…" : "Vérifier maintenant"}
        </button>
      ) : null}
    </div>
  );
}
