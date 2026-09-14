# IKIGAI Sport — Refonte V2

Cette refonte utilise le lot de références `Utile(1)` comme direction UX/UI, sans copier une marque ou une interface précise.

## Principes

- Vert IKIGAI `#22C55E` réservé aux actions, états actifs et confirmations.
- Fonds et surfaces neutres pour laisser les produits dominer.
- Hiérarchie typographique plus nette et titres plus compacts.
- Cartes produit moins décorées, bordures fines, ombres rares.
- CTA simples et cohérents.
- Navigation mobile stable et lisible.
- Formulaires avec labels visibles et cibles tactiles confortables.
- Panier présenté comme une feuille flottante claire.
- Statut et progression prioritaires dans les commandes.
- Responsive pensé mobile d'abord sans casser le desktop.

## Stratégie technique

La première phase est une couche CSS additive chargée après les styles historiques. Elle ne modifie pas Firebase, Firestore, Auth, CamPay, Cloudinary, les API, les commandes, les stocks ou la logique de livraison. Cela permet de valider la direction visuelle sur preview avant d'entreprendre les changements structurels de composants.

## Phase suivante après validation visuelle

1. Recomposer le header et la navigation mobile.
2. Recomposer la boutique et les cartes produit.
3. Recomposer la fiche produit et le panier.
4. Recomposer checkout/paiement sans toucher à la logique CamPay.
5. Recomposer Mes commandes, suivi, Mon compte et favoris.
6. Harmoniser livreur et admin.
7. Exécuter smoke Playwright mobile/desktop, tests métier, tests Firestore et audit critique avant fusion.
