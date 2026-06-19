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

Le service expose le port `8080`. Les contenus, documents uploades et idees sont conserves dans le volume Docker `cse_data`.

Avant une mise en production, configure `ADMIN_TOKEN` et `ADMIN_PATH` dans Portainer ou dans un fichier `.env` non versionne.
Le serveur refuse l'API admin si `ADMIN_TOKEN` est absent ou trop court.
`CSE_NOTIFICATION_WEBHOOK` peut etre renseigne pour notifier un outil externe lors d'une nouvelle idee ou d'un nouveau document.

## Boite a idees

- Endpoint public: `POST /api/ideas`
- Moderation: chemin prive configure par `ADMIN_PATH`
- Stockage: JSON persistant dans le volume Docker
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

Sur le VPS, lance une sauvegarde du volume applicatif avec:

```bash
sh scripts/backup-data.sh
```

Le script cree une archive `tar.gz` du dossier `/data` du container `cse-site`.

## Evolutions utiles

- Authentification Azure AD / Entra ID pour les elus CSE uniquement.
- Base PostgreSQL separee si les workflows deviennent plus riches.
- Authentification des votes si l'entreprise accepte de sortir du vote purement anonyme.
