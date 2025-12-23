# Plan: Évolution du Droit - Visualisateur de Codes Juridiques

## Objectif

Créer un site web statique minimaliste permettant aux utilisateurs non-techniques de visualiser les évolutions des codes juridiques français hébergés sur https://git.tricoteuses.fr/codes.

## Contexte Technique

### Source de Données
- **112 dépôts git** représentant les différents codes juridiques français
- Chaque commit = une nouvelle loi/décret
- Les diffs = les modifications apportées par la loi
- API Forgejo disponible : `https://git.tricoteuses.fr/api/v1/repos/codes/{repo_name}/...`

### Structure d'un Dépôt (exemple: code_du_travail)
```
├── partie_legislative/
│   ├── premiere_partie/
│   │   └── livre_premier/
│   │       └── titre_premier/
│   │           └── chapitre_premier/
│   │               └── article_l1111-1.md
├── partie_reglementaire/
├── README.md
└── LICENCE.md
```

### Format des Commits
- **Message** : `Décret n° 2025-1174 du 8 décembre 2025 relatif à...`
- **Date** : Format ISO 8601
- **Fichiers modifiés** : Articles en markdown (ex: `article_l1234-5.md`)

---

## Architecture Proposée

### Technologies
- **HTML/CSS/JavaScript** pur (pas de framework lourd)
- **Client-side only** : toutes les requêtes API depuis le navigateur
- **CSS minimal** : utilisation de variables CSS pour les couleurs diff

### Structure des Fichiers
```
/home/user/evolution_du_droit/
├── index.html              # Page principale
├── css/
│   └── style.css          # Styles minimalistes + diff colors
├── js/
│   ├── api.js             # Appels API Forgejo
│   ├── diff.js            # Calcul et affichage des diffs
│   ├── ui.js              # Gestion de l'interface
│   └── app.js             # Point d'entrée
└── PLAN.md                # Ce fichier
```

---

## Fonctionnalités

### 1. Sélection du Code Juridique
- Liste déroulante avec les 112 codes disponibles
- Chargement dynamique depuis l'API : `GET /api/v1/orgs/codes/repos`
- Affichage du nom lisible (transformation snake_case → titre)

### 2. Sélection des Dates
- **Date de début** : sélecteur de date
- **Date de fin** : sélecteur de date (par défaut: aujourd'hui)
- Validation : début < fin

### 3. Mode d'Affichage (Toggle)

#### Mode A : Vue Avant/Après
```
┌─────────────────────┬─────────────────────┐
│  Version [date1]    │  Version [date2]    │
├─────────────────────┼─────────────────────┤
│  - ligne supprimée  │  + ligne ajoutée    │
│  texte inchangé     │  texte inchangé     │
└─────────────────────┴─────────────────────┘
```
- Deux colonnes côte à côte
- Lignes supprimées en rouge (gauche)
- Lignes ajoutées en vert (droite)
- Synchronisation du scroll

#### Mode B : Liste des Changements
```
┌────────────────────┬───────────────────────────┐
│ Liste des commits  │    Détail du commit       │
├────────────────────┼───────────────────────────┤
│ > 2025-12-10       │  [Diff de ce commit]      │
│   Décret n°2025... │                           │
│                    │                           │
│   2025-12-05       │                           │
│   Décret n°2025... │                           │
└────────────────────┴───────────────────────────┘
```
- Colonne gauche : liste des commits dans la période
- Colonne droite : diff du commit sélectionné
- Clic sur un commit affiche son diff

---

## Implémentation Détaillée

### Étape 1 : Structure HTML de Base
- Layout responsive avec CSS Grid/Flexbox
- Formulaire de sélection (code, dates, mode)
- Zones d'affichage des résultats

### Étape 2 : Module API (api.js)
```javascript
// Fonctions principales
async function fetchRepositories()
// GET /api/v1/orgs/codes/repos?limit=200

async function fetchCommits(repoName, since, until)
// GET /api/v1/repos/codes/{repo}/commits?since=...&until=...

async function fetchCommitDetail(repoName, sha)
// GET /api/v1/repos/codes/{repo}/git/commits/{sha}

async function fetchFileAtCommit(repoName, sha, filePath)
// GET /api/v1/repos/codes/{repo}/raw/{sha}/{path}

async function fetchDiff(repoName, baseSha, headSha)
// Compare entre deux commits
```

### Étape 3 : Module Diff (diff.js)
- Utilisation d'une bibliothèque légère de diff (diff-match-patch ou jsdiff)
- Ou implémentation simple d'un algorithme LCS
- Génération du HTML coloré pour l'affichage

### Étape 4 : Module UI (ui.js)
- Gestion des événements (sélection, toggle, scroll sync)
- Rendu des vues avant/après et liste des changements
- États de chargement et gestion d'erreurs

### Étape 5 : Styles CSS (style.css)
```css
:root {
  --color-add: #e6ffec;
  --color-add-text: #1a7f37;
  --color-del: #ffebe9;
  --color-del-text: #cf222e;
  --color-bg: #ffffff;
  --color-border: #d0d7de;
}
```

---

## Considérations Techniques

### CORS
- L'API Forgejo devrait supporter CORS pour les requêtes publiques
- Si problème : utiliser un proxy CORS ou précharger les données

### Performance
- Pagination des commits (limite par défaut: 50)
- Lazy loading des diffs (charger uniquement à la demande)
- Cache local (sessionStorage) pour les données déjà chargées

### Accessibilité
- Labels ARIA pour les contrôles
- Navigation clavier
- Contraste suffisant pour les couleurs de diff

### UX pour Non-Techniciens
- Vocabulaire simple (pas de "commit", mais "modification" ou "changement")
- Dates en format français (jj/mm/aaaa)
- Messages d'aide contextuels

---

## Étapes de Développement

1. **[Étape 1]** Créer la structure HTML de base avec le formulaire
2. **[Étape 2]** Implémenter le module API et tester la récupération des données
3. **[Étape 3]** Créer l'affichage de la liste des codes et commits
4. **[Étape 4]** Implémenter le calcul de diff texte
5. **[Étape 5]** Créer la vue "Avant/Après" avec deux colonnes
6. **[Étape 6]** Créer la vue "Liste des changements"
7. **[Étape 7]** Ajouter les styles CSS et polish final
8. **[Étape 8]** Tests et corrections

---

## API Endpoints Utilisés

| Endpoint | Description |
|----------|-------------|
| `GET /api/v1/orgs/codes/repos` | Liste tous les dépôts |
| `GET /api/v1/repos/codes/{repo}/commits` | Liste les commits |
| `GET /api/v1/repos/codes/{repo}/git/commits/{sha}` | Détail d'un commit |
| `GET /api/v1/repos/codes/{repo}/contents/{path}?ref={sha}` | Contenu fichier |
| `GET /api/v1/repos/codes/{repo}/git/trees/{sha}` | Arborescence |

---

## Livrables

- Site web statique fonctionnel
- Code source commenté
- Interface intuitive pour utilisateurs non-techniques
