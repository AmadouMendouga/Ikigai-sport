# Audit des références UI/UX — IKIGAI Sport

Date : 13 septembre 2026. Base examinée : `d69d433`, incluant la PR #8.

Les cinq lots joints à cette conversation représentent **37 fichiers, dont 31 visuels distincts et 6 doublons identiques**. Les préfixes de fichiers ci-dessous permettent de retrouver chaque original. Les couvertures et les propositions de style sont distinguées des conseils d'ergonomie.

La PR #8 améliore les trois formulaires d'authentification, les messages d'erreur, le contraste de leurs liens et les onglets de commandes. Le complément agrandit le bouton d'affichage du mot de passe à 44 × 44 px et stabilise la relation entre les onglets et leur panneau ; il ajoute les touches Début/Fin et rend le panneau accessible par Tab.

## Couverture des visuels

« Présent » désigne un comportement retrouvé dans le code ; ce statut ne constitue pas une validation visuelle ou une certification d'accessibilité de toute l'application.

| Fichier `.webp` (préfixe unique) | Sujet | Décision pour IKIGAI |
|---|---|---|
| `4B400BAB` | Couverture de palettes néon | Inspiration de couleur uniquement. L'accent IKIGAI reste `#22C55E`, avec des couleurs de texte adaptées au fond. |
| `D76CE22E` | Aligner les nombres à droite | Présent dans les valeurs du détail de commande (`.ik-order-facts dd`). L'ensemble des colonnes chiffrées de l'admin reste à examiner. |
| `55220B63` | Cohérence des icônes | Sprite Tabler partagé dans `web/components/icons/`. Les marques de connexion restent reconnaissables. La cohérence optique de tous les pictogrammes reste à vérifier visuellement. |
| `74B451F1` | Définir les états | États de chargement, désactivation, erreur, succès et focus présents dans les composants examinés. Pas de validation exhaustive de chaque contrôle. |
| `16E82014` | Regrouper pour réduire les bordures | Espacement des champs et groupes du profil présents. Les limites des champs et des groupes sont conservées lorsqu'elles aident à les identifier. |
| `B41AED79` | Feedback et animations | Chargement des formulaires et actualisation des commandes annoncés ; désactivation pendant les requêtes. Les feuilles de style contiennent des règles de réduction des animations. |
| `539E34A6` | Rayons de coins imbriqués | Principe retenu pour les contours réellement concentriques. Les rayons des cartes et images n'ont pas fait l'objet d'une correction globale dans cette livraison. |
| `635DFBB8` | Couverture « Essential UI/UX » | Couverture éditoriale, sans composant à intégrer. |
| `550BF9CA` | Informations utiles | Consignes persistantes sur les formulaires ; statuts, montants et créneaux dans les commandes ; renseignements regroupés dans le profil. |
| `6AF5948E` | Lisibilité des graisses | Le corps public est en graisse 400 ; labels et actions utilisent des graisses plus fortes. Le titre de connexion reprend la couleur de texte principale. |
| `6EEC45E1` | Zones tactiles | Champs d'authentification de 52 px minimum ; bouton de visibilité du mot de passe porté à 44 × 44 px. Pas de garantie globale de 44 × 44 px : les boutons de quantité du panier font notamment 32 × 44 px. |
| `447F40FC` | Sélection visible | Navigation active via `aria-current`, préférences via `aria-pressed`, commandes via `aria-selected`, accompagnées de styles distincts. |
| `83E80D81` | Actions explicites | Libellés français concrets : « Enregistrer mes informations », « Voir le détail et l'avancement », « Se déconnecter ». |
| `86A28E9A` | Astuce du ratio de rayons 1:2 | Ce ratio n'est pas une règle générale. Un écart uniforme entre contours doit guider le rayon intérieur ; revue géométrique complète encore à effectuer. |
| `588A3CEC` | Couverture « Improve your UI Designs » | Couverture éditoriale, sans changement fonctionnel. |
| `C9C6C9D8` | Action principale accessible | Boutons principaux sous les champs ; barre de panier et navigation mobile existantes. Leur confort sur appareil reste à confirmer visuellement. |
| `39DE64BA` | Montrer l'avancement | Groupes de commandes et frise d'avancement présents. Un formulaire court de connexion ne reçoit pas de fausse progression en plusieurs étapes. |
| `77B4D21D` | Erreurs utiles | Messages visibles et annoncés, associés aux champs sur les connexions client/admin. La granularité des erreurs de tous les autres formulaires reste à examiner. |
| `7E40380D` | Découper le contenu | Sections du profil, cartes de commandes et groupes de champs existants. |
| `2AC98FEA` | Icônes et labels | Les cinq destinations de la navigation mobile ont un texte visible. Les boutons uniquement graphiques des composants examinés ont un nom accessible. |
| `17AB05A9` | Alignement des formulaires | Labels permanents au-dessus des champs ; icônes placées dans un conteneur séparé du label ; largeur des champs et actions cohérente. |
| `49637784` | Langage naturel | Instructions, erreurs et actions rédigées en français. Les confirmations de sauvegarde attendent la réponse de l'action serveur. |
| `F3874AA2` | Réglages | Groupes « Mon compte », « Mes préférences » et aide dans `ProfileSettings.tsx` ; informations personnelles, sécurité et déconnexion accessibles. |
| `22C39DAC` | Authentification simple | Connexion e-mail/mot de passe et Google existantes ; action principale distincte, récupération du mot de passe et états visibles. |
| `970F8CBE` | Navigation marketplace | Principe repris par `BottomNav.tsx` : destinations explicites et état actif. Le rendu exact de la barre de la référence n'est pas une exigence fonctionnelle. |
| `8B6EDAAB` | Couverture des formulaires de connexion | Synthèse visuelle des références détaillées suivantes. |
| `22651B64` | Anatomie d'une connexion | Champs, labels, récupération, action principale, alternative Google et lien d'inscription présents. Une case « se souvenir de moi » n'est pas ajoutée sans définir son comportement réel. |
| `7BCFB5B9` | Boutons principaux | Actions d'authentification de 52 px minimum ; couleur d'accent et texte sombre contrasté sur les boutons publics. |
| `F2570E90` | Labels et placeholders | Corrigé dans les trois formulaires : le label reste visible, le placeholder donne un exemple. |
| `EC081908` | Hauteur et espacement des champs | Champs de 52 px minimum et marge entre groupes de 16 px dans les styles d'authentification. Vérification de débordement à toutes les largeurs encore nécessaire. |
| `57D4CDA2` | Connexion sociale | Google est déjà fonctionnel et explicitement nommé. Apple n'est pas ajouté : le brief du projet indique qu'il nécessite un compte développeur indisponible. |

### Doublons exacts

| Copie | Original identique |
|---|---|
| `08EBF8EE` | `16E82014` |
| `6D828BE9` | `B41AED79` |
| `260E751E` | `539E34A6` |
| `237BD64C` | `635DFBB8` |
| `2F877FF4` | `550BF9CA` |
| `DFEC9F6C` | `6AF5948E` |

## Nuances des conseils

- **Coins imbriqués :** pour des contours circulaires concentriques séparés d'une distance uniforme `d`, utiliser `max(0, rayon extérieur − d)`. Mesurer tout le retrait entre contours, bordure comprise le cas échéant. Le ratio 1:2 n'est qu'un cas particulier. La spécification [CSS Backgrounds and Borders](https://www.w3.org/TR/css-backgrounds-3/#corner-shaping) décrit le calcul des rayons intérieurs d'une même boîte ; son application à deux éléments distincts dépend de leur géométrie.
- **Zones tactiles :** 44 px est l'objectif de confort retenu pour les boutons concernés. Le critère [WCAG 2.2, 2.5.8](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) définit un minimum de 24 × 24 px CSS avec des exceptions. Une hauteur seule ne permet pas d'affirmer que toutes les zones de clic respectent un carré de 44 × 44 px.
- **Onglets :** le complément suit le comportement décrit dans le [patron Tabs de WAI-ARIA](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/) : sélection, flèches, Début/Fin et panneau nommé. La cible `aria-controls` existe quel que soit l'onglet actif.
- **Informations et animation :** afficher les renseignements utiles au choix et le véritable état de l'action ; les exemples ne justifient ni une surcharge de texte ni des délais artificiels.

## Limites de validation

La revue des références et du code est complète pour les sujets consignés ci-dessus. Elle ne constitue pas une revue exhaustive de tous les écrans et de toutes leurs variantes.

Le navigateur a refusé l'accès au site en raison d'une préférence d'accès enregistrée. Il n'a pas été utilisé par une autre voie pour contourner ce blocage. Les contrôles visuels mobile/bureau et clair/sombre, les mesures de contraste sur le rendu effectif et l'essai avec un lecteur d'écran restent non réalisés dans cette passe. Les résultats des contrôles automatiques et des déploiements sont consignés dans la PR associée.
