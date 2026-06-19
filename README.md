# Site CSE

Site CSE pour centraliser les actualites, l'agenda, les PV, les membres elus et une boite a idees anonyme avec moderation et votes.

## Lancer en local

```bash
npm start
```

Le site ecoute sur `http://localhost:8080`.

L'espace admin est disponible sur le chemin configure par `ADMIN_PATH`.
En local, les valeurs sont dans le fichier `.env` ignore par Git.

## Lancer avec Docker / Portainer

```bash
docker compose up -d --build
```

Le service expose le port `8080` uniquement sur `127.0.0.1`. Nginx doit faire le reverse proxy HTTPS.
Les documents uploades restent dans le volume Docker `cse_data`.
Les contenus, idees et futurs objets applicatifs sont stockes dans PostgreSQL quand `DATABASE_URL` est configure.

Avant une mise en production, configure `ADMIN_TOKEN` et `ADMIN_PATH` dans Portainer ou dans un fichier `.env` non versionne.
Le serveur refuse l'API admin si `ADMIN_TOKEN` est absent ou trop court.
`CSE_NOTIFICATION_WEBHOOK` peut etre renseigne pour notifier un outil externe lors d'une nouvelle idee ou d'un nouveau document.

Variables minimales:

```env
ADMIN_TOKEN=un-token-long-et-secret
ADMIN_PATH=/une-url-admin-privee
POSTGRES_DB=cse
POSTGRES_USER=cse
POSTGRES_PASSWORD=un-mot-de-passe-postgres-long
CSE_NOTIFICATION_WEBHOOK=
```

Le `docker-compose.yml` construit automatiquement `DATABASE_URL` pour connecter l'application au service PostgreSQL.
Au premier demarrage avec PostgreSQL, le serveur cree le schema et migre les fichiers JSON existants depuis `/data` si la base est vide.

## Boite a idees

- Endpoint public: `POST /api/ideas`
- Moderation: chemin prive configure par `ADMIN_PATH`
- Stockage: PostgreSQL si configure, sinon JSON persistant dans le volume Docker
- Donnees stockees: date, categorie, message, contexte optionnel
- Donnees non stockees: nom, email, IP, identifiant collaborateur
- Workflow: attente, validation, rejet
- Statuts admin: attente, publiee, en cours, traitee, rejetee
- Vote: les idees validees sont publiees sur le site et peuvent recevoir des votes
- Protection simple: limitation en memoire a 5 actions toutes les 10 minutes par source
- Export CSV disponible depuis l'admin

## Administration

L'admin permet de:

- valider ou rejeter les idees anonymes;
- publier les idees validees pour permettre le vote des collaborateurs;
- modifier les actualites;
- publier des articles et informations CSE plus longs;
- gerer les brouillons et articles publies;
- modifier l'agenda des reunions;
- uploader des PV en PDF publics ou prives;
- modifier les membres CSE avec nom, prenom, service, site, photo et role titulaire/suppleant.

## Pages publiques

- `/` : accueil synthese avec les derniers contenus.
- `/actualites.html` : actualites CSE.
- `/infos.html` : articles, dossiers et informations pratiques.
- `/agenda.html` : reunions et temps forts.
- `/documents.html` : PV et documents utiles.
- `/idees.html` : depot d'idee anonyme et votes.
- `/membres.html` : trombinoscope des membres CSE.
- `/confidentialite.html` : informations donnees/anonymat.
- chemin `ADMIN_PATH` : administration.

## Sauvegardes

Sur le VPS, sauvegarde les documents uploades avec:

```bash
sh scripts/backup-data.sh
```

Le script cree une archive `tar.gz` du dossier `/data` du container `cse-site`.

Sauvegarde PostgreSQL avec:

```bash
sh scripts/backup-postgres.sh
```

Conserve les deux sauvegardes: PostgreSQL contient les contenus et idees, `/data` contient les fichiers uploades.

## Mise a jour VPS

Depuis le dossier du repo sur le VPS:

```bash
git pull
docker compose up -d --build
```

Avant la premiere migration PostgreSQL, fais une sauvegarde:

```bash
sh scripts/backup-data.sh
```

## Evolutions utiles

- Authentification Azure AD / Entra ID pour les elus CSE uniquement.
- Authentification des votes si l'entreprise accepte de sortir du vote purement anonyme.
