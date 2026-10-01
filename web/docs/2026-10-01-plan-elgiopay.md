# Plan d'intégration ElgioPay (IKIGAI Sport)

Date : 01/10/2026. Statut : plan seulement, aucun code de paiement écrit.

## Décisions prises

- ElgioPay (elgiopay.com) remplace CamPay pour le paiement Mobile Money.
- CamPay n'a jamais été configuré en production (aucune variable `CAMPAY_*` sur Vercel), il n'y a donc aucun paiement client à migrer.
- Rien n'est codé tant que les points de la section « À vérifier sur le bac à sable » ne sont pas levés avec de vraies clés de test.

## Ce que la documentation publique confirme

Sources : elgiopay.com, elgiopay.com/docs, page Packagist du SDK PHP `elgiosoft/elgiopay-php-sdk`, lues le 01/10/2026.

| Sujet | Ce qui est documenté |
|---|---|
| Créer un paiement | `POST https://api.elgiopay.com/v1/payments` |
| Authentification | `Authorization: Bearer <clé secrète>`, côté serveur uniquement |
| Champs | `amount`, `currency` (XAF), `payment_method` (`mtn_mobile_money` ou `orange_money`), `customer_phone` au format `+237…`, `description`, et en option `reference`, `metadata`, `customer_name`, `customer_email` |
| Réponse | `transaction_id`, `status` ; pour Orange Money, une `payment_url` |
| Notifications | corps signé en HMAC-SHA256 dans l'en-tête `X-ElgioPay-Signature`, événement `payment.completed`, statuts `completed` / `failed`, `failure_reason` |
| Erreurs | JSON `{ error, message, code }` avec codes HTTP standards |
| Mode test | clés `sk_test_…`, aucun débit réel ; production après validation KYC |
| Frais annoncés | 2 % par encaissement, 1 % par retrait |

## À vérifier sur le bac à sable avant de coder

La référence détaillée de l'API ne se charge pas sur leur site (le fichier `openapi.yaml` répond 404). Les points suivants ne sont donc pas documentés, et nos règles anti-double-débit en dépendent.

1. **Relire une transaction.** Quel est le chemin exact (le SDK parle de `getPaymentStatus` et `verifyPayment`) et que renvoie-t-il : statut, montant, devise, `reference` ? Sans cela, la notification ne peut pas être recoupée.
2. **Double envoi.** Existe-t-il une clé d'idempotence, ou `reference` est-elle unique ? Que se passe-t-il si on envoie deux fois la même `reference` ?
3. **Contenu de la notification.** Contient-elle notre `reference` ? Y a-t-il un horodatage ou un identifiant d'événement pour écarter un rejeu ?
4. **Erreurs.** Quels codes signifient un refus certain (rien n'a été débité) et lesquels sont ambigus ?
5. **Orange Money.** La `payment_url` est-elle une page à ouvrir par le client ? Y a-t-il une URL de retour à fournir ?
6. **Format des clés.** Le site parle de `sk_test_…`, le SDK de `pk_test_…`. Lequel est attendu par l'API ?
7. **Statuts intermédiaires.** Liste complète des valeurs de `status` (en attente, expiré, annulé…).

## Ce qui change dans le code

| Fichier | Changement |
|---|---|
| `lib/campay.ts` | remplacé par `lib/elgiopay.ts` (création, relecture, vérification de signature) |
| `app/api/campay/webhook/route.ts` | remplacé par `app/api/elgiopay/webhook/route.ts`, signature calculée sur le corps brut |
| `lib/actions/payments.ts` | appelle ElgioPay ; la logique de réservation de stock et d'idempotence reste la même |
| `lib/paymentHelpers.ts` | inchangé (application atomique du résultat) |
| `lib/types.ts` | `campayReference` devient un champ neutre (`providerReference`), l'ancien reste lisible pour les commandes existantes |
| `components/account/PaymentStatusPoller.tsx` | le code USSD disparaît ; ajout du cas « lien de paiement Orange » |
| `components/cart/CartPanel.tsx` | choix de l'opérateur (MTN ou Orange), proposé d'après le numéro et modifiable |
| `app/confidentialite/page.tsx` | le nom du prestataire de paiement est mis à jour |
| `tests/campay-retry.test.mjs`, `tests/critical-actions.test.mjs` | réécrits pour ElgioPay, mêmes scénarios |
| `next.config.ts` | rien à ajouter tant que la CSP ne liste pas de domaines |

Variables d'environnement : `ELGIOPAY_SECRET_KEY`, `ELGIOPAY_WEBHOOK_SECRET`, et `ELGIOPAY_BASE_URL` si le bac à sable a une adresse distincte. Les variables `CAMPAY_*` sont retirées.

## Règles de paiement conservées (NARA.md §8)

- Une tentative garde un `requestId` stable, transmis à ElgioPay dans `reference`.
- La réservation de stock reste atomique dans Firestore.
- Un refus explicite autorise un nouvel essai. Un délai dépassé, une panne réseau, une réponse incomplète ou une erreur serveur restent « incertains » : pas de relance automatique, stock conservé, message « Ne relancez pas le paiement ».
- La notification n'est jamais appliquée telle quelle : la transaction est relue chez ElgioPay, puis la référence, le montant et la devise sont comparés à la commande.
- Un paiement déjà `paid` ou `review` n'est jamais rétrogradé.
- En production, si la configuration manque, aucun appel ne part (garde-fou déjà en place pour CamPay, à reprendre).

## Étapes, dans l'ordre

1. Le propriétaire crée le compte sur sandbox.elgiopay.com et une application.
2. Il ajoute lui-même les clés de test dans `web/.env.local`.
3. Tests manuels sur le bac à sable pour lever les 7 points ci-dessus, résultats notés dans ce fichier.
4. Écriture de `lib/elgiopay.ts` et de ses tests, sur une branche dédiée.
5. Nouveau point d'entrée de notification, puis adaptation de `payments.ts`.
6. Adaptation de l'écran de paiement (choix de l'opérateur, lien Orange).
7. Lint, tests, typage, build de production, puis essai complet sur la preview Vercel avec les clés de test.
8. Le propriétaire déclare l'adresse de notification dans le tableau de bord ElgioPay, fait valider son KYC et ajoute les clés de production dans Vercel.
9. Retrait du code CamPay une fois un paiement de bout en bout validé.

## Points à trancher par le propriétaire

- **Frais de 2 %** : absorbés par la boutique ou ajoutés au total payé par le client ?
- **Orange Money** : accepte-t-on un parcours où le client quitte le site pour une page de paiement, ou limite-t-on le lancement à MTN ?
- **Paiement par carte** : ElgioPay le propose (via Stripe). Hors périmètre pour l'instant, sauf demande.

## Risques à garder en tête

- Service récent : le SDK PHP a été publié fin août 2026 et ne compte qu'une installation. La disponibilité de 99,9 % est une annonce du fournisseur, non vérifiée.
- La documentation se contredit sur le format des clés et l'espace de noms du SDK.
- Tant que le point 2 (double envoi) n'est pas confirmé, la protection contre un double débit repose uniquement sur notre côté.
