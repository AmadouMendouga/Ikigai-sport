# NARA — Relance IA du projet IKIGAI Sport

> Ce fichier est le point de reprise pour toute IA ou développeur qui reprend le travail. Ne pas recommencer l'analyse depuis zéro : lire ce document, inspecter la PR et continuer à partir de l'état réel du dépôt.

## Projet

- Repository : `AmadouMendouga/Le-Maillot-Ideal`
- Application concernée : `web/`
- Branche de refonte : `design/ikigai-utile-refonte`
- Pull Request : `#16 — Refonte visuelle IKIGAI Sport à partir des références Utile`
- Branche cible : `master`
- Couleur principale IKIGAI : `#22C55E`
- Référence UX/UI principale : lot `Utile(1)` fourni par le client (145 références visuelles analysées).

## Mission

Continuer la refonte UX/UI complète d'IKIGAI Sport en s'inspirant des principes du lot `Utile(1)`, sans copier servilement les interfaces. Le résultat doit être cohérent, premium, sportif, simple, moderne, très lisible et réellement utilisable sur mobile comme desktop.

La refonte doit couvrir : accueil/boutique, navigation/header, catégories/recherche/filtres, cartes produits, fiche produit, panier, checkout/paiement, connexion/inscription, Mes commandes, détail et suivi de commande, Mon compte, favoris, navigation mobile, interface livreur et administration.

## Direction visuelle validée

- Vert `#22C55E` = accent/action/état actif, pas une couleur à mettre partout.
- Surfaces principalement blanches/neutres et contraste sombre propre.
- Hiérarchie typographique forte.
- Plus d'espace et moins de bruit visuel.
- Ombres discrètes, pas de glow ni d'effets artificiels.
- CTA très identifiables.
- Cartes produit simples : image prioritaire, titre court, prix dominant.
- Formulaires avec labels persistants et erreurs compréhensibles.
- Cibles tactiles >= 44 px.
- Bottom navigation mobile claire, 4/5 destinations visuellement prioritaires.
- Responsive à vérifier au minimum à 320, 360, 390, 430, 768, 1024 et 1440 px.
- Respecter `prefers-reduced-motion`.

## Travail déjà réalisé dans la PR #16

Une première couche additive `web/app/ikigai-refonte-v2.css` a été créée et importée après les styles existants. Elle commence à harmoniser :

- header/recherche ;
- hero ;
- boutons ;
- catégories/chips ;
- catalogue et filtres ;
- cartes produit ;
- fiche produit ;
- formulaires/auth ;
- commandes ;
- panier ;
- bottom navigation ;
- responsive mobile/tablette/desktop.

Documentation ajoutée :
- `docs/IKIGAI-REFONTE-V2.md`
- `docs/IKIGAI-REFONTE-CHECKLIST.md`

Le fichier `web/app/layout.tsx` importe la nouvelle couche V2.

## Règle critique : ne pas casser la logique métier

La refonte UI ne doit pas modifier ou contourner sans nécessité :

- Firebase / Firebase Admin ;
- Firestore et ses Security Rules ;
- Auth ;
- CamPay ;
- logique d'idempotence et de réconciliation paiement ;
- Cloudinary ;
- stock/réservation de stock ;
- ownership serveur des commandes ;
- workflow de livraison ;
- validation finale QR/code ;
- API protégées.

Le paiement CamPay a déjà été sécurisé : une réponse réseau ambiguë ne doit jamais provoquer automatiquement un second prélèvement. Le webhook/réconciliation doit conserver son rôle.

## Parcours commande/livraison à préserver

- Une commande ne doit jamais devenir `Livrée` immédiatement après départ.
- Le client doit voir la progression réelle de sa commande.
- Le tracking devient accessible au bon moment du parcours.
- L'itinéraire/livreur doit être exploitable sur la carte.
- La livraison finale nécessite la confirmation prévue côté serveur (QR/code).
- `Mes commandes` doit distinguer au minimum les commandes en cours, planifiées et l'historique.

## Baseline technique déjà obtenue avant cette refonte

Les PR précédentes ont notamment apporté :

- optimisation du changement d'état admin ;
- nouveau parcours `Mes commandes` ;
- `Mon compte` ;
- contrôles serveur d'ownership ;
- accessibilité renforcée ;
- sécurité des retries CamPay ;
- MapLibre v6 ;
- Firebase Admin 14 / Node 22 ;
- tests Firestore Security Rules en CI ;
- smoke Playwright post-déploiement ;
- corrections d'overflow storefront/cart mobile.

Ne pas supprimer ces acquis pendant la refonte.

## Blocage actuel — IMPORTANT

Au 13 septembre 2026, la PR #16 est ouverte et mergeable, mais les deux checks Vercel échouent avec `build-rate-limit` :

- `Vercel – le-maillot-ideal-preview` : failure
- `Vercel – le-maillot-ideal` : failure

La cible Vercel indique une limite de fréquence/quota de builds du workspace. Ce blocage n'est pas une preuve d'erreur du code de refonte.

Il existe aussi un problème serveur antérieur à surveiller : le smoke production avait détecté un HTTP 503 lié à Firebase Admin/Vercel. Ne jamais masquer ce 503 par CSS ou en affaiblissant les tests. Vérifier la configuration Firebase Admin côté Vercel (project id, client email, private key et format des retours à la ligne, environnement Production/Preview).

## Procédure de reprise par une autre IA

1. Checkout/synchroniser `design/ikigai-utile-refonte`.
2. Lire la PR #16 et le diff avant toute modification.
3. Vérifier les checks GitHub/Vercel.
4. Si `build-rate-limit` est levé, récupérer immédiatement l'URL du preview de la PR #16.
5. Tester réellement le preview avec navigateur/Playwright sur desktop + mobile.
6. Contrôler console JS, erreurs réseau, 5xx, images cassées et overflow horizontal.
7. Vérifier visuellement : accueil → boutique → filtres → produit → panier → auth → checkout → commandes → compte.
8. Corriger les régressions dans la même branche de refonte.
9. Continuer ensuite les composants structurels, écran par écran, au lieu d'empiler uniquement du CSS global.
10. Tester les parcours métier après chaque changement structurel.
11. Lancer TypeScript, ESLint, tests Node/business/CamPay, tests Firestore Rules et smoke Playwright disponibles dans le projet.
12. Ne fusionner dans `master` qu'après preview visuellement validé et CI acceptable.
13. Après fusion, vérifier le déploiement production et refaire le smoke sur le vrai domaine.

## Ordre recommandé de la suite de la refonte

1. Header + navigation desktop/mobile.
2. Accueil et boutique/catalogue.
3. Cartes produit + fiche produit.
4. Panier.
5. Authentification et profil incomplet.
6. Checkout + états CamPay, sans toucher aux garanties de paiement.
7. Mes commandes + détail + timeline + tracking.
8. Mon compte + favoris + aide.
9. Interface livreur + carte + arrivée + QR/code.
10. Administration, en gardant les actions rapides déjà optimisées.
11. Audit responsive/accessibilité complet.
12. Smoke E2E et validation production.

## Critères de validation visuelle

Avant fusion, vérifier au minimum :

- aucun overflow horizontal ;
- aucun panneau/cart hors viewport ;
- aucun texte important tronqué ;
- images produit non déformées ;
- prix/CTA/statuts immédiatement lisibles ;
- focus clavier visible ;
- boutons tactiles confortables ;
- contrastes corrects clair/sombre ;
- navigation mobile non superposée au contenu ;
- panier utilisable à 320/360/390 px ;
- commandes et timeline compréhensibles sans explication ;
- aucune régression paiement/livraison/auth/API.

## Consigne de communication

Ne pas signaler du bruit de routine. Pour chaque problème actionnable, produire :

1. ce qui a changé / ce qui casse ;
2. pourquoi c'est important ;
3. risque ou blocage ;
4. prochaine action concrète.

Si rien d'actionnable n'a changé : `Aucun changement actionnable depuis le dernier contrôle.`

## Instruction finale pour l'IA qui reprend

Tu as l'autorisation de continuer le travail technique sur la branche de refonte : analyser, modifier, tester et pousser les corrections nécessaires. Ne fusionne pas à l'aveugle. La priorité immédiate est de débloquer/attendre le preview Vercel, de le tester visuellement, puis de poursuivre la refonte écran par écran tout en préservant les garanties métier et de sécurité existantes.
