# Le Maillot Idéal

[![CodSpeed](https://img.shields.io/endpoint?url=https://codspeed.io/badge.json)](https://app.codspeed.io/AmadouMendouga/Ikigai-sport?utm_source=badge)

Boutique de maillots de football au Cameroun. Le dépôt contient la boutique
statique historique (HTML/CSS/JS + console d'administration) à la racine et la
nouvelle application Next.js dans `web/`. Le brief complet du projet est dans
[`CLAUDE.md`](CLAUDE.md).

## Commandes utiles

```bash
npm run generate:products   # régénère les fiches produit et le sitemap
npm run build               # site public + console d'administration
npm test                    # tests de logique pure
npm run bench               # benchmarks de performance
```

## Performance

Les benchmarks vivent dans [`bench/`](bench) et s'appuient sur
[tinybench](https://github.com/tinylibs/tinybench) :

| Fichier | Ce qui est mesuré |
| --- | --- |
| `bench/generate-site.bench.mjs` | Génération du site statique (`lib/generate-site.mjs`) : 76 fiches produit, gabarits configurables, sitemap. |
| `bench/admin-lib.bench.mjs` | Logique de la console d'administration (`admin-src/src/lib/`) : validation du brouillon, exports `data.js`/`site-config.js`, CRC32 et ZIP de sauvegarde. |
| `bench/web-lib.bench.mjs` | Logique métier de l'application Next.js (`web/lib/`) : panier et message WhatsApp, validation des commandes côté serveur, nettoyage des traces GPS de livraison. |

Chaque `push` sur `master` et chaque pull request exécute ces benchmarks sur
[CodSpeed](https://app.codspeed.io/AmadouMendouga/Ikigai-sport) en mode
simulation CPU, ce qui rend les mesures reproductibles malgré le bruit des
machines d'intégration continue.
