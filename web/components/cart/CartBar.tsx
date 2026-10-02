"use client";

import { useEffect, useRef } from "react";
import Image from "next/image";
import { Icon } from "@/components/icons/Icon";
import { useCart } from "@/components/cart/CartContext";

export function CartBar() {
  const { details, count, isPanelOpen, bumpSignal, barRef, openPanel } = useCart();
  const shown = count > 0 && !isPanelOpen;
  const wasShownRef = useRef(false);
  const skipBumpRef = useRef(true);

  // `body.cart-bar-visible` réserve de la place en bas de page pour la barre flottante.
  useEffect(() => {
    document.body.classList.toggle("cart-bar-visible", shown);
    return () => document.body.classList.remove("cart-bar-visible");
  }, [shown]);

  // Rebond uniquement quand un article est ajouté alors que la barre est déjà visible
  // (pas à la toute première apparition) — même logique que renderCart(bump) d'origine.
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    if (skipBumpRef.current) {
      skipBumpRef.current = false;
      return;
    }
    if (!wasShownRef.current) return;
    bar.classList.remove("bump");
    void bar.offsetWidth;
    bar.classList.add("bump");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bumpSignal]);

  useEffect(() => {
    wasShownRef.current = shown;
  }, [shown]);

  // Le bouton reste toujours dans le DOM (masqué par CSS via .show, cf.
  // lmi.css) — comme dans le HTML statique d'origine. Le démonter quand le
  // panier est vide casserait la cible du vol de vignette (flyToCart) pour
  // le tout premier article ajouté d'une session : la barre n'existerait pas
  // encore au moment du clic si elle n'était rendue qu'après coup.
  const thumbs = details.slice(0, 3);
  const extra = details.length - thumbs.length;

  return (
    <button
      ref={barRef}
      className={"cart-bar" + (shown ? " show" : "")}
      aria-label="Voir le panier"
      aria-controls="cartPanel"
      aria-expanded={isPanelOpen}
      onClick={(e) => openPanel(e.currentTarget)}
    >
      <span className="cart-bar-thumbs">
        {thumbs.map((item, i) => (
          <Image key={item.slug + item.size + i} src={item.product.images.square} alt="" width={30} height={30} />
        ))}
        {extra > 0 && <span className="more">+{extra}</span>}
      </span>
      <span className="cart-bar-text">
        <strong>Voir le panier</strong>
        <span>
          {count} article{count > 1 ? "s" : ""}
        </span>
      </span>
      <span className="cart-bar-go">
        <Icon name="chevron-right" />
      </span>
    </button>
  );
}
