# Évolution du droit

Montre, code par code, chaque modification du droit codifié français, article par article, en
vue avant/après ou en liste. Les données viennent des 111 codes non vides publiés en dépôts git par
[git.tricoteuses.fr](https://git.tricoteuses.fr/codes). La page est statique : chaque
modification est précalculée en un fichier JSON compressé.

## Lancer

```bash
./run.sh                              # clone ou met à jour les codes, génère data/, assemble _site/
python3 scripts/generate_data.py      # régénère data/ depuis les codes déjà clonés dans codes/
python3 -m http.server -d _site       # consulter le site assemblé
```

Un premier `run.sh` clone environ 3 Go de dépôts dans `codes/` et calcule environ 55 000
modifications (environ 30 minutes) ; les suivants ne calculent que les nouvelles.

## Organisation

| Fichier | Rôle |
|---|---|
| `run.sh` | sans argument : `build_data.py`, puis copie la page et `data/` dans `_site/` |
| `scripts/build_data.py` | liste les codes par l'API Forgejo, les clone ou les met à jour dans `codes/`, puis lance `generate_data.py` |
| `scripts/generate_data.py` | lit `codes/`, écrit `data/repos.json`, `data/commits/<code>.json` et `data/details/<code>/<sha>.json.gz` |
| `scripts/verify_data.py` | compte les fichiers de détail manquants ; **réécrit aussi `data/repos.json` avec des noms reconstruits depuis les identifiants**, à ne pas lancer avant une publication |
| `scripts/compress_data.py` | conversion ponctuelle d'anciens fichiers `.json` en `.json.gz` |
| `index.html`, `css/`, `js/` | la page |
| `.github/workflows/deploy.yml` | le 1er de chaque mois, à chaque push sur `master` et à la demande : `run.sh` puis publication sur GitHub Pages |

## Règles fermes

- **Les données ne sont pas versionnées.** `codes/`, `data/` et `_site/` sont reconstruits par
  `run.sh`, en local comme dans la CI, et publiés depuis la CI.
- **Une génération incomplète arrête tout.** Liste des codes inaccessible, clone en échec ou
  modification impossible à calculer : le script s'arrête en le nommant, et la page publiée reste
  la précédente.
- **Un dépôt vide est écarté et nommé** (`code_de_procedure_civile_1807` depuis juillet 2026).
