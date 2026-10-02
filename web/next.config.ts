import type { NextConfig } from "next";
import path from "node:path";

// En-têtes de sécurité envoyés sur toutes les réponses. Vercel n'ajoute que
// HSTS de lui-même ; les protections ci-dessous n'existaient que sur l'ancien
// site statique (vercel.json à la racine), jamais sur cette application.
//
// La CSP est volontairement limitée aux directives qui ne dépendent d'aucune
// liste de domaines : interdiction d'afficher le site dans une page tierce
// (frame-ancestors), de détourner les liens relatifs (base-uri), d'embarquer
// des plugins (object-src) ou d'envoyer un formulaire ailleurs (form-action).
// Pas de script-src/connect-src ici : une liste incomplète couperait la carte
// de livraison (OpenFreeMap, OSRM), les envois Cloudinary ou la connexion
// Firebase — à n'ajouter qu'après avoir testé chaque parcours.
//
// Permissions-Policy : la géolocalisation (partage de position) et la caméra
// (scan du QR de remise) restent autorisées pour le site lui-même, et
// seulement pour lui.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=(), payment=(), usb=()" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'; base-uri 'self'; object-src 'none'; form-action 'self'" },
  // Force les navigateurs à n'accéder au site qu'en HTTPS pendant 2 ans, y
  // compris pour les sous-domaines. Vercel active HTTPS mais n'injecte pas cet
  // en-tête lui-même : sans lui un premier accès HTTP reste possible.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  turbopack: {
    root: path.join(__dirname),
  },
  // Domaines autorisés pour le composant <Image> de Next.js.
  // Sans cette liste, toute URL externe passée à <Image src="…"> provoque une
  // erreur de domaine non autorisé — c'est pourquoi certains composants
  // utilisaient encore <img> natif pour les photos Cloudinary.
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "res.cloudinary.com",
      },
    ],
  },
  // N'annonce pas la technologie utilisée (en-tête X-Powered-By).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Pivot portail multi-sports : le site football (ex. "Le Maillot Idéal")
  // vit maintenant sous /football/*, et / est devenu le portail multi-sports
  // (voir le plan). Le site est déjà en ligne avec de vrais clients et des
  // liens WhatsApp déjà partagés — redirige les anciennes URLs plutôt que de
  // les casser.
  async redirects() {
    return [
      { source: "/boutique", destination: "/football/boutique", permanent: true },
      { source: "/boutique/:path*", destination: "/football/boutique/:path*", permanent: true },
      { source: "/produits/:path*", destination: "/football/produits/:path*", permanent: true },
      { source: "/phototheque", destination: "/football/phototheque", permanent: true },
      { source: "/compte", destination: "/football/compte", permanent: true },
      { source: "/compte/:path*", destination: "/football/compte/:path*", permanent: true },
    ];
  },
};

export default nextConfig;
