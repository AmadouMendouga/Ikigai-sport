"use client";

// Animated Testimonials — porté depuis js/animated-testimonials.js. Pile
// d'images en perspective (rotation aléatoire -10..10°, comme randomRotateY),
// saut vertical (y: 0,-80,0 sur 400ms) de l'image active, citation révélée
// mot par mot (flou 10px→0, 200ms, décalage 20ms/mot). Défilement auto 5.2s,
// pause au survol/focus/hors-écran/clic sur pause. Masque toute la section
// si `testimonials` est vide (voir usage dans la page).
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { Icon } from "@/components/icons/Icon";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import type { Testimonial } from "@/lib/types";

export interface AnimatedTestimonialsProps {
  testimonials: Testimonial[];
  autoplay?: boolean;
  interval?: number;
}

interface CardTransform {
  z: number;
  rot: number;
  scale: number;
  opacity: number;
}

const randomRotate = () => Math.floor(Math.random() * 21) - 10;
const tf = (s: Pick<CardTransform, "z" | "rot" | "scale">, y = 0) =>
  `translateZ(${s.z}px) translateY(${y}px) rotate(${s.rot}deg) scale(${s.scale})`;

export function AnimatedTestimonials({
  testimonials,
  autoplay = true,
  interval = 5200,
}: AnimatedTestimonialsProps) {
  const n = testimonials.length;
  const [active, setActive] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const reduce = useReducedMotion();

  const rootRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const nameRef = useRef<HTMLHeadingElement>(null);
  const roleRef = useRef<HTMLParagraphElement>(null);
  const quoteRef = useRef<HTMLParagraphElement>(null);
  // état courant de chaque carte, pour animer depuis la bonne position (pas du rendu React)
  const stateRef = useRef<CardTransform[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const activeRef = useRef(active);

  // Lecture/écriture de refs interdite pendant le rendu (react-hooks/refs) :
  // synchronisées via effet plutôt qu'en ligne dans le corps du composant.
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (stateRef.current.length !== n) {
      stateRef.current = testimonials.map(() => ({ z: -100, rot: randomRotate(), scale: 0.95, opacity: 0.7 }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n]);

  function go(i: number) {
    setActive(((i % n) + n) % n);
  }
  const next = () => go(activeRef.current + 1);
  const prev = () => go(activeRef.current - 1);

  function stop() {
    if (timerRef.current !== null) clearInterval(timerRef.current);
    timerRef.current = null;
  }
  function start() {
    if (!autoplay || reduce || userPaused || timerRef.current !== null || n <= 1) return;
    timerRef.current = setInterval(next, interval);
  }
  function restart() {
    stop();
    start();
  }

  // Anime la pile + le texte à chaque changement de témoignage actif.
  useEffect(() => {
    cardRefs.current.forEach((card, i) => {
      if (!card) return;
      const isActive = i === active;
      const from = stateRef.current[i];
      const to: CardTransform = {
        z: isActive ? 0 : -100,
        rot: isActive ? 0 : randomRotate(),
        scale: isActive ? 1 : 0.95,
        opacity: isActive ? 1 : 0.7,
      };
      card.style.zIndex = String(isActive ? 40 : n + 2 - i);
      card.setAttribute("aria-hidden", isActive ? "false" : "true");

      if (reduce || typeof card.animate !== "function") {
        card.style.transform = tf(to);
        card.style.opacity = String(to.opacity);
      } else {
        const frames: Keyframe[] = isActive
          ? [
              { transform: tf(from), opacity: from.opacity },
              {
                transform: tf(
                  { z: to.z / 2, rot: (from.rot + to.rot) / 2, scale: (from.scale + to.scale) / 2 },
                  -80
                ),
                opacity: (from.opacity + to.opacity) / 2,
                offset: 0.5,
              },
              { transform: tf(to), opacity: to.opacity },
            ]
          : [
              { transform: tf(from), opacity: from.opacity },
              { transform: tf(to), opacity: to.opacity },
            ];
        card.animate(frames, { duration: 400, easing: "ease-in-out", fill: "forwards" });
      }
      stateRef.current[i] = to;
    });

    const t = testimonials[active];
    if (!t) return;

    if (!reduce) {
      [nameRef.current, roleRef.current].forEach((el) => {
        if (el?.animate) {
          el.animate(
            [
              { transform: "translateY(20px)", opacity: 0 },
              { transform: "translateY(0)", opacity: 1 },
            ],
            { duration: 200, easing: "ease-in-out", fill: "backwards" }
          );
        }
      });
    }

    if (!reduce && quoteRef.current) {
      Array.from(quoteRef.current.querySelectorAll<HTMLSpanElement>(".w")).forEach((span, i) => {
        span.animate?.(
          [
            { filter: "blur(10px)", opacity: 0, transform: "translateY(5px)" },
            { filter: "blur(0px)", opacity: 1, transform: "translateY(0)" },
          ],
          { duration: 200, easing: "ease-in-out", delay: 20 * i, fill: "backwards" }
        );
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, n, reduce]);

  // Défilement auto, pause au survol/focus/hors-écran.
  useEffect(() => {
    restart();
    const root = rootRef.current;
    if (!root) return stop;

    root.addEventListener("mouseenter", stop);
    root.addEventListener("mouseleave", start);
    root.addEventListener("focusin", stop);
    root.addEventListener("focusout", start);

    let observer: IntersectionObserver | undefined;
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver(
        (entries) => entries.forEach((e) => (e.isIntersecting ? start() : stop())),
        { threshold: 0.25 }
      );
      observer.observe(root);
    }

    return () => {
      stop();
      root.removeEventListener("mouseenter", stop);
      root.removeEventListener("mouseleave", start);
      root.removeEventListener("focusin", stop);
      root.removeEventListener("focusout", start);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userPaused, autoplay, reduce, n]);

  if (n === 0) return null;
  const t = testimonials[active];

  return (
    <div
      ref={rootRef}
      className="at"
      role="region"
      aria-label="Témoignages clients"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "ArrowRight") {
          next();
          restart();
        }
        if (e.key === "ArrowLeft") {
          prev();
          restart();
        }
      }}
    >
      <div className="at-grid">
        <div className="at-stack">
          {testimonials.map((item, i) => (
            <div
              key={item.id}
              ref={(el) => {
                cardRefs.current[i] = el;
              }}
              className="at-card"
              aria-hidden={i !== active}
              onClick={() => {
                go(i);
                restart();
              }}
            >
              <Image src={item.photoUrl} alt={item.name} fill sizes="(max-width: 768px) 85vw, 400px" />
            </div>
          ))}
        </div>
        <div className="at-body">
          <div>
            <h3 className="at-name" ref={nameRef}>
              {t.name}
            </h3>
            <p className="at-role" ref={roleRef}>
              {t.designation}
            </p>
            <p className="at-quote" ref={quoteRef}>
              {t.quote
                .split(/\s+/)
                .filter(Boolean)
                .map((word, i) => (
                  <span className="w" key={i}>
                    {word}{" "}
                  </span>
                ))}
            </p>
            <p className="sr-only at-status" aria-live="polite" aria-atomic="true">
              {[t.name, t.designation, t.quote].filter(Boolean).join(". ")}
            </p>
          </div>
          <div className="at-nav">
            <button className="at-prev" aria-label="Témoignage précédent" onClick={() => { prev(); restart(); }}>
              <Icon name="arrow-back" />
            </button>
            <button className="at-next" aria-label="Témoignage suivant" onClick={() => { next(); restart(); }}>
              <Icon name="arrow-forward" />
            </button>
            {autoplay && !reduce && (
              <button
                className="at-toggle"
                type="button"
                aria-pressed={userPaused}
                aria-label={userPaused ? "Reprendre le défilement" : "Mettre le défilement en pause"}
                onClick={() => setUserPaused((p) => !p)}
              >
                {userPaused ? "Reprendre" : "Pause"}
              </button>
            )}
            <div className="at-dots" aria-hidden="true">
              {testimonials.map((item, i) => (
                <span key={item.id} className={i === active ? "on" : undefined} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
