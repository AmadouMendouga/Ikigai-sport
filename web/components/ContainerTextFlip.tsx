"use client";

// Container Text Flip — porté depuis js/container-text-flip.js. L'intervalle
// reste configurable ; la largeur suit désormais directement le mot mesuré
// pour éviter une animation de layout coûteuse. Les lettres gardent leur
// fondu-flou décalé, sauf si l'utilisateur préfère réduire les animations.
import { useEffect, useState } from "react";
import { useReducedMotion } from "@/hooks/useReducedMotion";

export interface ContainerTextFlipProps {
  words: string[];
  interval?: number;
  /** Conservé pour compatibilité avec les appels existants ; la largeur n'est plus animée. */
  duration?: number;
}

export function ContainerTextFlip({ words, interval = 3000 }: ContainerTextFlipProps) {
  const [index, setIndex] = useState(0);
  const [width, setWidth] = useState<number>();
  const reduce = useReducedMotion();
  const wordsKey = words.join(" ");
  const word = words[Math.min(index, Math.max(words.length - 1, 0))] ?? "";

  // Mesure le mot courant via une sonde hors-écran, comme measure() d'origine.
  // Lecture de layout après commit : un effet est le bon outil ici, la
  // règle react-hooks/set-state-in-effect ne modélise pas encore ce cas.
  useEffect(() => {
    if (!word) return;
    const probe = document.createElement("span");
    probe.className = "ctf-text";
    probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;left:-9999px;";
    probe.textContent = word;
    document.body.appendChild(probe);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWidth(probe.getBoundingClientRect().width + 30);
    probe.remove();
  }, [word]);

  useEffect(() => {
    if (reduce || words.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % words.length);
    }, interval);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduce, wordsKey, interval]);

  if (!words.length) return null;

  return (
    <span className="ctf-pill" style={{ width }}>
      <span className="ctf-text" key={index}>
        {Array.from(word).map((ch, idx) => (
          <span
            key={idx}
            className="ctf-letter"
            style={reduce ? undefined : { animationDelay: `${idx * 20}ms` }}
          >
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}
