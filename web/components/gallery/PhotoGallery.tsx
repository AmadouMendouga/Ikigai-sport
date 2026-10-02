"use client";

// Galerie + visionneuse — porté depuis le script inline de phototheque.html.
// Chaque vignette réutilise Direction Aware Hover ; la visionneuse gère
// flèches clavier, Échap, clic sur le fond, boutons précédent/suivant.
import { useEffect, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/icons/Icon";
import { useDirectionAwareHover } from "@/hooks/useDirectionAwareHover";
import type { GalleryItem } from "@/lib/types";

function PhotoGridItem({ item, index, onOpen }: { item: GalleryItem; index: number; onOpen: (i: number) => void }) {
  const dah = useDirectionAwareHover<HTMLButtonElement>();
  return (
    <button className="photo-item dah" aria-label={`Agrandir la photo ${index + 1}`} onClick={() => onOpen(index)} {...dah}>
      <span className="dah-img">
        <Image
          src={item.thumb}
          alt={`Photo ${index + 1}`}
          width={400}
          height={400}
          sizes="(max-width: 560px) 50vw, (max-width: 940px) 33vw, 25vw"
          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
        />
      </span>
      <span className="dah-overlay" />
      <span className="dah-caption">
        <span className="t">Photo {index + 1}</span>
        <span className="s">
          <Icon name="zoom" />
          Agrandir
        </span>
      </span>
    </button>
  );
}

export function PhotoGallery({ items }: { items: GalleryItem[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const normalize = (i: number) => ((i % items.length) + items.length) % items.length;

  function show(i: number) {
    setOpenIndex(normalize(i));
  }

  // Formulaire fonctionnel de setState : toujours correct même si plusieurs
  // appels s'enchaînent avant le prochain rendu (flèche maintenue enfoncée,
  // double-clic rapide) — contrairement à `show(openIndex + delta)`, qui
  // capturerait une valeur d'`openIndex` déjà obsolète dans ce cas.
  function step(delta: number) {
    setOpenIndex((prev) => normalize((prev ?? 0) + delta));
  }

  useEffect(() => {
    if (openIndex === null) return;
    function handleKeydown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpenIndex(null);
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    }
    document.addEventListener("keydown", handleKeydown);
    return () => document.removeEventListener("keydown", handleKeydown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openIndex]);

  const current = openIndex !== null ? items[openIndex] : null;

  return (
    <>
      <div className="photo-grid" id="photoGrid">
        {items.map((item, i) => (
          <PhotoGridItem key={i} item={item} index={i} onOpen={show} />
        ))}
      </div>

      <div
        className={"lightbox" + (current ? " open" : "")}
        role="dialog"
        aria-modal="true"
        aria-hidden={!current}
        aria-label="Aperçu de la photo"
        tabIndex={-1}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpenIndex(null);
        }}
      >
        <button className="lb-close" aria-label="Fermer" onClick={() => setOpenIndex(null)}>
          <Icon name="close" size="lg" />
        </button>
        <button
          className="lb-prev"
          aria-label="Photo précédente"
          onClick={(e) => {
            e.stopPropagation();
            step(-1);
          }}
        >
          <Icon name="chevron-left" size="lg" />
        </button>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={current?.src || ""} alt={current ? `Photo ${openIndex! + 1}` : ""} />
        <button
          className="lb-next"
          aria-label="Photo suivante"
          onClick={(e) => {
            e.stopPropagation();
            step(1);
          }}
        >
          <Icon name="chevron-right" size="lg" />
        </button>
      </div>
    </>
  );
}
