# Prix NY

Appli web installable (PWA) pour Android : elle convertit un prix affiché à New York (USD) en euros, avec la sales tax et le pourboire en option.

- **Taux de change** : récupéré à chaque ouverture (BCE via [Frankfurter](https://frankfurter.dev), secours [ExchangeRate-API](https://www.exchangerate-api.com)), gardé en mémoire pour le mode hors ligne.
- **Taxes** : lues dans [`taxes.json`](taxes.json). Pour mettre à jour un taux, modifiez ce fichier et poussez sur `main` : tous les téléphones l'auront à la prochaine ouverture.
- **Options (cases à cocher)** : sales tax NYC (8,875 %), exonération vêtements/chaussures < 110 $ par article, pourboire 15–25 % calculé sur le prix hors taxe ou taxe comprise.
- **Scan caméra** : lecture d'une étiquette de prix par OCR ([Tesseract.js](https://tesseract.projectnaptha.com), chargé au premier scan ; nécessite une connexion la première fois).

## Mise en ligne (GitHub Pages)

1. Dans le dépôt GitHub : **Settings → Pages → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
2. Chaque modification poussée sur `main` est publiée automatiquement en une minute environ.
3. Sur Android, ouvrez https://piketooth.github.io/Prix-NY/ dans Chrome, puis menu **⋮ → Installer l'application**.

## Tester en local

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

La caméra exige HTTPS (ou `localhost`).
