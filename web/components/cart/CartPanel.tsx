"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { Icon } from "@/components/icons/Icon";
import { StatefulButton } from "@/components/StatefulButton";
import { showToast } from "@/components/Toast";
import { useCart } from "@/components/cart/CartContext";
import { auth } from "@/lib/firebase/client";
import { createCustomerOrderAction } from "@/lib/actions/orders";
import { initiateCampayPaymentAction } from "@/lib/actions/payments";
import { FCFA, freeShippingThreshold } from "@/lib/cart";
import type { SiteSettings } from "@/lib/types";

const DELIVERY_CHECK_DELAY = 1400;

export function CartPanel({ settings }: { settings: SiteSettings }) {
  const router = useRouter();
  const { sport } = useParams<{ sport: string }>();
  const { details, count, total, isPanelOpen, whatsappLink, removeFromCart, changeQty, closePanel } = useCart();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const checkoutKeysRef = useRef<{ signature: string; whatsapp: string; campay: string } | null>(null);

  function checkoutRequestId(channel: "whatsapp" | "campay"): string {
    const signature = JSON.stringify(details.map((d) => [d.slug, d.size, d.qty]));
    if (!checkoutKeysRef.current || checkoutKeysRef.current.signature !== signature) {
      checkoutKeysRef.current = {
        signature,
        whatsapp: crypto.randomUUID(),
        campay: crypto.randomUUID(),
      };
    }
    return checkoutKeysRef.current[channel];
  }

  // Réactif (pas juste auth.currentUser au clic) : au premier rendu, le SDK
  // Firebase n'a pas encore restauré la session, on ne peut savoir si un
  // client est connecté qu'en s'abonnant.
  useEffect(() => onAuthStateChanged(auth, (user) => setIsLoggedIn(!!user)), []);

  // Best effort : si un client est connecté (addendum 2), on enregistre aussi
  // la commande côté serveur pour qu'elle apparaisse dans « Mes commandes ».
  // N'affecte jamais le lien wa.me ni ne bloque la commande WhatsApp si ça
  // échoue — c'est ce canal-là qui compte réellement pour le client.
  async function recordCustomerOrder() {
    if (!auth.currentUser) return;
    try {
      await createCustomerOrderAction({
        items: details.map((d) => ({ slug: d.slug, size: d.size, qty: d.qty })),
        requestId: checkoutRequestId("whatsapp"),
      });
    } catch {
      // silencieux — voir le commentaire ci-dessus
    }
  }

  // Addendum 3 : second choix de paiement, uniquement pour les clients
  // connectés (il faut un numéro de téléphone et un compte à qui rattacher
  // la commande). Ne remplace jamais « Commander sur WhatsApp », qui reste
  // le canal principal.
  async function handlePayOnline() {
    const result = await initiateCampayPaymentAction({
      items: details.map((d) => ({ slug: d.slug, size: d.size, qty: d.qty })),
      requestId: checkoutRequestId("campay"),
    });
    if (!result.ok) {
      // Ne renouveler la clé que si le serveur confirme qu'une nouvelle
      // tentative est sans risque. Pour une erreur ambiguë ou une initiation
      // encore en cours, garder la même clé préserve l'idempotence et évite
      // de déclencher un deuxième paiement/réservation au clic suivant.
      if (result.retrySafe && checkoutKeysRef.current) {
        checkoutKeysRef.current.campay = crypto.randomUUID();
      }
      showToast(result.error, "error", true);
      throw new Error(result.error);
    }
    router.push(`/${sport}/compte/paiement/${result.orderId}`);
  }

  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [deliveryChecking, setDeliveryChecking] = useState(false);

  const verified = settings.catalogDataVerified && settings.commercialTermsVerified;

  // Vérification « livraison offerte » : shimmer puis résultat, comme runDeliveryCheck().
  useEffect(() => {
    if (!isPanelOpen || !verified) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- réinitialise l'affichage à la fermeture/donnée non vérifiée
      setDeliveryChecking(false);
      return;
    }
    setDeliveryChecking(true);
    const id = setTimeout(() => setDeliveryChecking(false), DELIVERY_CHECK_DELAY);
    return () => clearTimeout(id);
  }, [isPanelOpen, verified, total]);

  // Focus initial + piège à focus + fermeture Échap, comme initCart().
  useEffect(() => {
    if (!isPanelOpen) return;
    const raf = requestAnimationFrame(() => closeButtonRef.current?.focus());

    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closePanel(true);
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href]:not([aria-disabled="true"]), button:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => !el.hidden);
      if (!focusable.length) {
        e.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    function handleDocClick(e: MouseEvent) {
      const path = typeof e.composedPath === "function" ? e.composedPath() : [e.target as Node];
      const insideCart = path.some((el) => {
        if (!(el instanceof Element)) return false;
        return (
          el.classList?.contains("cart-panel") ||
          el.classList?.contains("cart-bar") ||
          el.classList?.contains("cart-btn") ||
          el.classList?.contains("quick-add") ||
          el.id === "addToCartBtn"
        );
      });
      if (!insideCart) closePanel(true);
    }

    document.addEventListener("keydown", handleKeydown);
    document.addEventListener("click", handleDocClick);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("click", handleDocClick);
    };
  }, [isPanelOpen, closePanel]);

  function handleQtyAction(index: number, action: "inc" | "dec" | "rm") {
    if (action === "inc") changeQty(index, 1);
    if (action === "dec") changeQty(index, -1);
    if (action === "rm") removeFromCart(index);

    const remainingLines = action === "rm" ? details.length - 1 : details.length;
    if (remainingLines <= 0) {
      closePanel(true);
      return;
    }
    requestAnimationFrame(() => {
      const nextIndex = Math.min(index, remainingLines - 1);
      const target =
        panelRef.current?.querySelector<HTMLButtonElement>(`button[data-act="${action}"][data-idx="${nextIndex}"]`) ??
        closeButtonRef.current;
      target?.focus();
    });
  }

  return (
    <div
      ref={panelRef}
      id="cartPanel"
      className={"cart-panel" + (isPanelOpen ? " open" : "")}
      role="dialog"
      aria-modal="true"
      aria-hidden={!isPanelOpen}
      aria-label="Votre panier"
      tabIndex={-1}
    >
      <div className="cart-panel-head">
        <Icon name="basket" />
        Votre panier
        <span className="count-chip">{count}</span>
        <button ref={closeButtonRef} className="close" aria-label="Fermer" onClick={() => closePanel(true)}>
          <Icon name="close" size="sm" />
        </button>
      </div>

      <div className="cart-panel-items" aria-live="polite">
        {details.length === 0 ? (
          <div className="cart-empty">
            <Icon name="basket" />
            <div>Votre panier est vide.</div>
          </div>
        ) : (
          details.map((item, idx) => (
            <div className="cp-item" key={item.slug + item.size}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.product.images.square} alt="" />
              <div className="cp-info">
                <div className="cp-cat">
                  {item.product.leagueLabel || "Maillot"} · {item.size}
                </div>
                <div className="cp-name">{item.product.name}</div>
                <div className="cp-qty">
                  <button
                    type="button"
                    data-act="dec"
                    data-idx={idx}
                    aria-label={`Diminuer la quantité de ${item.product.name}`}
                    onClick={() => handleQtyAction(idx, "dec")}
                  >
                    <Icon name="remove" size="sm" />
                  </button>
                  <span>{item.qty}</span>
                  <button
                    type="button"
                    data-act="inc"
                    data-idx={idx}
                    aria-label={`Augmenter la quantité de ${item.product.name}`}
                    onClick={() => handleQtyAction(idx, "inc")}
                  >
                    <Icon name="add" size="sm" />
                  </button>
                  <button
                    type="button"
                    data-act="rm"
                    data-idx={idx}
                    aria-label={`Retirer ${item.product.name} du panier`}
                    onClick={() => handleQtyAction(idx, "rm")}
                  >
                    <Icon name="delete" size="sm" />
                  </button>
                </div>
              </div>
              <span className="cp-price">{FCFA(Number(item.product.price || 0) * item.qty)}</span>
            </div>
          ))
        )}
      </div>

      <div className="cp-delivery eligible" role="status" aria-live="polite">
        {!verified ? (
          <>
            <Icon name="info" size="sm" />
            Frais et délais de livraison à confirmer sur WhatsApp
          </>
        ) : deliveryChecking ? (
          "Vérification du seuil tarifaire…"
        ) : total >= freeShippingThreshold(settings) ? (
          <>
            <Icon name="check-circle" size="sm" />
            Seuil tarifaire atteint — éligibilité selon la zone
          </>
        ) : (
          <>
            <Icon name="shipping" size="sm" />
            Plus que {FCFA(Math.max(0, freeShippingThreshold(settings) - total))} pour atteindre le seuil tarifaire
          </>
        )}
      </div>

      <div className="cp-subtotal">
        <span>{settings.catalogDataVerified ? "Sous-total" : "Sous-total indicatif"}</span>
        <span className="amount">{FCFA(total)}</span>
      </div>

      <StatefulButton
        className="cp-checkout"
        href={whatsappLink}
        target="_blank"
        rel="noopener"
        onValidate={() => {
          if (count > 0) return true;
          showToast("Votre panier est vide", "error", true);
          return false;
        }}
        onRun={async () => {
          await Promise.all([recordCustomerOrder(), new Promise<void>((r) => setTimeout(r, 700))]);
        }}
      >
        <span>Commander sur WhatsApp</span>
        <span className="right">
          <span>{FCFA(total)}</span>
          <Icon name="chevron-right" size="sm" />
        </span>
      </StatefulButton>

      {isLoggedIn ? (
        <StatefulButton
          className="btn btn-tonal btn-block"
          onValidate={() => {
            if (count > 0) return true;
            showToast("Votre panier est vide", "error", true);
            return false;
          }}
          onRun={handlePayOnline}
        >
          <Icon name="payment" size="sm" />
          Payer par Mobile Money
        </StatefulButton>
      ) : null}
    </div>
  );
}
