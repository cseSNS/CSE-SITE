# Site CSE

Site CSE pour centraliser les actualites, l'agenda, les PV, les membres elus et une boite a idees anonyme avec moderation et votes.

## Lancer en local

```bash
npm start
```

Le site ecoute sur `http://localhost:8080`.

L'espace admin est disponible sur le chemin configure par `ADMIN_PATH`.
En local, les valeurs sont dans le fichier `.env` ignore par Git.
PostgreSQL est obligatoire: `DATABASE_URL` doit etre configure, ou lance via `docker compose`.

## Lancer avec Docker / Portainer

```bash
docker compose up -d --build
```

Le service expose le port `8080` uniquement sur `127.0.0.1`. Nginx doit faire le reverse proxy HTTPS.
Les documents uploades restent dans le volume Docker `cse_data`.
Les contenus, idees et futurs objets applicatifs sont stockes dans PostgreSQL.

Avant une mise en production, configure `ADMIN_PATH`, `ADMIN_BOOTSTRAP_EMAIL` et `ADMIN_BOOTSTRAP_PASSWORD` dans Portainer ou dans un fichier `.env` non versionne.
Au premier demarrage, le serveur cree un compte administrateur local si aucun compte admin n'existe encore.
`CSE_NOTIFICATION_WEBHOOK` peut etre renseigne pour notifier un outil externe lors d'une nouvelle idee ou d'un nouveau document.

Variables minimales:

```env
ADMIN_PATH=/une-url-admin-privee
ADMIN_BOOTSTRAP_EMAIL=cse-admin@entreprise.fr
ADMIN_BOOTSTRAP_PASSWORD=un-mot-de-passe-admin-long
ADMIN_BOOTSTRAP_NAME=Administrateur CSE
ADMIN_SESSION_MAX_AGE_SECONDS=14400
COOKIE_SECURE=true
MAIL_SETTINGS_ENCRYPTION_KEY=64-caracteres-hexadecimaux-aleatoires
POSTGRES_DB=cse
POSTGRES_USER=cse
POSTGRES_PASSWORD=un-mot-de-passe-postgres-long
CSE_NOTIFICATION_WEBHOOK=
```

Le `docker-compose.yml` construit automatiquement `DATABASE_URL` pour connecter l'application au service PostgreSQL.
Au premier demarrage, le serveur cree le schema PostgreSQL et insere le contenu par defaut si la base est vide.
Le premier compte administrateur est cree uniquement si la table des admins est vide.

## Boite a idees

- Endpoint public: `POST /api/ideas`
- Moderation: chemin prive configure par `ADMIN_PATH`
- Stockage: PostgreSQL
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
- publier des articles et informations CSE plus longs avec mise en forme, liens et images;
- gerer les brouillons et articles publies;
- modifier l'agenda des reunions;
- uploader des PV en PDF publics ou prives;
- modifier les membres CSE avec nom, prenom, service, site, photo et role titulaire/suppleant;
- configurer un serveur SMTP et envoyer un email de test depuis l'interface;
- creer, reactiver, desactiver et mettre a jour les mots de passe des comptes admin.

Les sessions admin utilisent un cookie `HttpOnly`. Les mots de passe sont hashes en base avec `scrypt`.
Garde `COOKIE_SECURE=true` en production derriere HTTPS.

## Securite

- Les comptes disposent d'un role: `owner` (comptes, SMTP et configuration) ou `editor` (contenu, documents, idees).
- Les sessions sont stockees en base sous forme de hash, expirent par defaut apres 4 heures et utilisent en HTTPS un cookie `__Host-` avec `HttpOnly`, `Secure`, `SameSite=Strict` et `Priority=High`.
- Les actions sensibles controlent l'origine de la requete, attendent du JSON et sont limitees en debit. La connexion est limitee a 5 essais par compte et par quart d'heure.
- Les articles riches sont assainis avant stockage. Les liens et images ne peuvent utiliser que des URL `https`, des liens `mailto` ou des images `data` valides.
- Les mots de passe SMTP sont chiffres avec AES-256-GCM dans PostgreSQL. Genere la cle sur le VPS, garde-la dans `.env` et ne la mets jamais dans Git:

```bash
openssl rand -hex 32
```

- Les actions d'administration sont journalisees dans la table PostgreSQL `admin_audit_log` (connexion, contenus, documents, moderation, comptes et SMTP).

### Fail2ban sur le VPS

L'application limite deja les essais. Pour bannir au niveau du VPS les adresses qui insistent, installe Fail2ban puis copie les fichiers fournis:

```bash
sudo apt update
sudo apt install -y fail2ban
sudo cp deploy/fail2ban/filter.d/cse-nginx-admin.conf /etc/fail2ban/filter.d/
sudo cp deploy/fail2ban/jail.d/cse-nginx-admin.local /etc/fail2ban/jail.d/
sudo fail2ban-regex /var/log/nginx/access.log /etc/fail2ban/filter.d/cse-nginx-admin.conf
sudo systemctl restart fail2ban
sudo fail2ban-client status cse-nginx-admin
```

Le jail surveille les echecs de connexion (`401`, `403` ou `429`) dans les logs Nginx et bannit une adresse apres 5 essais pendant 15 minutes, pour 12 heures.

Le virtual host Nginx doit conserver les informations d'origine suivantes vers le conteneur, sans quoi le controle anti-CSRF bloquera les ecritures admin:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Forwarded-Host $host;
proxy_set_header X-Forwarded-Proto $scheme;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
```

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

Avant une mise a jour importante, fais une sauvegarde:

```bash
sh scripts/backup-data.sh
sh scripts/backup-postgres.sh
```

## Evolutions utiles

- Authentification Azure AD / Entra ID pour les elus CSE uniquement.
- Authentification des votes si l'entreprise accepte de sortir du vote purement anonyme.
