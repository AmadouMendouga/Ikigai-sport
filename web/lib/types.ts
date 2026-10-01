// "Domicile"/"Extérieur"/"Third" reste la liste figée proposée en admin quand
// sport === "football" (voir ProductEditDrawer/ProductCreateDrawer), mais le
// champ produit lui-même est un string libre depuis la migration IKIGAI Sport
// (multi-sports) — un judogi ou une sneaker n'a pas de "Domicile/Extérieur".
export type Kit = "Domicile" | "Extérieur" | "Third";

export interface ProductImages {
  square: string;
  wide: string;
  svgFallback: string;
  /** Photos supplémentaires du même maillot (optionnel — absent sur les anciens produits). */
  gallery?: string[];
}

export interface Product {
  slug: string;
  name: string;
  team: string;
  /** Libre depuis IKIGAI Sport (ex-union stricte "Domicile"|"Extérieur"|"Third") — non validé au runtime, voir productPatchError. */
  kit?: string;
  /** Code que l'admin choisit lui-même — pas généré par le site — pour retrouver
   * un produit en tapant/scannant ce code dans la recherche de l'admin. Même
   * principe qu'un code-barres d'inventaire (voir flutter_billing_app, l'app
   * de caisse du client, qui utilise le même genre de code pour ses propres
   * articles) : aucun format imposé, l'admin garde le sien s'il en a déjà un. */
  barcode?: string;
  sport: string;
  sportLabel: string;
  /** Optionnel : seuls les produits rattachés à un championnat (football aujourd'hui) en ont un. */
  league?: string;
  leagueLabel?: string;
  color: string;
  season: string;
  priceOriginal: number;
  price: number;
  discountPct: number;
  isNew: boolean;
  stock: number;
  rating: number | null;
  reviews: number;
  sizes: string[];
  kidsAvailable: boolean;
  description: string;
  images: ProductImages;
  /** Vidéo de présentation courte (reel), optionnelle — voir ProductDetail. */
  reelUrl?: string;
  updatedAt: string;
  updatedBy: string;
}

export interface Sport {
  key: string;
  label: string;
  color: string;
  logo: string;
  /** Bandeau d'accueil et chiffres clés du site de ce sport — propres à chaque sport
   * depuis la migration portail (avant : globaux dans SiteSettings, ce qui mélangeait
   * le discours "maillot" avec les autres sports). */
  heroBadge: string;
  heroTitle1: string;
  heroTitle2: string;
  heroLead: string;
  statDelay: string;
  statDelayLabel: string;
  statRating: string;
  statRatingLabel: string;
}

export interface League {
  key: string;
  label: string;
  color: string;
  logo: string;
  /** FK vers sports/{key} — sans ça, les championnats de plusieurs sports se mélangeraient dans un seul pool. */
  sport: string;
  teams: string[];
}

export interface GalleryItem {
  id: string;
  src: string;
  thumb: string;
  order: number;
  createdAt: string;
}

export interface Testimonial {
  id: string;
  quote: string;
  name: string;
  designation: string;
  photoUrl: string;
  order: number;
}

// Livreur enregistré via /livreur/inscription — solution principale pour qui
// livre régulièrement (accès permanent à ses livraisons assignées via son
// propre lien, sans coordination manuelle par commande). L'admin peut aussi
// continuer à générer un lien ponctuel non rattaché à un profil (aide
// occasionnelle, ou aucun livreur enregistré disponible) — voir
// Order.assignedCourierId, qui reste optionnel.
export interface Courier {
  id: string;
  name: string;
  phone: string;
  /** Jeton permanent, personnel — donne accès à /livreur/[token] tant qu'il reste actif. */
  token: string;
  active: boolean;
  /** Inscription publique pas encore validée par l'admin. Absent sur les
   * profils créés avant cette validation (ils restent tels quels). */
  pendingApproval?: boolean;
  createdAt: string;
}

export type OrderStatus =
  | "recue"
  | "confirmee"
  | "preparation"
  | "prete"
  | "livreur_assigne"
  | "en_route"
  | "arrivee"
  | "livree"
  | "reportee"
  | "annulee";
export type DeliveryIncidentType = "client_injoignable" | "adresse_incorrecte" | "livreur_indisponible" | "report_client" | "autre";
export type PaymentStatus = "unpaid" | "pending" | "paid" | "failed" | "review";
export type OrderStockState = "reserved" | "committed" | "released" | "needs_review";

export interface OrderItem {
  slug: string;
  size: string;
  qty: number;
}

export type LiveLocation = {
  lat: number;
  lng: number;
  updatedAt: string;
  accuracy?: number;
  speed?: number | null;
  heading?: number | null;
} | null;

export interface Order {
  id: string;
  customerName: string;
  customerPhone: string;
  orderSummary: string;
  address: string | null;
  // Position partagée par le client, pour aider à localiser l'adresse de livraison.
  locationToken: string | null;
  locationTokenExpiresAt?: string | null;
  locationSharing: boolean;
  liveLocation: LiveLocation;
  // Position partagée par qui livre effectivement (Djimi ou une aide ponctuelle
  // — variable, voir CLAUDE.md) — canal séparé du client, même mécanique.
  courierLocationToken: string | null;
  courierLocationTokenExpiresAt?: string | null;
  courierLocationSharing: boolean;
  courierLiveLocation: LiveLocation;
  /** Date à partir de laquelle l'historique GPS peut être supprimé automatiquement. */
  locationHistoryPurgeDueAt?: string | null;
  locationHistoryPurgedAt?: string | null;
  /** Livreur enregistré assigné à cette livraison (Courier.id) — absent/null si lien ponctuel (voir Courier). */
  assignedCourierId?: string | null;
  /** Créneau convenu en texte libre (ex. « Mardi, 14 h–17 h »). */
  deliverySlot?: string | null;
  /** Horodatages métier : permettent de mesurer préparation, attente et livraison. */
  statusUpdatedAt?: string | null;
  statusHistory?: { status: OrderStatus; at: string }[];
  trackingRequestedAt?: string | null;
  trackingStartedAt?: string | null;
  courierArrivedAt?: string | null;
  /** Dernier incident opérationnel, visible par l'équipe et réversible. */
  deliveryIncidentType?: DeliveryIncidentType | null;
  deliveryIncidentNote?: string | null;
  deliveryIncidentAt?: string | null;
  /** Montant payé au livreur pour cette course, décidé au cas par cas par l'admin — saisi une fois livrée, absent tant que non défini. */
  courierPayout?: number | null;
  /** Code à 4 chiffres montré au client, demandé par le livreur pour clôturer la livraison —
   * optionnel pour les commandes créées avant son introduction (générée à la volée à la lecture, voir orders.ts). */
  deliveryCode?: string;
  /** Tentatives erronées consécutives et verrouillage temporaire du code de livraison. */
  deliveryCodeAttempts?: number;
  deliveryCodeLockedUntil?: string | null;
  status: OrderStatus;
  createdAt: string;
  deliveredAt: string | null;
  reviewToken: string | null;
  reviewSubmitted: boolean;
  uid: string | null;
  items?: OrderItem[];
  total?: number;
  paymentStatus: PaymentStatus;
  paymentReference: string | null;
  campayReference: string | null;
  ussdCode: string | null;
  paidAt: string | null;
  paymentFailureReason: string | null;
  /** Cycle du stock CamPay. Absent sur les commandes antérieures à cette protection. */
  stockState?: OrderStockState;
  inventoryIssue?: boolean;
  paymentInitiationStartedAt?: string | null;
  paymentOperator?: string | null;
}

export interface Customer {
  uid: string;
  name: string;
  phone: string;
  createdAt: string;
}

export interface TestimonialSubmission {
  id: string;
  orderId: string;
  name: string;
  designation: string;
  quote: string;
  photoUrl: string;
  submittedAt: string;
}

export interface DeliveryRow {
  zone: string;
  delay: string;
  cost: string;
  payment: string;
}

export interface SiteSettings {
  businessName: string;
  siteUrl: string;
  shareImage: string;
  topbarInfo: string;
  topbarHelp: string;
  whatsapp: string;
  whatsappDisplay: string;
  email: string;
  address: string;
  addressLocality: string;
  addressCountry: string;
  hours: string;
  responseTime: string;
  openingDays: string[];
  openingTime: string;
  closingTime: string;
  areaServed: string[];
  paymentAccepted: string[];
  catalogDataVerified: boolean;
  commercialTermsVerified: boolean;
  freeShippingThreshold: number;
  deliveryRows: DeliveryRow[];
  instagram: string;
  facebook: string;
  tiktok: string;
  showGallery: boolean;
  showTestimonials: boolean;
  showDemoNotice: boolean;
  /** Couleur du voile des cartes "à la une" du portail, par clé de carte (voir PortalSpotlight) —
   * absente ou vide = voile calculé automatiquement depuis les couleurs de la photo. */
  spotlightGradients?: Record<string, string>;
}
