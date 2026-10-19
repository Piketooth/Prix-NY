# New York

Appli « New York » (PWA et APK Android) : elle convertit un prix affiché à New York (USD) en euros, avec la sales tax et le pourboire en option.

- **Taux de change** : récupéré à chaque ouverture (BCE via [Frankfurter](https://frankfurter.dev), secours [ExchangeRate-API](https://www.exchangerate-api.com)), gardé en mémoire pour le mode hors ligne.
- **Taxes** : lues dans [`taxes.json`](taxes.json). Pour mettre à jour un taux, modifiez ce fichier et poussez sur `main` : tous les téléphones l'auront à la prochaine ouverture.
- **Taxes et pourboire** : sales tax NYC (8,875 %) activable dans les Réglages ; exonérations automatiques pour les vêtements et chaussures sous 110 $ par article et pour l'épicerie / pharmacie, avec une explication ⓘ ; pourboire proposé uniquement dans la catégorie Resto (15–25 %, calculé sur le prix hors taxe ou taxe comprise).
- **Saisie** : pavé numérique intégré (appui long sur ⌫ pour effacer), saisie vocale du prix et de la catégorie (français ou anglais), nom d'article facultatif (sinon « Article N »), quantité, catégories (Shopping, Vêtements et chaussures, Resto, Épicerie / Pharmacie, Transport, Autre). Resto et Transport : pourboire et partage entre plusieurs personnes ; en Transport, aucune taxe ajoutée (prix affiché = prix final, explication ⓘ) et pourboire de taxi (20 %) par défaut, « Aucun » pour le métro.
- **Réglages** : taux de change personnalisé (avec retour au cours officiel), bouton « Mettre à jour le cours » (le cours est aussi revérifié au retour dans l’appli après 30 min), frais bancaires de la carte, sales tax NYC, langue de la saisie vocale, son au démarrage, deuxième horloge (ville tapée, dictée ou trouvée par géolocalisation via BigDataCloud ; Paris par défaut) affichée sous le titre avec l’heure de New York.
- **Panier** : ajout de l'article en cours, rappel du nombre d'articles et du total (€ et $) en haut de l'écran, articles numérotés et renommables, quantité modifiable, totaux par catégorie, glisser vers la gauche pour supprimer (avec annulation), partage en texte (WhatsApp, e-mail…), réinitialisation depuis l'écran principal, paniers enregistrés sous un nom personnalisé (stockés sur l'appareil), sauvegardés automatiquement quand ils sont ouverts, et bouton « Ajouter à… » pour ajouter un article directement dans un panier enregistré. Modifications : renommer le panier (toucher son titre), modifier le prix d'un article (toucher son montant), changer sa catégorie (toucher sa pastille, avec recalcul de la taxe et du pourboire) ; dans « Mes paniers », menu ⋯ ou appui long : ouvrir, modifier sans l'ouvrir, renommer, dupliquer, supprimer.
- **Scan caméra** : lecture d’une étiquette de prix par OCR ([Tesseract.js](https://tesseract.projectnaptha.com), Apache-2.0, embarqué dans `vendor/tesseract` : fonctionne hors ligne).
- **Sauvegarde** : dans « Mes paniers », Exporter (fichier JSON partagé ou téléchargé) et Importer (fichier ou texte collé) ; l’import ajoute les paniers sans écraser l’existant.
- **Clavier maison** : AZERTY givré pour les champs texte, accents par appui long, suggestions, correction automatique à l'espace (annulable) et apprentissage ; dictionnaire FR/EN dérivé de [wordfreq](https://github.com/rspeer/wordfreq) (CC BY-SA 4.0, voir `dict/LICENSE.txt`).
- **Bandeau fixe** sur toutes les pages, replié en barre fine (« New York », heure et météo de New York, cours) et dépliable au toucher ou en tirant vers le bas : date, cours, heures et météo des deux villes ([Open-Meteo](https://open-meteo.com), sans clé), raccourcis Android « Wi-Fi et données » et « Itinérance » ; l’icône météo ouvre la page **Météo** (aujourd’hui en grand, les 6 jours suivants, New York ou la deuxième ville) ; police inspirée de la signalétique du métro (Archivo Narrow, OFL) ; titre de chaque page en gothique.
- **Hôtel** : prix d’une nuit et nombre de nuits, + 14,75 % de taxes et 3,50 $ par nuit. **Calculatrice** simple (+ − × ÷ %).
- **Navigation** : menu ☰ de l’écran principal (Panier, Mes paniers, Applis utiles, Réglages) ; passer d’un écran à l’autre (Accueil, Applis utiles, Panier, Mes paniers, Réglages) en faisant glisser le doigt, dans l’ordre choisi dans les Réglages ; bouton ⓘ sur chaque appli (à quoi elle sert) et sur la page Réglages.
- **Applis utiles** : raccourcis vers une sélection d’applis pour New York (Google Maps, Citymapper, MTA, Uber, Lyft, Curb, Citi Bike, NYC Ferry, Traduction, Google Wallet, Wise, Yelp, OpenTable, TodayTix), choisies et ordonnées dans les Réglages (les non installées passent à la fin), plus ses propres applis choisies parmi celles du téléphone ; dans l’APK, icônes officielles lues sur le téléphone, appli non installée grisée menant au Play Store ([@capacitor/app-launcher](https://capacitorjs.com/docs/apis/app-launcher)).
- **Fonds d'écran** : 8 photos de New York générées avec Magnific (Central Park, taxis, Brooklyn Bridge, Empire State, Statue de la Liberté, Radio City, Times Square, promenade de Brooklyn), au choix dans les Réglages, en aléatoire ou avec changement automatique, affichées à 100 %, ou jusqu’à 5 photos du téléphone (« Ma photo »), cadrées au doigt (glisser, pincer) et recadrables ensuite ; couleurs adaptées à la photo, intensité et teinte du givré réglables (nuancier), ombres et lueurs dosées automatiquement et ajustables, ou givré animé (toutes les x s, de y à z en d s, puis retour).

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
