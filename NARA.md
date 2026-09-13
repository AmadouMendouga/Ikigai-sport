# NARA.md — Règles opérationnelles IKIGAI Sport

> Guide court à respecter pour toute intervention sur le projet. Lire aussi `CLAUDE.md` et `DEPLOIEMENT.md` si un point demande plus de détail.

---

## 1. Règles fondamentales

1. **Application 100 % en français** : interface, boutons, messages, erreurs, formulaires, statuts et textes visibles par l'utilisateur doivent être en français.
2. **Réutiliser l'existant** : tout nouvel écran ou composant doit reprendre la charte graphique, les composants, les styles et les couleurs déjà utilisés. Ne pas créer une nouvelle palette ou un nouveau langage visuel sans validation.
3. **Expliquer simplement chaque modification** : dire ce qui a changé, pourquoi, le risque corrigé et ce qu'il reste à vérifier, avec des mots accessibles.
4. **Demander confirmation avant toute nouvelle fonctionnalité complexe** : nouvelle dépendance importante, nouveau service externe, nouvelle architecture, nouveau système de paiement/authentification, modification majeure du schéma de données ou nouveau parcours métier.
5. Pour un **correctif, une sécurisation, un bug ou un ajustement UI/UX dans le périmètre existant**, travailler sur une branche dédiée et avancer sans reconstruire inutilement l'existant.

---

## 2. Objectif du projet

IKIGAI Sport est une plateforme e-commerce multisport destinée en priorité au marché camerounais.

- `/` : portail multisport.
- `/[sport]` : site complet d'un sport.
- Vente via **WhatsApp** et **Mobile Money CamPay**.
- Compte client pour commandes, suivi et profil.
- Console admin intégrée.
- Parcours livreur et suivi GPS en temps réel.

Ne pas transformer le projet en plusieurs applications indépendantes sans raison validée.

---

## 3. Stack technique

Code actif principal : `web/`.

- **Next.js 16 App Router** + React + TypeScript.
- **Firebase Auth** pour les identités.
- **Firestore** pour catalogue, clients, commandes, livreurs, avis et données métier.
- **Firebase Admin SDK** uniquement côté serveur.
- **CamPay** pour MTN/Orange Mobile Money.
- **Cloudinary** pour les médias.
- **Leaflet + OpenFreeMap + OSRM** pour le suivi et l'itinéraire de livraison.
- **Vercel** pour les previews et le déploiement.

Aucun secret dans le code : utiliser uniquement les variables d'environnement.

---

## 4. Charte UI / UX

### Identité

- Couleur principale : **vert IKIGAI `#22C55E`**.
- Interfaces propres, calmes, lisibles et professionnelles.
- Éviter glow, effets excessifs, surcharge visuelle et composants décoratifs inutiles.
- Priorité au contenu, au prix, au statut et à l'action suivante.

### Styles existants à réutiliser

- `web/app/lmi.css` : base globale et tokens.
- `web/app/ikigai-ui.css` : interface publique IKIGAI.
- `web/app/ikigai-ux-polish.css` : améliorations UX récentes.
- `web/app/admin/admin.css` : interface admin.

### Règles d'ergonomie

- Mobile-first.
- Cibles tactiles importantes : **44 px minimum**.
- Champs principaux : environ **48–50 px minimum**.
- Focus clavier toujours visible.
- Pas de contenu masqué derrière la navigation basse.
- Prévoir clair + sombre quand le composant est concerné.
- Respecter `prefers-reduced-motion`.
- Tester les petits écrans avant de considérer un écran terminé.

Ne jamais copier aveuglément une référence UI : reprendre les bons principes tout en conservant l'identité IKIGAI.

---

## 5. Structure de `web/`

```text
app/
├── page.tsx                     portail multisport
├── [sport]/                     accueil, boutique, produits, favoris, compte
├── admin/                       console d'administration
├── livraison/[token]/           suivi de livraison partagé
├── livreur/[token]/             interface livreur
├── avis/[token]/                avis après livraison
└── api/                         routes serveur, webhook, cron...

components/
├── account/                     compte, commandes, paiement
├── admin/                       composants admin
├── cart/                        panier et checkout
├── delivery/                    carte, GPS, livraison
├── nav/                         navigation
├── products/                    catalogue et produit
└── icons/                       icônes partagées

lib/
├── actions/                     mutations serveur
├── auth/                        sessions et autorisations
├── data/                        lectures Firestore
├── firebase/                    Firebase client/admin
├── campay.ts                    intégration CamPay
├── cloudinary.ts                intégration médias
├── paymentHelpers.ts            application atomique des paiements
├── orderWorkflow.ts             règles de workflow commande
└── types.ts                     types partagés

tests/                           tests métier et sécurité
scripts/                         scripts ponctuels
```

---

## 6. Conventions de code

- Composants React : `PascalCase.tsx`.
- Fonctions, actions, utilitaires : `camelCase`.
- Fichiers métier TypeScript : noms explicites, courts et cohérents avec le domaine.
- Commentaires en français, surtout pour expliquer le **pourquoi** d'une contrainte ou d'un correctif non évident.
- Préfixes CSS déjà utilisés : `ik-`, `dlv-`, `cp-`, `adm-`, `pd-`.
- Éviter les duplications : réutiliser les composants existants avant d'en créer un nouveau.
- Les règles de sécurité doivent être appliquées côté serveur, jamais seulement dans l'interface.

---

## 7. Authentification et sécurité

- La vérification faisant autorité doit vivre près de la donnée, dans les Server Actions / DAL / routes serveur.
- Le `proxy.ts` ne fait qu'un contrôle optimiste de présence de cookie ; ne jamais le considérer comme contrôle de sécurité principal.
- Un client ne doit accéder qu'à ses propres données.
- Un admin doit être vérifié côté serveur avant toute lecture ou mutation privée.
- Les liens livraison/livreur/avis utilisent des jetons dédiés quand une session complète n'est pas nécessaire.
- Ne jamais exposer au client les jetons réservés au livreur ou à l'administration.

---

## 8. Paiement CamPay — règles critiques

Le paiement doit être **idempotent** et ne jamais provoquer volontairement un double débit.

### À respecter

- Une tentative possède un `requestId` stable.
- La réservation de stock est atomique dans Firestore.
- Ne pas générer une nouvelle clé de paiement après une erreur tant que le serveur n'indique pas explicitement que le réessai est sûr.
- Un refus fournisseur explicite peut autoriser un nouveau paiement.
- Un timeout, une erreur réseau, une réponse incomplète, une erreur CamPay `5xx`, `408`, `409` ou `425` est considérée comme **incertaine**.
- En état incertain :
  - ne pas relancer automatiquement CamPay ;
  - ne pas libérer immédiatement le stock ;
  - conserver la même commande ;
  - afficher clairement **« Ne relancez pas le paiement »** au client ;
  - laisser le webhook / la vérification fournisseur réconcilier l'état.
- Le webhook n'applique jamais directement le statut contenu dans le corps reçu : relire la transaction auprès de CamPay puis vérifier référence, montant et devise.
- Un paiement déjà `paid` ou `review` ne doit jamais être rétrogradé par une notification tardive.

Fichiers principaux :

- `web/lib/campay.ts`
- `web/lib/actions/payments.ts`
- `web/lib/paymentHelpers.ts`
- `web/app/api/campay/webhook/route.ts`
- `web/components/account/PaymentStatusPoller.tsx`

---

## 9. Commandes et livraison

- Une commande ne devient pas « livrée » avant confirmation réelle.
- Le lien de suivi client n'est disponible qu'au départ effectif du livreur.
- Le code de remise n'est accepté qu'après l'arrivée.
- Plusieurs codes erronés doivent déclencher un verrouillage temporaire.
- Réaffecter un livreur doit révoquer l'ancien jeton.
- À la livraison, clôturer correctement le partage GPS.
- Le client et le livreur ne doivent jamais recevoir les mêmes capacités privées.
- L'itinéraire doit être réel quand OSRM est disponible ; ne jamais dessiner un faux itinéraire en cas de réponse invalide.

---

## 10. Cloudinary

- Les uploads administratifs utilisent une signature serveur.
- Une signature ne peut être obtenue qu'après vérification admin.
- Ne jamais exposer `api_secret` ou autres secrets Cloudinary au navigateur.
- Réutiliser les composants et helpers d'upload existants avant d'ajouter une nouvelle méthode de stockage.

---

## 11. Tests et qualité

Avant de considérer un changement prêt :

```bash
cd web
npm run lint
npm test
npx tsc --noEmit
```

Tests existants importants :

- `tests/lib.test.mjs`
- `tests/critical-actions.test.mjs`
- `tests/campay-retry.test.mjs`
- `tests/firestore-rules.test.mjs`
- `tests/browser-audit.mjs`

La CI GitHub est définie dans :

- `.github/workflows/ikigai-web-ci.yml`

La CI GitHub valide lint + tests + TypeScript. Le vrai build Next.js avec les variables Firebase de l'environnement est vérifié par **Vercel**.

Ne jamais annoncer qu'un bug est corrigé uniquement parce que le code compile : tester aussi le comportement concerné.

---

## 12. Workflow Git / déploiement

1. Vérifier l'état réel du code avant toute modification.
2. Travailler sur une **branche dédiée**, jamais directement sur `master` pour un lot important.
3. Faire des commits courts et explicites.
4. Lancer lint, tests et typecheck.
5. Ouvrir une PR vers `master`.
6. Vérifier les checks GitHub et Vercel.
7. Tester la preview sur mobile et desktop pour les changements UI ou parcours utilisateur.
8. Ne fusionner que si le lot est cohérent et les contrôles nécessaires sont verts.
9. Après fusion, vérifier le déploiement et les parcours critiques.

Branche de travail actuelle : `fix/ikigai-audit-ux`.
PR actuelle : **#10 — Fix IKIGAI payment retries and improve mobile UX**.

---

## 13. État actuel / travail déjà réalisé

Déjà présent ou corrigé :

- portail multisport et boutiques par sport ;
- panier et commande WhatsApp ;
- paiement CamPay avec webhook et réconciliation ;
- protection renforcée contre les doubles tentatives de paiement ;
- compte client, commandes et profil ;
- admin ;
- favoris ;
- suivi GPS client/livreur ;
- itinéraire OSRM avec repli propre si indisponible ;
- code de livraison + QR ;
- avis après livraison ;
- médias Cloudinary ;
- UI mobile améliorée avec navigation basse ;
- contrôles tactiles et formulaires améliorés ;
- CI dédiée à `web/` ;
- tests critiques paiement, stock, auth, commandes et livraison.

Ne pas reconstruire ces fonctionnalités sans identifier d'abord un problème réel.

---

## 14. Communication avec le propriétaire du projet

Après une intervention, expliquer simplement :

- **ce qui a été changé** ;
- **pourquoi c'était nécessaire** ;
- **le risque corrigé ou l'amélioration obtenue** ;
- **ce qui a été testé** ;
- **ce qui reste éventuellement à vérifier**.

Si une décision métier ou une fonctionnalité complexe n'est pas clairement définie, demander confirmation **avant** de l'implémenter.
