# TBM Bordeaux

Cette intégration affiche dans Gladys les **prochains passages en temps réel** des trams, bus et
bateaux du réseau **TBM** (Bordeaux Métropole), **sens par sens** : pour chaque ligne suivie à une
station, vous savez dans combien de minutes passe le prochain véhicule de chaque sens, et où il
va.

Pas de compte, pas de clé : le temps réel TBM est publié en données ouvertes.

> Intégration communautaire, sans lien avec TBM, Keolis Bordeaux Métropole Mobilités ou Bordeaux
> Métropole.

## Démarrer

1. **Donnez une adresse à votre maison** dans Gladys : **Paramètres → Maisons**. L'intégration
   s'en sert pour trouver les stations proches.
2. Ouvrez la page **Configuration** de l'intégration et cliquez sur **Enregistrer** (les valeurs
   par défaut conviennent).
3. Ouvrez l'onglet **Découverte** : les lignes des 3 stations les plus proches (à moins de 600 m)
   y sont proposées, par exemple « TBM – Hôtel de Ville – Tram A ». Cliquez sur **Ajouter** sur
   celles qui vous intéressent.

Les prochains passages arrivent dans la minute.

Si vous avez plusieurs maisons dans Gladys, l'intégration cherche autour de la **première maison
qui a une adresse**, dans l'ordre alphabétique.

## Ce que vous obtenez

Un appareil par **ligne à une station**. Pour chaque sens de la ligne :

| Fonctionnalité                      | Valeur                                                  |
| ----------------------------------- | ------------------------------------------------------- |
| Sens 1 → … · **prochain passage**   | minutes avant le prochain passage (999 : aucun passage) |
| Sens 1 → … · **destination**        | où va ce véhicule, par exemple « La Gardette »          |
| Sens 1 → … · **passage suivant**    | minutes avant le passage d'après                        |
| Sens 1 → … · **prochains passages** | « La Gardette 3 min · Cenon Gare ~11 min (+2) »         |

Le nom de chaque fonctionnalité dit où va le sens : « Sens 1 → Hôpital Pellegrin / Le Haillan
Rostand ». La **destination** est celle du véhicule lui-même : sur une ligne qui se divise (le tram
A après Buttinière), le sens 2 part une fois vers La Gardette, la fois suivante vers Cenon Gare.

Dans les textes :

- **~11 min** : horaire théorique, le véhicule n'est pas encore suivi en temps réel (souvent un
  tram qui n'a pas quitté son terminus) ;
- **(+2)** : 2 minutes de retard sur l'horaire prévu ;
- **à l'arrêt** : moins d'une minute.

Les valeurs ne sont pas historisées : un compte à rebours n'a pas d'intérêt une fois passé.

## Suivre une autre station

Pour une station qui n'est pas près de chez vous (travail, école…) :

1. En bas de la page **Configuration**, cliquez sur **Chercher une station** et tapez une partie
   du nom (« Quinconces »). La réponse donne le code de chaque station et ses lignes :

   ```
   BMUNIC — Quinconces : Lianes 2, TBNight N8
   BQUIOR — Quinconces : Lianes 2, TBNight N6
   ```

   Le tram et le bus qui s'arrêtent au même endroit sont deux stations différentes (les codes de
   tram commencent par T, ceux de bus par B).

2. Collez le code dans le champ **Stations**. Pour ne garder que certaines lignes, ajoutez `@` et
   leurs numéros, séparés par `|` :

   | Saisie              | Résultat                                        |
   | ------------------- | ----------------------------------------------- |
   | `THDVA`             | toutes les lignes de Hôtel de Ville (tram)      |
   | `THDVA@A`           | seulement le tram A                             |
   | `BQUIOR@2\|N6`      | la Lianes 2 et la TBNight N6 à Quinconces (bus) |
   | `THDVA@A, BQUIOR@2` | plusieurs stations, séparées par des virgules   |

3. Enregistrez, puis ajoutez les appareils depuis l'onglet **Découverte**.

Un code mal saisi est signalé dans l'état de la connexion, en haut de la page de configuration.

## Réglages

| Réglage                   | Rôle                                                             | Défaut   |
| ------------------------- | ---------------------------------------------------------------- | -------- |
| Stations près de chez moi | combien de stations proches sont proposées (0 : aucune)          | 3        |
| Rayon de recherche (m)    | distance maximale entre la maison et une station proposée        | 600      |
| Inclure les bus scolaires | proposer aussi les lignes scolaires SCODI                        | non      |
| Stations                  | stations saisies à la main (voir plus haut)                      | vide     |
| Rafraîchissement (s)      | fréquence de lecture des passages                                | 60       |
| Passages dans le résumé   | nombre de passages par sens dans le texte « prochains passages » | 3        |
| Langue des valeurs        | langue des noms de fonctionnalités et des textes                 | français |

Les **bus de remplacement** pendant des travaux (« Navette Tram », « Bus Relais ») ne sont pas
proposés automatiquement : ajoutez-les par leur numéro dans **Stations** si besoin.

## Tableau de bord

Le widget **Passages TBM** affiche une ligne à une station comme un panneau d'arrêt : une tuile
par sens avec le prochain passage, puis les prochains départs des deux sens, du plus proche au
plus lointain — en vert s'ils sont suivis en temps réel, en gris (« ~ ») si c'est l'horaire
théorique, en orange à partir de 5 minutes de retard.

Ajoutez-le depuis l'édition du tableau de bord, puis choisissez dans ses réglages :

- **Ligne à une station** : l'appareil à afficher ;
- **Sens** (facultatif) : « Sens 1 » ou « Sens 2 », comme dans les noms des fonctionnalités de
  l'appareil, pour n'afficher que les passages de ce sens, avec sous le titre l'endroit où il va.
  Laissé vide, le widget affiche les deux sens.

Pour suivre les deux sens séparément, ajoutez deux widgets sur la même ligne, un par sens.

## Scènes

### Déclencheur « TBM : passage imminent »

Se déclenche quand un véhicule d'une ligne suivie passe **sous** le nombre de minutes choisi (1,
2, 3, 5, 10 ou 15), compté sur l'heure **réelle**. Filtres : la ligne (appareil), le sens (1 ou 2,
comme dans les noms des fonctionnalités ; vide pour les deux), les minutes.

Chaque véhicule ne déclenche qu'une fois par seuil. Variables disponibles : station, ligne, sens,
destination, minutes, retard, suivi en temps réel, heure, et une **phrase toute faite** :

> Hôtel de Ville : Tram A vers La Gardette passe dans 5 min (17:58, 2 min de retard).

Exemple : envoyer la phrase sur votre téléphone quand le tram passe dans 5 minutes.

### Action « Lire le prochain passage TBM »

Lit le prochain passage d'une ligne (un sens, ou les deux) et le rend aux actions suivantes de la
scène : minutes d'attente (-1 si aucun), le suivant, la ligne, la destination, l'heure, le retard
et la phrase toute faite, à envoyer en notification ou à faire annoncer.

## Boutons de la page de configuration

- **Chercher une station** — trouve le code d'une station par son nom.
- **Tester la connexion** — interroge TBM tout de suite et affiche le nombre de stations, le
  prochain passage d'une de vos stations et ce qui a été trouvé près de la maison.

## Dépannage

| Message ou symptôme                    | Que faire                                                                         |
| -------------------------------------- | --------------------------------------------------------------------------------- |
| « Donnez une adresse à votre maison… » | Paramètres → Maisons : renseignez l'adresse, puis réenregistrez la configuration. |
| Rien dans l'onglet Découverte          | Augmentez le rayon de recherche, ou ajoutez une station à la main.                |
| « Introuvable dans Stations : … »      | Vérifiez le code avec **Chercher une station**.                                   |
| « Le service TBM ne répond pas »       | Panne côté TBM : l'intégration réessaie seule et garde l'annuaire connu.          |
| Toujours 999                           | Aucun passage dans l'heure (nuit, fin de service, sens non desservi ici).         |

## Données

Données temps réel et annuaire du réseau : TBM / Bordeaux Métropole, jeu
[Réseau urbain et scolaire TBM](https://transport.data.gouv.fr/datasets/offres-de-services-bus-tram-et-scolaire-au-format-gtfs-netex-gtfs-rt-siri-lite),
sous [Licence Ouverte](https://www.etalab.gouv.fr/licence-ouverte-open-licence/). L'annuaire des
stations et des lignes est relu une fois par jour et gardé dans le conteneur ; les passages sont
lus une fois par minute et par station, quel que soit le nombre de lignes suivies.
