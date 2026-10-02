import type { Metadata } from "next";
import Image from "next/image";
import { getAllSports } from "@/lib/data/sports";
import { getAllProducts } from "@/lib/data/products";
import { getSiteSettings } from "@/lib/data/settings";
import { getTestimonials } from "@/lib/data/testimonials";
import { Icon } from "@/components/icons/Icon";
import { StorefrontWelcome } from "@/components/account/StorefrontWelcome";
import { PortalHeader } from "@/components/portal/PortalHeader";
import { PortalHero, type PortalHeroSlide } from "@/components/portal/PortalHero";
import { PortalSpotlight, type PortalSpotlightItem } from "@/components/portal/PortalSpotlight";
import { PortalFooter } from "@/components/portal/PortalFooter";
import { WhatsAppFloat } from "@/components/layout/WhatsAppFloat";
import { BackToTop } from "@/components/layout/BackToTop";
import { SportMarquee } from "@/components/home/SportMarquee";
import { SportGrid } from "@/components/home/SportGrid";
import { AnimatedTestimonials } from "@/components/AnimatedTestimonials";
import { safeColor } from "@/lib/format";
import type { Product } from "@/lib/types";

export const metadata: Metadata = {
  title: "IKIGAI Sport",
  description:
    "IKIGAI Sport réunit au Cameroun plusieurs univers sportifs : maillots, judogi, équipements de combat, basketball et sneakers.",
};

// Portail — page vitrine, pas de catalogue à ce niveau (voir le plan "portail
// multi-sports"). Chaque carte mène vers le site complet d'un sport
// (/[sport]), avec sa propre boutique et son propre discours marketing.
// Structure et animations empruntées à Site reussi/restrowebsite (hero à
// diapositives, cartes vedette, à propos, liste catalogue, témoignages) —
// avec de vraies photos du catalogue en attendant de vraies photos de mise
// en scène (voir chaque composant portal/*).
export default async function PortalPage() {
  const [sports, products, settings, testimonials] = await Promise.all([
    getAllSports(),
    getAllProducts(),
    getSiteSettings(),
    getTestimonials(),
  ]);

  const image = (p: Product | undefined) => p?.images.wide || p?.images.square || "";

  const football = sports.find((s) => s.key === "football");
  const footballProducts = products.filter((p) => p.sport === "football");
  const footballCount = footballProducts.length;

  const combatKeys = ["judo", "kendo", "nippon-kempo"];
  const combatSports = sports.filter((s) => combatKeys.includes(s.key));
  const combatProducts = products.filter((p) => combatSports.some((s) => s.key === p.sport));
  const combatCount = combatProducts.length;

  const recentKeys = ["basketball", "sneakers"];
  const recentSports = sports.filter((s) => recentKeys.includes(s.key));
  const recentProducts = products.filter((p) => recentSports.some((s) => s.key === p.sport));
  const recentCount = recentProducts.length;

  // Diapositives du hero — dérivées du catalogue réel (compteurs, sports
  // existants), jamais de texte marketing inventé.
  const slides: PortalHeroSlide[] = [
    {
      eyebrow: "Votre boutique multisport au Cameroun",
      title: "Un seul espace, plusieurs univers.",
      // "univers", pas "sport" : Sneakers y figure aussi, et ce n'en est pas un
      // (retour client du 06/09/2026 — voir aussi PortalFooter/Footer).
      lead: `${settings.businessName} regroupe des boutiques dédiées à chaque univers. Choisissez le vôtre pour accéder à son catalogue.`,
      ctaLabel: "Choisir un univers",
      ctaHref: "#sports",
      color: "var(--hero-bg)",
      image: image(footballProducts[0]),
    },
  ];
  if (football && footballCount > 0) {
    slides.push({
      eyebrow: "Notre sélection la plus large",
      title: `${footballCount} maillots de football.`,
      lead: "Retrouvez les grands championnats et les équipes disponibles dans notre sélection.",
      ctaLabel: "Voir la boutique Football",
      ctaHref: "/football",
      color: safeColor(football.color),
      // Photo fournie par le client (recadrée pour retirer le filigrane d'un
      // tiers), pas une photo produit du catalogue — même logique que
      // arts-martiaux-judoka plus bas.
      image: "https://res.cloudinary.com/ijazcmgk/image/upload/v1788887586/le-maillot-ideal/portal/spotlight/football-real-madrid.png",
    });
  }
  if (recentSports.length > 0 && recentCount > 0) {
    slides.push({
      eyebrow: "Nouveautés",
      title: recentSports.map((s) => s.label).join(" & ") + ".",
      lead: `${recentCount} articles au catalogue — les dernières arrivées IKIGAI Sport.`,
      ctaLabel: "Choisir un univers",
      ctaHref: "#sports",
      color: safeColor(recentSports[0].color),
      image: image(recentProducts[0]),
    });
  }

  // Cartes vedette — mêmes regroupements que le hero, avec d'autres photos
  // du catalogue pour varier les visuels d'une section à l'autre.
  // gradientColor : couleur du voile choisie en admin pour cette carte (onglet
  // Réglages du site) — absente = voile calculé automatiquement depuis la photo,
  // voir useAutoTint dans PortalSpotlight.tsx.
  const spotlightGradients = settings.spotlightGradients || {};
  const spotlight: PortalSpotlightItem[] = [];
  if (football && footballCount > 0) {
    spotlight.push({
      key: "football",
      title: "Football",
      count: footballCount,
      href: "/football",
      image: image(footballProducts[2] || footballProducts[0]),
      gradientColor: spotlightGradients["football"],
    });
  }
  if (combatSports.length > 0 && combatCount > 0) {
    spotlight.push({
      key: "arts-martiaux",
      title: "Arts martiaux",
      count: combatCount,
      href: "#sports",
      // Photo fournie par le client (judoka en kimono), pas une photo produit du catalogue.
      image: "https://res.cloudinary.com/ijazcmgk/image/upload/v1788582494/le-maillot-ideal/portal/spotlight/arts-martiaux-judoka.jpg",
      gradientColor: spotlightGradients["arts-martiaux"],
    });
  }
  if (recentSports.length > 0 && recentCount > 0) {
    spotlight.push({
      key: "recent-sports",
      title: recentSports.map((s) => s.label).join(" & "),
      count: recentCount,
      href: "#sports",
      image: image(recentProducts[1] || recentProducts[0]),
      gradientColor: spotlightGradients["recent-sports"],
    });
  }
  // Aperçus boutique/produits, pas rattachés à un sport précis : ils
  // renvoient vers Sneakers, l'univers le plus proche du contenu.
  spotlight.push(
    {
      key: "reel-boutique-1",
      title: "Dans notre boutique",
      href: "/sneakers",
      image: "https://res.cloudinary.com/ijazcmgk/image/upload/v1788538920/le-maillot-ideal/portal/spotlight/boutique-poster.jpg",
      video: "https://res.cloudinary.com/ijazcmgk/video/upload/v1788538834/le-maillot-ideal/portal/spotlight/boutique.mp4",
      gradientColor: spotlightGradients["reel-boutique-1"],
    },
    {
      key: "reel-boutique-2",
      title: "Nouveautés en boutique",
      href: "/sneakers",
      image: "https://res.cloudinary.com/ijazcmgk/image/upload/v1788548899/le-maillot-ideal/portal/spotlight/boutique-2-poster.jpg",
      video: "https://res.cloudinary.com/ijazcmgk/video/upload/v1788548884/le-maillot-ideal/portal/spotlight/boutique-2.mp4",
      gradientColor: spotlightGradients["reel-boutique-2"],
    },
    {
      key: "reel-boutique-3",
      title: "Zoom sur les tissus",
      href: "/sneakers",
      image: "https://res.cloudinary.com/ijazcmgk/image/upload/v1788548903/le-maillot-ideal/portal/spotlight/boutique-3-poster.jpg",
      video: "https://res.cloudinary.com/ijazcmgk/video/upload/v1788548896/le-maillot-ideal/portal/spotlight/boutique-3.mp4",
      gradientColor: spotlightGradients["reel-boutique-3"],
    }
  );

  // Même sport pour les deux photos : les mélanger (judo en photo principale,
  // sneaker en médaillon) ne se lisait pas comme de la diversité mais comme
  // une erreur — « pourquoi cette chaussure ? ». Football (le plus grand
  // catalogue) garantit toujours deux photos distinctes disponibles.
  const aboutMainImage = image(footballProducts[3] || combatProducts[1]);
  const aboutAccentImage = image(footballProducts[4] || combatProducts[0]);

  return (
    <div className="ik-app ik-portal">
      <a href="#main" className="skip-link">
        Aller au contenu principal
      </a>
      <PortalHeader settings={settings} sports={sports} />

      <main id="main">
        {sports[0] ? <StorefrontWelcome sport={sports[0].key} /> : null}
        <PortalHero slides={slides} />

        <SportMarquee sports={sports} products={products} />

        {spotlight.length > 0 && (
          <section className="section">
            <div className="container">
              <div className="section-head">
                <div>
                  <h2>À la une : découvrez nos univers</h2>
                </div>
              </div>
            </div>
            <PortalSpotlight items={spotlight} />
          </section>
        )}

        <section className="section section-alt">
          <div className="container">
            <div className="about-grid">
              <div className="portal-about-media">
                {aboutMainImage && (
                  <Image
                    className="main"
                    src={aboutMainImage}
                    alt=""
                    width={400}
                    height={500}
                    sizes="(max-width: 880px) 100vw, 40vw"
                  />
                )}
                {aboutAccentImage && (
                  <div className="accent">
                    <Image
                      src={aboutAccentImage}
                      alt=""
                      width={300}
                      height={300}
                      sizes="20vw"
                      style={{ width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  </div>
                )}
              </div>
              <div className="about-text">
                <h3>Qui sommes-nous ?</h3>
                <p>
                  {settings.businessName} est géré par Amadou, à Douala. Chaque commande est suivie personnellement,
                  de sa confirmation jusqu&apos;à la livraison, quel que soit l&apos;univers choisi.
                </p>
                <div className="about-badges">
                  <span>
                    <Icon name="location" size="sm" />
                    Basé au Cameroun
                  </span>
                  <span>
                    <Icon name="whatsapp" size="sm" />
                    Joignable directement sur WhatsApp
                  </span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="section" id="sports">
          <div className="container">
            <div className="section-head">
              <div>
                <h2>Trouvez l&apos;univers qui vous ressemble</h2>
                <p>Chaque univers possède sa boutique, ses fiches produit et son catalogue dédié.</p>
              </div>
            </div>
            <SportGrid sports={sports} products={products} />
          </div>
        </section>

        <section className="services-strip">
          <div className="container">
            <div className="services-grid">
              <div className="service-item">
                <span className="ic">
                  <Icon name="whatsapp" size="lg" />
                </span>
                <div>
                  <p className="service-title">Commande WhatsApp</p>
                  <p>Rapide, simple, sans compte à créer</p>
                </div>
              </div>
              <div className="service-item">
                <span className="ic">
                  <Icon name="money" size="lg" />
                </span>
                <div>
                  <p className="service-title">Paiement flexible</p>
                  <p>Mobile Money en ligne ou modalités convenues sur WhatsApp</p>
                </div>
              </div>
              <div className="service-item">
                <span className="ic">
                  <Icon name="shipping" size="lg" />
                </span>
                <div>
                  <p className="service-title">Livraison à confirmer</p>
                  <p>Zone, délai et frais précisés avant la commande</p>
                </div>
              </div>
              <div className="service-item">
                <span className="ic">
                  <Icon name="check-circle" size="lg" />
                </span>
                <div>
                  <p className="service-title">Une boutique par univers</p>
                  <p>Un catalogue clair et dédié à chaque pratique</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        {settings.showTestimonials && testimonials.length > 0 && (
          <section className="section section-alt">
            <div className="container">
              <div className="section-head">
                <div>
                  <span className="eyebrow">
                    <Icon name="star" size="sm" />
                    Témoignages
                  </span>
                  <h2>Avis de nos clients</h2>
                </div>
              </div>
              <AnimatedTestimonials testimonials={testimonials} />
            </div>
          </section>
        )}
      </main>

      <PortalFooter sports={sports} settings={settings} products={products} />
      <WhatsAppFloat settings={settings} />
      <BackToTop />
    </div>
  );
}
