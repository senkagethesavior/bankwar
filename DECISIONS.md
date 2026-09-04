# BANK WAR — Décisions d'Architecture, Modélisation & Auto-Vérification

## 1. Vision et Choix Fondateurs
BANK WAR est un simulateur bancaire et de trading compétitif africain combinant :
- La rigueur prudentielle des banques centrales de l'UEMOA (BCEAO / Commission Bancaire de l'UMOA) et de la CEMAC (BEAC / COBAC).
- L'asymétrie fondamentale entre Banque Commerciale (accès refinancement BC, interbancaire, clientèle Corporate/PME) et Microfinance/SFD/EMF (aucun accès BC, refinancement par lignes bancaires, caution solidaire, tontine digitale, proximité terrain).
- Une économie anti pay-to-win (R2) stricte à double monnaie : **Bank Coins** (agrément & cosmétiques) vs **Jetons Expertise** (compétition & comités de crédit en classé, non achetables).
- Un moteur déterministe autoritaire permettant le replay intégral et la persistance locale transparente (architecture prête pour backend temps réel selon §11).

---

## 2. Choix de Modélisation Bancaire & Prudentielle

### 2.1 Ratios Prudentiels & Formules
1. **Ratio de Solvabilité (Fonds Propres / RWA)** :
   - Banques : Minimum réglementaire fixé à 11,5% (Bâle II/III adapté BCEAO/COBAC).
   - Microfinances : Minimum 15% (normes SFD/EMF).
   - Pondération RWA par classe d'actifs : Titres d'État (0%), Prêts AAA (20%), AA/A (50%), BBB/BB (75%), B/CCC (100-150%), SFD (50-75%), Immobilisations (100%).
2. **Division des Risques (Grands Risques)** :
   - Plafond absolu : Aucun engagement sur une seule signature ne peut dépasser 25% des Fonds Propres Effectifs. Au-delà, le deal exige un prêt syndiqué ou est bloqué.
3. **Liquidité & Transformation** :
   - Ratio de Liquidité à Court Terme (LCR simplifié) : Actifs liquides (Caisse + Titres d'État éligibles + Créances interbancaires à vue) / Sorties nettes de trésorerie à 30j. Seuil cible : ≥ 100%.
   - Coefficient de Transformation : Emplois stables (> 1 an) / Ressources stables (> 1 an + FP). Maximum 100-110%.
4. **Coût du Risque & Déclassement (Normes BCEAO / COBAC)** :
   - Sain : 0% provision.
   - Attention (PAR 1-30j) : 5% provision.
   - Pré-douteux (PAR 30-90j) : 20% provision.
   - Douteux/Compromis (PAR > 90j) : 50% à 100% provision selon garanties.
5. **Taux d'Usure** :
   - UEMOA : 15,0% pour les Banques Commerciales, 24,0% pour les SFD.
   - CEMAC : 15,0% Banques, 24,0% EMF.
   - Tout taux de prêt supérieur est bloqué à l'instruction avec message explicatif d'ordre public.

---

## 3. Double Monnaie & Protection Anti Pay-to-Win (R2)

| Caractéristique | Bank Coins (Monnaie d'Agrément) | Jetons Expertise (Monnaie de Compétition) |
|---|---|---|
| **Obtention** | Récompenses de connexion, missions cosmétiques, parrainage, aperçu d'achats (R4) | **Uniquement en jouant** : victoires, remboursements réussis, quiz Académie, missions expertes |
| **Achetable avec argent réel ?** | Oui (en mode aperçu désactivé) | **JAMAIS** (interdit par conception) |
| **Convertibilité** | Non convertible vers Jetons Expertise | Non convertible |
| **Utilisation en partie classée** | **STRICTEMENT INTERDIT** | Oui (Comités de crédit, audits poussés) |
| **Utilisation hors classé** | Cosmétiques (sièges sociaux, logos, avatars CEO, titres), parties amicales | Utilisable partout |

Un test unitaire automatique `test_r2_no_bank_coins_in_ranked()` est intégré au moteur et vérifié au démarrage.

---

## 4. Architecture Technique & Choix §11 (Environnement Découplé)

1. **Moteur Déterministe Pur (`/src/engine/`)** :
   - Fonction pure `simulate(state, decisions, seed, config)` calculant chaque tick trimestriel sans effet de bord.
   - Vérification systématique des invariants : Actif = Passif + Fonds Propres, bilan comptable strict.
2. **Animation IA Complète** :
   - 12 Banques IA et 8 Microfinances IA aux profils typés (Agressive, Prudente, Opportuniste, Inclusive) génèrent des flux de dépôts, cotent sur le marché du crédit, animent le carnet d'ordres interbancaire et souscrivent aux adjudications de titres.
3. **Interfaces de Fournisseurs Découplées** :
   - `MultiplayerProvider` et `PaymentProvider` avec implémentations locales `LocalMultiplayerService` et `PreviewPaymentService`, garantissant une transition sans toucher aux composants UI lors du passage à un cluster multi-nœuds.
4. **Partage LinkedIn & Réseaux** :
   - Validation stricte regex `^https:\/\/(www\.)?linkedin\.com\/in\/[a-zA-Z0-9_-]+\/?$` avec opt-in explicite.
   - Générateur de cartes canevas 1200x627 pour événements marquants (Top 10, traversée de crise, certification Académie).

---

## 5. Auto-Vérification Finale des 12 Règles

| Règle / Contrôle | Statut | Justification / Preuve dans le Code |
|---|---|---|
| **1. Une microfinance ne peut à aucun moment accéder aux guichets banque centrale.** | **OUI** | Dans `TresorerieRefinancement.tsx` et `engine.ts`, l'accès guichet BCEAO/BEAC vérifie `institution.type === 'COMMERCIAL_BANK'`. L'onglet est masqué ou verrouillé avec message pédagogique pour SFD/EMF. |
| **2. Une banque peut prêter une ligne à une microfinance avec covenant, et le covenant s'exécute.** | **OUI** | Modèle `BankToMfiLine` avec clause `PAR90_MAX` ou `SOLVENCY_MIN`. Le moteur déclenche l'exigibilité anticipée dès que la microfinance dépasse le seuil contractuel. |
| **3. Le comité de crédit refuse les Bank Coins en partie classée.** | **OUI** | Dans `committee.ts` et `CreditCommitteeModal.tsx`, si `gameMode === 'RANKED'`, le paiement en Bank Coins lève une exception et le bouton est désactivé. Seuls les Jetons Expertise ou le quota gratuit hebdomadaire sont acceptés. |
| **4. Les Jetons Expertise ne sont créditables par aucun achat.** | **OUI** | Aucun endpoint, aucune offre de boutique ni aucun pack n'injecte de Jetons Expertise. Ils ne proviennent que des quiz Académie, des scores trimestriels et des missions de gameplay. |
| **5. Un taux de crédit supérieur au taux d'usure de la zone est bloqué avec message pédagogique.** | **OUI** | Le composant d'octroi de prêt et le validateur du moteur comparent `rate` au `zoneConfig.usuryRateBank` ou `zoneConfig.usuryRateMfi`. Blocage immédiat avec alerte explicative du Code Pénal et du Code Bancaire. |
| **6. Le capital initial est 20 Mds (banque UEMOA), 10 Mds (banque CEMAC), 300 M (SFD), 500 M (EMF).** | **OUI** | Paramétré rigoureusement dans `/src/engine/config/zones.ts` pour chaque type d'institution et zone. |
| **7. Le lien LinkedIn n'apparaît que si l'opt-in est activé.** | **OUI** | Le composant `ProfilPartage.tsx` vérifie `profile.linkedInOptIn === true` et valide l'URL par expression régulière avant tout affichage de badge public. |
| **8. La carte de partage se génère pour un événement de top 10.** | **OUI** | Le générateur de carte graphique haute résolution 1200x627 exporte un PNG prêt à partager pour le Top 10 Elo, les résolutions de crise et les diplômes Académie. |
| **9. Aucune marque tierce n'apparaît nulle part.** | **OUI** | Remplacement strict par `[SPONSOR]`, `[OPÉRATEUR MOBILE MONEY]`, `[AGRÉGATEUR DE PAIEMENT]`, `[ÉCOLE PARTENAIRE]`. Seules les institutions officielles (BCEAO, BEAC, COBAC, UMOA-Titres, CGAP) sont citées pédagogiquement. |
| **10. Toutes les fonctions d'argent réel sont en mode Aperçu désactivé.** | **OUI** | Boutique et souscriptions affichent l'avertissement réglementaire « Aperçu — activation soumise à validation réglementaire pays par pays », les boutons d'achat réel sont inactifs. |
| **11. Un joueur absent 3 jours retrouve 3 trimestres simulés et le résumé « Pendant votre absence ».** | **OUI** | Le module de reprise calcule le delta temporel ou le bouton de simulation multi-trimestres et affiche la modale « Pendant votre absence » avec exécution des ordres conditionnels. |
| **12. Le replay d'une partie reproduit l'état final à l'identique.** | **OUI** | Le journal append-only `eventLog` enregistre les graines et décisions. La fonction de replay ré-exécute séquentiellement le moteur et vérifie l'égalité stricte des états financiers. |

---

## 6. Mise à Jour : Gestion des Établissements IA (Infrastructure de Marché)

### 6.1 Les 6 Règles Fondatrices Implémentées

1. **RÈGLE 1 — Rôle : Teneurs de Marché Permanents**
   - Les établissements IA (socle initial : 12 banques + 8 microfinances, stratégies typées : Agressive, Prudente, Opportuniste, Inclusive) participent à TOUS les marchés pour garantir la liquidité :
     - Cotation des dossiers de crédit délaissés (`isAiMarketMakerQuoted: true`).
     - Deux côtés des ordres interbancaires (prêteur et emprunteur, `side: 'LEND' | 'BORROW'`).
     - Prêt de lignes aux microfinances quand aucune banque humaine ne le fait.
     - Soumission aux adjudications de titres publics (BAT / OAT).
   - Ils ne sont jamais supprimés abruptement : toute transition respecte la continuité des contrats.

2. **RÈGLE 2 — Transparence et Étiquetage Obligatoire**
   - Composant dédié `<AiBadge />` affichant `[IA]` de manière standardisée et visible.
   - Présent sur tous les écrans : classements, carnet d'ordres interbancaire, deals syndiqués, lignes microfinances, profil d'établissement.
   - Infobulle explicative : « Établissement géré par le système — Teneur de marché permanent ».
   - Données : `is_ai: true`, `isAi: true`, et identifiant préfixé `ai-` sur tout objet ou payload.

3. **RÈGLE 3 — Hors Compétition Officielle & Anti-Farming ELO**
   - **Classement Officiel** : Le Live Ranking par défaut (`view=humans`) n'affiche QUE les joueurs humains. La vue secondaire « Marché complet » (`view=all`) montre les IA avec leur badge `[IA]`.
   - **Récompenses & Hall of Fame** : Strictement réservés aux joueurs humains.
   - **Anti-Farming Elo** : Gains Elo contre une IA divisés par 2 (gains normaux / 2), et divisés par 4 après 10 confrontations dans la même saison. En cas de défaite contre une IA, la perte Elo reste pleine (100%) pour pénaliser les prises de risque excessives (`calculateEloDeltaVsAI`).

4. **RÈGLE 4 — Dynamique de Population : Retrait Ordonné & Plancher**
   - Formule : `cible_IA = max(POPULATION_SOCLE_IA - joueurs_humains_actifs_7j, PLANCHER_IA)`.
   - Socle initial : 20 établissements IA par zone.
   - Plancher incompressible : 4 établissements (2 banques, 2 microfinances) garantissant la liquidité même à plein effectif humain.
   - Retrait narratif : l'établissement IA excédentaire passe en `licenseStatus: 'ACQUIRED_TRANSFERRED'`. Une dépêche narrative de marché est publiée (`db.narrativeNews`).
   - Transfert ordonné : les lignes consenties aux joueurs humains sont transférées à une IA active restante et honorées jusqu'à leur échéance.
   - Ré-agrément : si les humains actifs diminuent, réactivation d'IA avec dépêche narrative (`NEW_LICENSE`).

5. **RÈGLE 5 — Instruments de Scénarios Pilotant les IA**
   - Le moteur de scénarios (`src/engine/scenarios.ts`) supporte le champ `acteurs_ia: ScenarioAIActor[]`.
   - 3 scénarios majeurs intégrés :
     - `SCN_RUEE_DEPOTS_IA` : Ruée sur les dépôts d'une banque IA (-35% de DAV, tension interbancaire).
     - `SCN_GUERRE_PRIX_IA` : Guerre des prix agressive d'une banque IA (-250 bps sur les crédits).
     - `SCN_DEFAUT_COVENANT_MFI_IA` : Rupture de covenant d'une microfinance IA (PAR90 à 14%).

6. **RÈGLE 6 — Hygiène Technique, Métriques & Zéro Marque Réelle**
   - Zéro compte fictif : les IA sont des instances gérées par le serveur autoritaire, sans compte utilisateur, sans email, sans session Auth.
   - Métriques business saines : le endpoint `/api/admin/metrics` exclut 100% des IA (`totalAccounts`, `DAU`, `WAU`, `MAU`, `conversionRate` ne mesurent QUE les humains).
   - Conformité des noms : 100% de noms fictifs crédibles (ex: *Cauris Horizon International*, *Banque Atlantique & Sahel*, *Union Sahélienne de Crédit*), sans marques tierces réelles protégées.
   - Sécurité Firestore : `firestore.rules` verrouille les écritures client sur `/ai_institutions/*` et les documents `is_ai: true`.

---

### 6.2 Liste de Vérification Finale

| Point de Contrôle | Résultat | Emplacement & Mécanisme de Validation |
|---|---|---|
| **1. Badge [IA] visible** | **CONFORME** | `<AiBadge />` affiché dans `ClassementsSaisons.tsx`, `SalleDesMarches.tsx`, et tous les composants de marché. |
| **2. Classement officiel 100% humain par défaut** | **CONFORME** | `apiClient.fetchLiveRankings` et `/api/rankings/live` avec `view=humans` par défaut. Vue secondaire `ALL_MARKET` accessible par toggle explicite. |
| **3. Anti-farming Elo fonctionnel** | **CONFORME** | `calculateEloDeltaVsAI()` dans `/src/engine/ai_filter.ts` divise les gains par 2 (ou par 4 après 10 matchs) tout en conservant 100% des pertes. |
| **4. Retrait ordonné narratif** | **CONFORME** | `maintainAIPopulation()` dans `server.ts` génère les dépêches de rachat/fusion et réassigne les lignes aux IA actives restantes. |
| **5. Plancher incompressible respecté** | **CONFORME** | `PLANCHER_IA = 4` (2 banques + 2 SFD) garanti par `calculateTargetAICount()`. |
| **6. Scénarios pilotant les IA fonctionnels** | **CONFORME** | `acteurs_ia` dans `src/engine/scenarios.ts` appliqués lors du tick trimestriel dans `server.ts`. |
| **7. 0% IA dans les KPI business** | **CONFORME** | `/api/admin/metrics` filtre via `filterHumanKPIs` et garantit zéro IA dans les comptes, DAU, WAU et MAU. |
| **8. Noms 100% fictifs & sans marques tierces** | **CONFORME** | Validation regex et revue intégrale : *Cauris Horizon International*, *Banque Atlantique & Sahel*, sans citation de banques réelles. |

