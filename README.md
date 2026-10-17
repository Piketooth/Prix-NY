# Vrai Prix New York

Appli web installable (PWA) pour Android : elle convertit un prix affiché à New York (USD) en euros, avec la sales tax et le pourboire en option.

- **Taux de change** : récupéré à chaque ouverture (BCE via [Frankfurter](https://frankfurter.dev), secours [ExchangeRate-API](https://www.exchangerate-api.com)), gardé en mémoire pour le mode hors ligne.
- **Taxes** : lues dans [`taxes.json`](taxes.json). Pour mettre à jour un taux, modifiez ce fichier et poussez sur `main` : tous les téléphones l'auront à la prochaine ouverture.
- **Taxes et pourboire** : sales tax NYC (8,875 %) activable dans les Réglages ; exonérations automatiques pour les vêtements et chaussures sous 110 $ par article et pour l'épicerie / pharmacie, avec une explication ⓘ ; pourboire proposé uniquement dans la catégorie Resto (15–25 %, calculé sur le prix hors taxe ou taxe comprise).
- **Saisie** : pavé numérique intégré (appui long sur ⌫ pour effacer), saisie vocale du prix et de la catégorie (français ou anglais), nom d'article facultatif (sinon « Article N »), quantité, catégories (Shopping, Vêtements et chaussures, Resto, Épicerie / Pharmacie, Autre). Resto : pourboire et partage de l'addition entre plusieurs personnes.
- **Réglages** : taux de change personnalisé (avec retour au cours officiel), frais bancaires de la carte, sales tax NYC, langue de la saisie vocale, son au démarrage.
- **Panier** : ajout de l'article en cours, rappel du nombre d'articles et du total (€ et $) en haut de l'écran, articles numérotés et renommables, quantité modifiable, totaux par catégorie, glisser vers la gauche pour supprimer (avec annulation), partage en texte (WhatsApp, e-mail…), réinitialisation depuis l'écran principal, paniers enregistrés sous un nom personnalisé (stockés sur l'appareil), sauvegardés automatiquement quand ils sont ouverts, et bouton « Ajouter à… » pour ajouter un article directement dans un panier enregistré. Modifications : renommer le panier (toucher son titre), modifier le prix d'un article (toucher son montant), changer sa catégorie (toucher sa pastille, avec recalcul de la taxe et du pourboire) ; dans « Mes paniers », menu ⋯ ou appui long : ouvrir, modifier sans l'ouvrir, renommer, dupliquer, supprimer.
- **Scan caméra** : lecture d’une étiquette de prix par OCR ([Tesseract.js](https://tesseract.projectnaptha.com), Apache-2.0, embarqué dans `vendor/tesseract` : fonctionne hors ligne).
- **Sauvegarde** : dans « Mes paniers », Exporter (fichier JSON partagé ou téléchargé) et Importer (fichier ou texte collé) ; l’import ajoute les paniers sans écraser l’existant.
- **Clavier maison** : AZERTY givré pour les champs texte, accents par appui long, suggestions, correction automatique à l'espace (annulable) et apprentissage ; dictionnaire FR/EN dérivé de [wordfreq](https://github.com/rspeer/wordfreq) (CC BY-SA 4.0, voir `dict/LICENSE.txt`).
- **Fonds d'écran** : 8 photos de New York générées avec Magnific (Central Park, taxis, Brooklyn Bridge, Empire State, Statue de la Liberté, Radio City, Times Square, promenade de Brooklyn), au choix dans les Réglages, en aléatoire ou avec changement automatique, affichées à 100 %, ou jusqu’à 5 photos du téléphone (« Ma photo ») ; couleurs adaptées à la photo et intensité du givré réglables.

## Mise en ligne (GitHub Pages)

1. Dans le dépôt GitHub : **Settings → Pages → Source : Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
2. Chaque modification poussée sur `main` est publiée automatiquement en une minute environ.
3. Sur Android, ouvrez https://piketooth.github.io/Prix-NY/ dans Chrome, puis menu **⋮ → Installer l'application**.

## APK Android

Chaque modification poussée sur `main` compile un APK (projet [Capacitor](https://capacitorjs.com) dans `android/`) et le publie dans les [Releases](https://github.com/Piketooth/Prix-NY/releases/latest) :

- Téléchargement direct : https://github.com/Piketooth/Prix-NY/releases/latest/download/prix-ny.apk
- L'appli est embarquée dans l'APK (fonctionne hors ligne) ; les taux de taxe sont lus sur le site publié, avec `taxes.json` embarqué en secours.

**Signature.** Sans configuration, l'APK est signé avec une clé de debug qui change à chaque compilation : il faut désinstaller l'ancienne version avant d'installer la nouvelle. Pour pouvoir installer les mises à jour par-dessus, ajoutez dans *Settings → Secrets and variables → Actions* : `ANDROID_KEYSTORE_BASE64` (keystore encodé en base64), `ANDROID_KEYSTORE_PASSWORD` et `ANDROID_KEY_ALIAS`.

## Tests automatiques

```sh
npm install
npx playwright install chromium
npm test
```

Les tests (dossier `tests/`) tournent aussi à chaque compilation de l’APK : un échec bloque la publication.

## Tester en local

```sh
python3 -m http.server 8000
# puis http://localhost:8000
```

La caméra exige HTTPS (ou `localhost`).
