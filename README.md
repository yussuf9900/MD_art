# MD’art — Galerie et administration

Galerie Vite/JavaScript de Mandiaye Diaw, basée en Italie. Interface française, euro principal et FCFA facultatif. Administration `/admin`, API Vercel Functions, données JSON dans Vercel Blob privé et images dans Blob public. Paiements et échanges effectués hors de l’application.

## Démarrer en local

Node.js 24 et npm sont requis.

```sh
npm install
npm run setup:local
npm run dev:local
```

Ouvrir l’URL affichée par Vite, puis `/admin`. Le script crée `.env.local` sans écraser un fichier existant, génère un mot de passe initial et l’affiche une fois. Identifiant initial : `admin`. Le premier accès impose un nouveau mot de passe de 12 à 128 caractères. Le mot de passe actuel est ensuite stocké sous forme de hash scrypt, sans modifier `.env.local`.

Le mode local conserve les JSON dans `.local-data/local/` et les images dans `.local-data/images/`. Ces fichiers sont ignorés par Git. Ils ne sont pas automatiquement transférés vers Vercel. Le serveur Vite fournit les API en développement ; `npm run preview` sert uniquement le résultat statique et ne fournit pas les API.

```sh
npm test
npm run build
```

Les tests HTTP couvrent authentification, droits, catalogue, images, demandes, ventes, conflits, restauration et isolation des environnements. Dans un environnement qui interdit l’écoute sur localhost, les tests nécessitent une autorisation de réseau local.

## Configuration Vercel — un seul projet

1. Importer ce dépôt comme projet Vite. `vercel.json` définit le build, l’admin et les réécritures API vers une fonction Node unique.
2. Dans Storage, créer **deux stores Vercel Blob** : un **privé** pour les JSON et un **public** pour les images. Les relier au même projet. Copier les valeurs fournies par Vercel dans les variables serveur ci-dessous, en distinguant bien les deux stores.
3. Configurer les variables sur les environnements voulus. Ne pas définir `MDART_LOCAL_DATA` sur Vercel. Ne jamais préfixer les secrets par `VITE_` ni les ajouter au dépôt.
4. Déployer, ouvrir `/admin`, changer le mot de passe initial, puis renseigner les vraies coordonnées italiennes, l’email, WhatsApp et les modalités de livraison.
5. Activer Web Analytics sur ce projet. Configurer son accès API si les statistiques doivent apparaître dans l’admin.

| Variable serveur | Valeur / rôle |
| --- | --- |
| `BLOB_PRIVATE_READ_WRITE_TOKEN` | Token du store **privé** |
| `BLOB_PUBLIC_READ_WRITE_TOKEN` | Token du store **public** |
| `ADMIN_USERNAME` | `admin` par défaut, configurable avant l’initialisation |
| `ADMIN_INITIAL_PASSWORD` | Mot de passe initial, 12–128 caractères |
| `SESSION_SECRET` | Secret aléatoire d’au moins 32 caractères |
| `APP_ORIGIN` | Facultatif ; origine HTTPS exacte, sans slash final. Omettre pour accepter l’origine du déploiement courant |
| `VERCEL_ANALYTICS_TOKEN` | Token Vercel autorisé à lire les statistiques du projet, uniquement côté serveur |
| `VERCEL_ANALYTICS_PROJECT_ID` | Identifiant du projet Analytics |
| `VERCEL_ANALYTICS_TEAM_ID` | Identifiant d’équipe, si le projet appartient à une équipe |
| `ANALYTICS_CUSTOM_EVENTS` | `0` par défaut ; `1` seulement avec une offre compatible |

Générer `SESSION_SECRET` avec :

```sh
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Les valeurs de `.env.example` sont des emplacements vides, pas des identifiants de production. Aucun abonnement ou changement d’offre n’est activé par le code.

### Production et prévisualisations

Les données utilisent les préfixes `mdart/production/`, `mdart/preview-<hash-de-branche>/` et `mdart/development/`. Les images utilisent les mêmes préfixes. Les stores peuvent être partagés, les données restent séparées par environnement. Une prévisualisation sans branche utilise l’URL de déploiement comme identifiant. Ne pas donner un `APP_ORIGIN` de production aux prévisualisations.

Au premier accès au catalogue, les trois œuvres initiales et leurs images statiques sont importées dans un JSON créé sans écrasement. Les déploiements suivants conservent les modifications. Les prix EUR sont repris ; les prix XOF sont initialement vides.

L’admin initial est créé au premier login. Modifier `ADMIN_INITIAL_PASSWORD` après ce premier login ne réinitialise pas un compte existant. En cas de perte d’accès, l’opérateur peut supprimer **uniquement** `mdart/<environnement>/auth.json` dans le store privé, après avoir défini un nouveau mot de passe initial et renouvelé `SESSION_SECRET`. Cela révoque les accès précédents sans supprimer la galerie. Une suppression de fichier d’authentification est une opération manuelle à effectuer avec prudence.

## Comportements de gestion

- Tableau : brouillon, publié ou archivé ; disponible, réservé ou vendu. Seuls les tableaux publiés sont exposés par l’API publique. Une suppression conserve les instantanés des ventes et les titres des demandes.
- Images : JPEG/PNG/WebP, 10 Mo, contenu vérifié côté serveur. Les uploads de production passent directement du navigateur vers Blob avec un jeton limité délivré après authentification. Les images sont publiques dès leur upload, même si leur œuvre est un brouillon ; ne pas téléverser de documents confidentiels dans cette médiathèque.
- La première image choisie est l’image principale. Les images complémentaires sont proposées dans la vue de détail. L’ordre du catalogue est un entier modifiable.
- Une image utilisée et une collection contenant des œuvres ne peuvent pas être supprimées. Un upload abandonné avant son enregistrement peut laisser un fichier orphelin dans Blob ; son nettoyage se fait dans Storage.
- Les demandes sont dédupliquées par identifiant de soumission, validées côté serveur et limitées à cinq soumissions par heure et adresse réseau. Elles ne changent pas automatiquement la disponibilité.
- Une demande acceptée peut devenir une vente unique. Paiement et livraison sont suivis manuellement ; le statut du tableau reste un choix explicite de l’artiste.
- Les conflits de révision retournent HTTP 409. Recharger les données avant de reprendre la modification. Les lectures privées utilisent `useCache: false` et les écritures `ifMatch`.
- Les sessions expirent après huit heures ; déconnexion et changement de mot de passe révoquent les sessions côté serveur. L’authentification limite huit tentatives par quinze minutes et adresse réseau. Les requêtes d’écriture exigent une origine identique au site.
- Aucun email automatique n’est envoyé. Les confirmations publiques annoncent uniquement l’enregistrement de la demande. WhatsApp est affiché après configuration du numéro international.
- Le film animé de l’atelier reste la séquence originale du Guerrier ; il est indépendant de l’œuvre mise en avant dans la fiche dynamique.

## Statistiques

L’admin interroge côté serveur l’API Vercel Analytics pour les 7, 30 ou 90 derniers jours : pages vues, visiteurs par jour, pays, sources, appareils et pages. La période effectivement disponible dépend de l’offre Vercel. Les événements `artwork_detail`, `room_view`, `reservation_open`, `whatsapp_click` et `inquiry_sent` ne transmettent qu’un identifiant d’œuvre, aucune coordonnée client. Les événements personnalisés sont désactivés par défaut et dépendent de l’offre. Les statistiques de la galerie sont collectées en production ; les sessions admin ne chargent pas le script de suivi.

Une configuration absente ou un accès refusé produit un message explicite, sans statistiques inventées. Les visiteurs uniques affichés par jour ou groupe ne doivent pas être additionnés pour obtenir un total unique sur la période.

## Sauvegardes et limites

Le JSON exporté contient les données privées des clients ; le conserver en lieu sûr. Il exclut les mots de passe, sessions et tokens. La restauration (2 Mo maximum) valide les données, remplace la galerie et conserve le compte admin. Les CSV neutralisent les cellules susceptibles d’être interprétées comme des formules.

Les images sont **référencées**, pas intégrées au JSON : sauvegarder séparément leurs fichiers et conserver les stores. Une sauvegarde locale peut être restaurée localement ; les adresses `/api/local-media/` ne sont pas acceptées en production, où il faut réimporter les images dans Blob.

Le JSON partagé est adapté à une petite galerie. Chaque modification réécrit le document de gestion ; un grand volume de demandes nécessitera une architecture différente. Les quotas et coûts Blob/Functions/Analytics restent ceux de l’offre Vercel.

## Recette après déploiement

- Vérifier `/admin`, la connexion, le changement obligatoire du mot de passe et le refus des API sans session.
- Ajouter un tableau avec une image, modifier ses prix, publier, puis vérifier la vitrine dans un autre navigateur.
- Envoyer une demande publique, vérifier sa présence dans l’admin, l’accepter et suivre une vente.
- Exporter/restaurer une sauvegarde de prévisualisation et vérifier un conflit entre deux onglets d’édition.
- Redéployer et vérifier que tableaux, demandes et mot de passe persistent.
- Vérifier la connexion Analytics et les périodes réellement disponibles.
- Contrôler le rendu sur mobile et ordinateur, les dialogs et la navigation clavier.

## Documentation des services

- [Vercel Blob SDK et écritures conditionnelles](https://vercel.com/docs/vercel-blob/using-blob-sdk)
- [Uploads directs](https://vercel.com/docs/vercel-blob/client-upload)
- [Vercel Analytics API](https://vercel.com/docs/analytics/web-analytics-api)
- [Offres et limites Analytics](https://vercel.com/docs/analytics/limits-and-pricing)
