# NARA — Relance IA du projet IKIGAI Sport

> **ÉTAT : MIS DE CÔTÉ / PAUSE VOLONTAIRE.** La refonte en cours ne doit pas être fusionnée ou poursuivie automatiquement. Ce fichier sert de point de reprise pour un autre agent IA ou développeur. L'agent doit d'abord lire ce document, inspecter l'état réel de la branche/PR, lancer l'application, puis seulement modifier le code si l'utilisateur le lui demande.

## Projet à reprendre

- Repository : `AmadouMendouga/Ikigai-sport`
- Application concernée : **uniquement `web/`** sauf nécessité explicite.
- Branche de travail mise de côté : `design/ikigai-utile-refonte`
- Pull Request : `#16 — Refonte visuelle IKIGAI Sport à partir des références Utile`
- Branche cible : `master`
- Couleur principale : `#22C55E`
- Runtime : **Node.js 22.x**
- Stack web : Next.js 16.3.3, React 19, Firebase/Firestore, Firebase Admin, CamPay, Cloudinary, Leaflet + MapLibre.

## Consigne pour l'agent IA qui reprend

Ne recommence pas l'analyse depuis zéro et ne crée pas une nouvelle refonte parallèle. Commence par la branche `design/ikigai-utile-refonte`, compare-la à `master`, lis la PR #16 et conserve les garanties métier déjà présentes.

Avant toute écriture :

1. lire `nara.md` ;
2. lire `web/AGENTS.md` ;
3. inspecter `web/package.json` ;
4. inspecter la PR #16 et ses checks ;
5. vérifier le diff avec `master` ;
6. lancer l'application localement ;
7. seulement ensuite proposer ou appliquer des changements.

## Comment lancer le projet localement par un autre agent IA

### 1. Récupérer la bonne branche

```bash
git clone https://github.com/AmadouMendouga/Ikigai-sport.git
cd Ikigai-sport
git fetch --all --prune
git checkout design/ikigai-utile-refonte
git pull --ff-only origin design/ikigai-utile-refonte
```

Si le dépôt existe déjà :

```bash
cd Ikigai-sport
git fetch origin
git checkout design/ikigai-utile-refonte
git pull --ff-only origin design/ikigai-utile-refonte
```

Ne travaille pas directement sur `master` pour reprendre cette refonte.

### 2. Entrer dans l'application web

```bash
cd web
```

Toutes les commandes npm ci-dessous doivent être exécutées depuis `web/`.

### 3. Vérifier les prérequis

```bash
node --version
npm --version
java -version
```

Attendu :

- Node.js `22.x` ;
- npm compatible avec Node 22 ;
- Java 21 pour les tests des Firestore Security Rules.

L'agent ne doit pas rétrograder Next.js ou Node pour contourner une erreur.

### 4. Installer exactement les dépendances verrouillées

```bash
npm ci
```

Ne lancer `npm update` ou une mise à jour majeure de dépendances que pour une raison précise et validée.

### 5. Configurer les variables d'environnement

Le fichier de secrets ne doit **jamais** être inventé ni commité. Récupérer les valeurs existantes depuis l'environnement sécurisé du projet/Vercel ou auprès du propriétaire, puis créer localement :

```text
web/.env.local
```

Variables connues utilisées directement dans le code :

```dotenv
# Firebase navigateur
NEXT_PUBLIC_FIREBASE_API_KEY=
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=
NEXT_PUBLIC_FIREBASE_PROJECT_ID=
NEXT_PUBLIC_FIREBASE_APP_ID=
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=

# Firebase Admin serveur
FIREBASE_ADMIN_PROJECT_ID=
FIREBASE_ADMIN_CLIENT_EMAIL=
FIREBASE_ADMIN_PRIVATE_KEY=

# CamPay
CAMPAY_PERMANENT_ACCESS_TOKEN=
CAMPAY_WEBHOOK_KEY=
# Optionnel : sinon https://demo.campay.net est utilisé
CAMPAY_BASE_URL=

# Cloudinary
CLOUDINARY_CLOUD_NAME=
CLOUDINARY_API_KEY=
CLOUDINARY_API_SECRET=
```

Important pour `FIREBASE_ADMIN_PRIVATE_KEY` : le code accepte les `\n` échappés et les reconvertit en retours à la ligne. Ne modifier ce comportement que si la cause d'un problème a été prouvée.

Il peut exister d'autres variables selon les routes/fonctions ajoutées après cette note. Avant un déploiement complet, l'agent doit rechercher les usages de `process.env` dans `web/` et comparer avec les variables réellement configurées sur Vercel. Ne jamais afficher les valeurs secrètes dans les logs, une PR ou une réponse utilisateur.

### 6. Lancer en développement

```bash
npm run dev
```

Puis ouvrir :

```text
http://localhost:3000
```

Si le port 3000 est occupé, Next.js peut proposer un autre port. L'agent doit reprendre l'URL réellement affichée dans le terminal.

### 7. Vérifications minimales après démarrage

Tester au moins :

- accueil ;
- boutique ;
- recherche et filtres ;
- fiche produit ;
- ajout panier ;
- connexion/compte ;
- Mes commandes ;
- pages de livraison/tracking quand des données de test sont disponibles ;
- `/admin` si l'agent dispose d'un compte admin de test.

Contrôler aussi : console navigateur, erreurs réseau, 401/403 attendus, 5xx inattendus, images cassées et overflow horizontal.

## Commandes de validation avant tout push important

Reproduire le plus possible la CI GitHub :

```bash
npm audit --omit=dev --audit-level=critical
npm run lint
npm test
npm run test:rules
npx next typegen
npx tsc --noEmit
```

Pour le build complet :

```bash
npm run build
```

Le build complet dépend des variables Firebase Admin et de l'environnement réel. Une erreur liée aux secrets manquants ne doit pas être "corrigée" en supprimant la sécurité ou en masquant l'exception.

Le script global disponible est :

```bash
npm run check
```

Il lance lint + tests critiques + Security Rules + audit navigateur/build. Il peut nécessiter l'environnement complet.

## Déploiement / Vercel

Le dépôt est relié à Vercel. Au moment de la mise en pause, les déploiements Vercel de cette branche étaient bloqués par un `build-rate-limit` du workspace. Ce statut doit être revérifié au moment de la reprise : ne pas supposer qu'il est toujours présent.

Il existe également un problème antérieur à surveiller : un smoke production a déjà détecté un HTTP 503 lié à Firebase Admin/Vercel. Si ce problème réapparaît :

- comparer les variables Firebase Admin Preview vs Production ;
- vérifier `FIREBASE_ADMIN_PROJECT_ID` ;
- vérifier `FIREBASE_ADMIN_CLIENT_EMAIL` ;
- vérifier `FIREBASE_ADMIN_PRIVATE_KEY` et ses retours à la ligne ;
- ne jamais transformer un vrai 503 serveur en faux succès côté client.

Le webhook CamPay ne peut pas être testé de bout en bout sur `localhost` car CamPay doit joindre une URL publique. Pour cette partie, utiliser une preview déployée et des identifiants/environnements de test appropriés.

## Direction visuelle de la refonte mise en pause

La PR #16 applique les références `Utile(1)` et une inspiration Rare UI utilisée avec parcimonie :

- vert `#22C55E` pour accent/action/état actif, pas partout ;
- surfaces neutres légèrement teintées ;
- éviter noir/blanc purs quand ce n'est pas nécessaire ;
- hiérarchie typographique forte ;
- peu de graisses, uniquement celles réellement disponibles en IBM Plex Sans ;
- cohérence des icônes ;
- bordures discrètes, ombres minimales ;
- pas de glow, blobs ou décor gratuit ;
- produit/prix/statut/CTA prioritaires ;
- labels persistants dans les formulaires ;
- cibles tactiles >= 44 px ;
- mobile-first ;
- dark mode lisible ;
- respect de `prefers-reduced-motion`.

Fichiers de surcouche actuellement utilisés dans `web/app/` :

- `ikigai-refonte-v2.css`
- `ikigai-refonte-v2-components.css`
- `ikigai-rareui-polish.css`
- `ikigai-commerce-polish.css`
- `ikigai-account-delivery-polish.css`

Le layout global importe également Vercel Analytics : ne pas le perdre pendant un rebase/résolution de conflit.

L'administration possède sa propre couche CSS sous `web/app/admin/` afin de ne pas charger les styles admin chez les visiteurs.

## Travail déjà couvert avant la pause

La refonte a déjà touché ou harmonisé :

- header/navigation ;
- boutique, recherche et filtres ;
- cartes produit ;
- fiche produit ;
- panier ;
- premiers éléments compte/commandes ;
- dark mode/contrastes ;
- micro-interactions sobres inspirées de Rare UI ;
- inscription livreur ;
- bases d'harmonisation admin/mobile.

Ne considérer toutefois pas la refonte comme terminée tant qu'une vraie preview n'a pas été validée visuellement.

## Règles métier à ne jamais casser pour "faire marcher" l'UI

Ne pas affaiblir ou contourner sans justification :

- Firebase / Firebase Admin ;
- Firestore et Security Rules ;
- Auth et ownership serveur ;
- CamPay ;
- idempotence et réconciliation paiement ;
- webhook CamPay ;
- Cloudinary ;
- stock et réservation ;
- workflow réel de commande/livraison ;
- QR/code final de remise ;
- API protégées.

CamPay : une panne réseau, un timeout, un 5xx ou une réponse ambiguë peut correspondre à une demande déjà reçue par CamPay. **Ne jamais déclencher automatiquement un deuxième prélèvement** dans ce cas. Garder l'idempotence et laisser la réconciliation/webhook confirmer l'état.

Livraison : une commande ne passe pas directement à `Livrée`. Le suivi GPS s'active au bon moment, puis la remise finale est confirmée par le mécanisme QR/code côté serveur.

## Parcours livraison existant à préserver

Le projet contient déjà :

- `web/components/delivery/DeliveryMap.tsx` ;
- `web/components/delivery/LocationSharingForm.tsx` ;
- `web/components/delivery/CourierRegisterForm.tsx` ;
- navigation MapLibre/Leaflet ;
- itinéraire routier ;
- positions client/livreur ;
- interface livreur ;
- confirmation arrivée ;
- scan QR ou saisie du code ;
- confirmation serveur de livraison.

Ne remplacer ce système qu'après tests réels et preuve qu'une modification améliore le parcours sans régression.

## Procédure de reprise de la refonte, si l'utilisateur la réactive

1. Synchroniser la branche de PR #16.
2. Vérifier qu'elle est toujours mergeable avec `master`.
3. Inspecter les changements arrivés sur `master` pendant la pause.
4. Résoudre les conflits en conservant les nouvelles fonctionnalités de `master` et la refonte.
5. Obtenir une vraie preview Vercel si possible.
6. Tester visuellement desktop + mobile.
7. Corriger d'abord les régressions réelles, pas les préférences abstraites.
8. Finir : commandes/compte → tracking/livreur → admin.
9. Rejouer CI complète.
10. Ne fusionner dans `master` qu'après validation suffisante.
11. Après fusion, vérifier le vrai domaine et exécuter le smoke post-déploiement.

## Prompt prêt à donner à un autre agent IA

Copier/coller ceci à l'agent chargé de reprendre :

> Tu reprends le projet GitHub `AmadouMendouga/Ikigai-sport`. Commence par lire `nara.md` à la racine puis `web/AGENTS.md`. La partie active est `web/`. La refonte actuelle est mise de côté sur la branche `design/ikigai-utile-refonte` et la PR #16 ; ne la fusionne pas automatiquement. Checkout cette branche, installe avec Node 22 via `npm ci` depuis `web/`, récupère les variables d'environnement existantes de manière sécurisée, lance `npm run dev`, puis teste réellement l'application. Avant toute modification, compare avec `master` et vérifie les checks GitHub/Vercel. Préserve strictement Firebase/Firestore/Auth, CamPay et son idempotence, Cloudinary, le stock, les commandes, le tracking et la validation QR/code. Si l'utilisateur te demande de reprendre la refonte, continue dans la même branche et valide lint/tests/rules/types/build avant push/merge. Ne masque jamais une erreur serveur réelle par une correction UI.

## Dernière règle

**Pause signifie pause.** Un autre agent peut lancer, inspecter, tester et diagnostiquer le projet en suivant ce fichier. Il ne doit reprendre les modifications de la refonte, fusionner la PR #16 ou déployer en production que lorsque l'utilisateur le demande explicitement ou que la mission confiée l'exige clairement.
