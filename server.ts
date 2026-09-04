/**
 * BANK WAR — Server-Authoritative Backend & Multiplayer Engine
 * Express + Vite Middleware with Zero-Trust Regulatory Validation & World Tick
 */

import express, { Request, Response } from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { MONETARY_ZONES_CONFIG } from './src/engine/config/zones';
import { calculatePrudentialRatios, simulateQuarter, generateLoanApplications } from './src/engine/engine';
import { generateInitialAIBanks } from './src/engine/ai_banks';
import {
  AIInstitution,
  InstitutionState,
  MonetaryZoneId,
  InterbankOrder,
} from './src/types';
import { createInitialPlayerState } from './src/engine/storage';
import {
  calculateTargetAICount,
  POPULATION_SOCLE_IA,
  PLANCHER_IA,
  calculateEloDeltaVsAI,
  isAIInstitution,
  filterHumansOnly,
  filterHumanKPIs,
  createNarrativeWithdrawalEvent,
  createNarrativeLicensingEvent,
  NarrativePopulationEvent,
} from './src/engine/ai_filter';
import { GAME_SCENARIOS } from './src/engine/scenarios';
import { SECONDARY_BUYER_PROFILES, calculateSecondarySalePricing } from './src/engine/secondary_market';

const app = express();
const PORT = 3000;

app.use(express.json());

// In-Memory Durable Server State Store (keyed by player UID)
export interface ServerPlayerRecord {
  uid: string;
  email: string;
  displayName: string;
  institutionId: string;
  accountStatus: 'VISITEUR' | 'DIRIGEANT_VERIFIE';
  isVerified: boolean;
  linkedinSub?: string;
  linkedinProfileUrl?: string;
  publicLinkedInOptIn?: boolean;
  isCampusAccount?: boolean;
  campusCode?: string;
  verifiedAt?: string;
}

interface ServerDatabase {
  players: Map<string, ServerPlayerRecord>;
  institutions: Map<string, InstitutionState>; // keyed by player UID
  aiBanks: Map<MonetaryZoneId, AIInstitution[]>;
  narrativeNews: NarrativePopulationEvent[];
  linkedinRegistry: Map<string, { uid: string; verifiedAt: string; profileUrl: string }>; // Anti multi-comptes
  serverConfig: {
    linkedin_requis_des_inscription: boolean; // R5: Paramètre strict d'inscription
  };
  auditLogs: Array<{
    id: string;
    userId: string;
    institutionId: string;
    action: string;
    payload: any;
    regulatoryValidation: {
      isCompliant: boolean;
      usuryRespected: boolean;
      solvencyCompliant: boolean;
      liquidityCompliant: boolean;
      violations: string[];
    };
    timestamp: string;
  }>;
  worldTime: {
    startEpoch: number;
    currentServerQuarter: number;
    currentServerYear: number;
    secondsPerQuarter: number; // 86400s (1 real day = 1 quarter)
    lastTickTimestamp: number;
  };
  sharedMarkets: Map<MonetaryZoneId, {
    creditWindows: Array<{
      id: string;
      borrowerName: string;
      sector: string;
      amount: number;
      rating: string;
      proposedRate: number;
      expiresInSeconds: number;
      isSyndicated: boolean;
    }>;
    interbankOrderBook: InterbankOrder[];
    treasuryAuctions: Array<{
      id: string;
      issuer: string;
      maturity: string;
      totalAmount: number;
      indicativeYield: number;
      zone: string;
    }>;
  }>;
}

const db: ServerDatabase = {
  players: new Map(),
  institutions: new Map(),
  aiBanks: new Map(),
  linkedinRegistry: new Map(),
  serverConfig: {
    linkedin_requis_des_inscription: false, // Défaut : false (R5)
  },
  narrativeNews: [
    {
      type: 'NEW_LICENSE',
      institutionId: 'ai-bank-1',
      institutionName: 'Banque Atlantique & Sahel Fictive',
      zone: 'UEMOA',
      headline: 'INFRASTRUCTURE MARCHÉ : Agrément accordé aux teneurs de marché',
      body: 'La Commission Bancaire a validé le statut de teneur de marché permanent pour les établissements algorithmiques afin d\'assurer la cotation continue de la liquidité interbancaire.',
      date: new Date().toLocaleDateString('fr-FR'),
    },
  ],
  auditLogs: [],
  worldTime: {
    startEpoch: Date.now(),
    currentServerQuarter: 1,
    currentServerYear: 2026,
    secondsPerQuarter: 86400, // 1 real day = 1 quarter
    lastTickTimestamp: Date.now(),
  },
  sharedMarkets: new Map(),
};

// Initialiser les banques IA et marchés partagés pour chaque zone monétaire
const ZONES: MonetaryZoneId[] = ['UEMOA', 'CEMAC', 'AUTRE_AFRIQUE'];
for (const z of ZONES) {
  db.aiBanks.set(z, generateInitialAIBanks(z));
  
  // Fenêtres de cotation partagées
  const sampleCreditWindows = [
    {
      id: `mkt-cred-${z}-1`,
      borrowerName: 'Consortium Portuaire Panafricain',
      sector: 'BTP',
      amount: z === 'UEMOA' ? 5_000_000_000 : 3_500_000_000,
      rating: 'AA',
      proposedRate: 0.082,
      expiresInSeconds: 3600,
      isSyndicated: true,
      isAiMarketMakerQuoted: true,
      aiUnderwriter: 'Banque Atlantique & Sahel [IA]',
    },
    {
      id: `mkt-cred-${z}-2`,
      borrowerName: 'Agro-Exportateur de Noix de Cajou',
      sector: 'AGRO_INDUSTRIE',
      amount: z === 'UEMOA' ? 1_800_000_000 : 1_200_000_000,
      rating: 'A',
      proposedRate: 0.095,
      expiresInSeconds: 5400,
      isSyndicated: false,
      isAiMarketMakerQuoted: true,
      aiUnderwriter: 'Cauris Horizon International [IA]',
    },
    {
      id: `mkt-cred-${z}-3`,
      borrowerName: 'Réseau Distributeur Énergie Solaire',
      sector: 'PME',
      amount: 450_000_000,
      rating: 'BBB',
      proposedRate: 0.115,
      expiresInSeconds: 2700,
      isSyndicated: false,
      isAiMarketMakerQuoted: true,
      aiUnderwriter: 'Union Panafricaine de Financement [IA]',
    },
  ];

  // Carnet d'ordres interbancaire partagé avec étiquetage explicite [IA]
  const sampleOrderBook: InterbankOrder[] = [
    {
      id: `ord-${z}-1`,
      bankId: 'ai-bank-1',
      bankName: 'Banque Atlantique & Sahel',
      side: 'LEND',
      maturity: '1M',
      amount: 2_000_000_000,
      rate: MONETARY_ZONES_CONFIG[z].centralBankPolicyRate + 0.0075,
      isConditional: false,
      timestamp: new Date().toISOString(),
      is_ai: true,
      isAi: true,
    },
    {
      id: `ord-${z}-2`,
      bankId: 'ai-bank-2',
      bankName: 'Cauris Horizon International',
      side: 'BORROW',
      maturity: '1D',
      amount: 1_500_000_000,
      rate: MONETARY_ZONES_CONFIG[z].centralBankPolicyRate + 0.0025,
      isConditional: false,
      timestamp: new Date().toISOString(),
      is_ai: true,
      isAi: true,
    },
  ];

  // Adjudications de titres publics (soumission des IA pour la liquidité)
  const sampleTreasury = [
    {
      id: `tr-${z}-1`,
      issuer: z === 'UEMOA' ? 'Trésor Public de Côte d\'Ivoire' : 'Trésor Public du Cameroun',
      maturity: 'BAT 12 mois',
      totalAmount: 30_000_000_000,
      indicativeYield: 0.063,
      zone: z,
      aiSubscribersCount: 8,
    },
    {
      id: `tr-${z}-2`,
      issuer: z === 'UEMOA' ? 'Trésor Public du Sénégal' : 'Trésor Public du Gabon',
      maturity: 'OAT 3 ans',
      totalAmount: 50_000_000_000,
      indicativeYield: 0.071,
      zone: z,
      aiSubscribersCount: 12,
    },
  ];

  db.sharedMarkets.set(z, {
    creditWindows: sampleCreditWindows,
    interbankOrderBook: sampleOrderBook,
    treasuryAuctions: sampleTreasury,
  });
}

/**
 * RÈGLE 4 : GESTION DYNAMIQUE DE LA POPULATION D'IA
 * Cible = max(POPULATION_SOCLE_IA - activeHumans, PLANCHER_IA)
 * En cas de dépassement : retrait narratif + transfert ordonné des portefeuilles.
 * En cas de déficit : ré-agrément narratif pour soutenir la liquidité.
 */
function maintainAIPopulation(zone: MonetaryZoneId) {
  const aiList = db.aiBanks.get(zone) || [];
  const activeHumansCount = Array.from(db.institutions.values()).filter(
    (inst) => inst.zone === zone && !isAIInstitution(inst)
  ).length;

  const targetAICount = calculateTargetAICount(activeHumansCount);
  const currentActiveAIs = aiList.filter((ai) => ai.activeInMarket !== false);

  if (currentActiveAIs.length > targetAICount) {
    const excessCount = currentActiveAIs.length - targetAICount;
    for (let i = 0; i < excessCount; i++) {
      const aiToWithdraw = currentActiveAIs[currentActiveAIs.length - 1 - i];
      if (!aiToWithdraw) continue;
      aiToWithdraw.activeInMarket = false;
      aiToWithdraw.licenseStatus = 'ACQUIRED_TRANSFERRED';

      const remainingActive = currentActiveAIs.find(
        (ai) => ai.id !== aiToWithdraw.id && ai.activeInMarket !== false
      );
      aiToWithdraw.portfolioTransferredTo = remainingActive?.name || 'Consortium Interbancaire Régional';

      // RÈGLE 4.2 : Événement narratif de retrait
      const withdrawalEvent = createNarrativeWithdrawalEvent(aiToWithdraw, remainingActive);
      db.narrativeNews.unshift(withdrawalEvent);

      // RÈGLE 4.2 : Transfert ordonné du portefeuille (lignes accordées aux joueurs honorées jusqu'à échéance)
      for (const [uid, inst] of db.institutions.entries()) {
        if (inst.zone === zone) {
          let changed = false;
          inst.mfiLinesReceived = inst.mfiLinesReceived.map((line) => {
            if (line.bankId === aiToWithdraw.id && remainingActive) {
              changed = true;
              return {
                ...line,
                bankId: remainingActive.id,
                bankName: `${remainingActive.name} (reprise ordonnée)`,
              };
            }
            return line;
          });
          if (changed) {
            db.institutions.set(uid, inst);
          }
        }
      }
    }
  } else if (currentActiveAIs.length < targetAICount) {
    const deficit = targetAICount - currentActiveAIs.length;
    const inactiveAIs = aiList.filter((ai) => ai.activeInMarket === false);
    for (let i = 0; i < Math.min(deficit, inactiveAIs.length); i++) {
      const aiToActivate = inactiveAIs[i];
      aiToActivate.activeInMarket = true;
      aiToActivate.licenseStatus = 'NEWLY_LICENSED';

      // RÈGLE 4.3 : Événement narratif d'agrément
      const licensingEvent = createNarrativeLicensingEvent(aiToActivate);
      db.narrativeNews.unshift(licensingEvent);
    }
  }
}

// Helper pour extraire le joueur authentifié
function getAuthenticatedUid(req: Request): string {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.split(' ')[1].trim();
  }
  return 'player-default';
}

// ==========================================
// 1. API: HEALTH & STATUT DU MONDE
// ==========================================

// ==========================================
// 1. API: CONFIGURATION GLOBALE & STATUT DU MONDE
// ==========================================

app.get('/api/config', (req: Request, res: Response) => {
  res.json({
    linkedin_requis_des_inscription: db.serverConfig.linkedin_requis_des_inscription,
  });
});

app.post('/api/admin/config', (req: Request, res: Response) => {
  const { passcode, linkedin_requis_des_inscription } = req.body;
  if (passcode !== 'BCEAO2026' && passcode !== 'admin') {
    return res.status(403).json({ success: false, message: 'Code administrateur invalide.' });
  }

  if (typeof linkedin_requis_des_inscription === 'boolean') {
    db.serverConfig.linkedin_requis_des_inscription = linkedin_requis_des_inscription;
    db.auditLogs.push({
      id: `cfg-${Date.now()}`,
      userId: 'ADMIN',
      institutionId: 'SYSTEM',
      action: 'UPDATE_CONFIG_LINKEDIN_MANDATORY',
      payload: { linkedin_requis_des_inscription },
      regulatoryValidation: {
        isCompliant: true,
        usuryRespected: true,
        solvencyCompliant: true,
        liquidityCompliant: true,
        violations: [],
      },
      timestamp: new Date().toISOString(),
    });
  }

  res.json({
    success: true,
    config: db.serverConfig,
  });
});

// ==========================================
// 1.1 API: VÉRIFICATION LINKEDIN OIDC (ANTI MULTI-COMPTES)
// ==========================================

app.post('/api/auth/verify-linkedin', (req: Request, res: Response) => {
  const uid = getAuthenticatedUid(req);
  const { sub, name, picture, profileUrl, useIdentity, publicOptIn } = req.body;

  if (!sub || typeof sub !== 'string') {
    return res.status(400).json({ success: false, message: 'Identifiant OIDC LinkedIn (sub) manquant.' });
  }

  const cleanProfileUrl = (profileUrl || '').trim();

  // RÈGLE 4 : ANTI MULTI-COMPTES
  // Un même identifiant LinkedIn ne peut vérifier qu'un seul compte joueur.
  const existingRecord = db.linkedinRegistry.get(sub);
  if (existingRecord && existingRecord.uid !== uid) {
    // Journaliser la tentative refusée
    db.auditLogs.push({
      id: `log-dup-${Date.now()}`,
      userId: uid,
      institutionId: db.players.get(uid)?.institutionId || 'UNKNOWN',
      action: 'LINKEDIN_DUPLICATE_REJECTED',
      payload: {
        attemptedSub: sub,
        attemptedUid: uid,
        alreadyLinkedUid: existingRecord.uid,
        profileUrl: cleanProfileUrl,
      },
      regulatoryValidation: {
        isCompliant: false,
        usuryRespected: true,
        solvencyCompliant: true,
        liquidityCompliant: true,
        violations: [
          'Anti multi-comptes : Cet identifiant LinkedIn OIDC certifie déjà un autre compte dirigeant.',
        ],
      },
      timestamp: new Date().toISOString(),
    });

    return res.status(409).json({
      success: false,
      code: 'LINKEDIN_ALREADY_LINKED',
      message: 'Ce compte LinkedIn est déjà associé à un autre dirigeant.',
    });
  }

  // RÈGLE 3 & 7 : Stockage minimaliste & mise à jour exclusive serveur
  db.linkedinRegistry.set(sub, {
    uid,
    verifiedAt: new Date().toISOString(),
    profileUrl: cleanProfileUrl,
  });

  let player = db.players.get(uid);
  if (!player) {
    player = {
      uid,
      email: req.body.email || 'dirigeant@bankwar.africa',
      displayName: name || 'Gouverneur',
      institutionId: '',
      accountStatus: 'DIRIGEANT_VERIFIE',
      isVerified: true,
      linkedinSub: sub,
      linkedinProfileUrl: cleanProfileUrl,
      publicLinkedInOptIn: Boolean(publicOptIn),
      verifiedAt: new Date().toISOString(),
    };
    db.players.set(uid, player);
  } else {
    player.accountStatus = 'DIRIGEANT_VERIFIE';
    player.isVerified = true;
    player.linkedinSub = sub;
    player.linkedinProfileUrl = cleanProfileUrl;
    player.publicLinkedInOptIn = Boolean(publicOptIn);
    player.verifiedAt = new Date().toISOString();
    if (useIdentity && name) {
      player.displayName = name;
    }
  }

  // Si l'utilisateur accepte d'utiliser son identité LinkedIn sur l'institution
  const inst = db.institutions.get(uid);
  if (inst && useIdentity && name) {
    inst.ownerName = name;
  }

  // Journalisation d'agrément certifié
  db.auditLogs.push({
    id: `log-verify-${Date.now()}`,
    userId: uid,
    institutionId: inst?.id || 'PENDING',
    action: 'LINKEDIN_VERIFICATION_SUCCESS',
    payload: {
      sub,
      publicOptIn: Boolean(publicOptIn),
      useIdentity: Boolean(useIdentity),
    },
    regulatoryValidation: {
      isCompliant: true,
      usuryRespected: true,
      solvencyCompliant: true,
      liquidityCompliant: true,
      violations: [],
    },
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    accountStatus: 'DIRIGEANT_VERIFIE',
    isVerified: true,
    player,
  });
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', serverTime: new Date().toISOString(), mode: 'SERVER_AUTHORITATIVE' });
});

app.get('/api/world/status', (req: Request, res: Response) => {
  const now = Date.now();
  const elapsedSec = Math.floor((now - db.worldTime.lastTickTimestamp) / 1000);
  const remainingSec = Math.max(0, db.worldTime.secondsPerQuarter - elapsedSec);

  res.json({
    currentServerQuarter: db.worldTime.currentServerQuarter,
    currentServerYear: db.worldTime.currentServerYear,
    realDaysElapsed: Math.floor((now - db.worldTime.startEpoch) / (1000 * 86400)),
    secondsUntilNextQuarter: remainingSec,
    totalActiveInstitutions: db.institutions.size,
    isTickRunning: false,
  });
});

// ==========================================
// 2. API: ÉTAT DU JOUEUR & ONBOARDING KYC
// ==========================================

app.get('/api/game/state', (req: Request, res: Response) => {
  const uid = getAuthenticatedUid(req);
  const institution = db.institutions.get(uid);

  if (!institution) {
    return res.json({ exists: false });
  }

  res.json({
    exists: true,
    institution,
    player: db.players.get(uid),
  });
});

app.post('/api/game/init', (req: Request, res: Response) => {
  const uid = getAuthenticatedUid(req);
  const {
    name,
    country,
    zone,
    type,
    difficulty,
    strategicModel,
    emblem,
    primaryColor,
    accountStatus,
    isCampusAccount,
    campusCode,
  } = req.body;

  if (!name || !country || !zone) {
    return res.status(400).json({ success: false, message: 'Données d\'établissement incomplètes.' });
  }

  // RÈGLE 5 : Vérification du mode strict linkedin_requis_des_inscription
  const existingPlayer = db.players.get(uid);
  const isVerified = existingPlayer?.accountStatus === 'DIRIGEANT_VERIFIE' || accountStatus === 'DIRIGEANT_VERIFIE';
  const isCampus = Boolean(isCampusAccount || campusCode || existingPlayer?.isCampusAccount);

  if (db.serverConfig.linkedin_requis_des_inscription && !isVerified && !isCampus) {
    return res.status(403).json({
      success: false,
      code: 'LINKEDIN_REQUIRED_ON_SIGNUP',
      message: 'Mode strict activé : La connexion LinkedIn est obligatoire dès l\'inscription pour créer un établissement agréé.',
    });
  }

  const newState = createInitialPlayerState(
    name,
    country,
    zone,
    type || 'COMMERCIAL_BANK',
    difficulty || 'DIRECTEUR',
    strategicModel || 'CORPORATE',
    emblem || '🏛️',
    primaryColor || '#f59e0b'
  );

  db.institutions.set(uid, newState);

  const initialStatus = isVerified ? 'DIRIGEANT_VERIFIE' : 'VISITEUR';
  db.players.set(uid, {
    uid,
    email: req.body.email || existingPlayer?.email || 'joueur@bankwar.africa',
    displayName: name,
    institutionId: newState.id,
    accountStatus: initialStatus,
    isVerified: initialStatus === 'DIRIGEANT_VERIFIE',
    linkedinSub: existingPlayer?.linkedinSub,
    linkedinProfileUrl: existingPlayer?.linkedinProfileUrl,
    publicLinkedInOptIn: existingPlayer?.publicLinkedInOptIn || false,
    isCampusAccount: isCampus,
    campusCode: campusCode || existingPlayer?.campusCode,
  });

  // Journal d'audit d'agrément
  db.auditLogs.push({
    id: `log-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
    userId: uid,
    institutionId: newState.id,
    action: 'INIT_INSTITUTION_AGREMENT',
    payload: { name, country, zone, type, accountStatus: initialStatus, isCampus },
    regulatoryValidation: {
      isCompliant: true,
      usuryRespected: true,
      solvencyCompliant: true,
      liquidityCompliant: true,
      violations: [],
    },
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    institution: newState,
    player: db.players.get(uid),
  });
});

// ==========================================
// 3. API: DÉCISION JOUEUR SERVEUR-AUTORITAIRE
// ==========================================

app.post('/api/game/decision', (req: Request, res: Response) => {
  const uid = getAuthenticatedUid(req);
  const inst = db.institutions.get(uid);

  if (!inst) {
    return res.status(404).json({ success: false, message: 'Établissement introuvable pour ce joueur.' });
  }

  const zoneCfg = MONETARY_ZONES_CONFIG[inst.zone];
  const isMfi = inst.type === 'MICROFINANCE';
  const usuryCeiling = isMfi ? zoneCfg.usuryRateMfi : zoneCfg.usuryRateBank;
  const equity = inst.balanceSheet.tier1Capital + inst.balanceSheet.retainedEarnings;

  const { type, loanId, customRate, interbankOrder, termDepositRate, refinanceAmount, mfiLine, publicBondBid } = req.body;

  const violations: string[] = [];

  // 1. Validation de la décision selon la réglementation
  if (type === 'APPROVE_LOAN') {
    const loanApp = inst.pendingLoanApplications.find((l) => l.id === loanId);
    if (!loanApp) {
      return res.status(400).json({ success: false, message: 'Dossier de crédit introuvable.' });
    }

    const effectiveRate = customRate !== undefined ? customRate : loanApp.proposedRate;

    // Règle d'usure obligatoire (§2 & R6)
    if (effectiveRate > usuryCeiling) {
      violations.push(
        `Violation du Taux d'Usure : ${((effectiveRate * 100).toFixed(2))}% dépasse le plafond réglementaire de ${((usuryCeiling * 100).toFixed(2))}% en zone ${inst.zone}.`
      );
    }

    // Division des risques (max 25% des fonds propres sur une seule signature)
    if (loanApp.amount > equity * 0.25) {
      violations.push(
        `Dépassement de la division des risques : le montant (${(loanApp.amount / 1e9).toFixed(1)} Mds) excède 25% de vos fonds propres (${(equity * 0.25 / 1e9).toFixed(1)} Mds). Syndication requise.`
      );
    }

    // Disponibilité de liquidité
    if (inst.balanceSheet.cashAndEquivalents < loanApp.amount * 0.5) {
      violations.push('Liquidité immédiate insuffisante pour décaisser le crédit sans rupture LCR.');
    }

    if (violations.length > 0) {
      return res.status(422).json({
        success: false,
        message: 'Décision rejetée par l\'autorité de conformité serveur.',
        regulatoryValidation: {
          isCompliant: false,
          usuryRespected: effectiveRate <= usuryCeiling,
          solvencyCompliant: loanApp.amount <= equity * 0.25,
          liquidityCompliant: false,
          violations,
        },
      });
    }

    // Exécution autoritaire
    inst.pendingLoanApplications = inst.pendingLoanApplications.filter((l) => l.id !== loanId);
    inst.activeLoans.push({
      id: `loan-exec-${Date.now()}`,
      borrowerName: loanApp.borrowerName,
      sector: loanApp.sector,
      principal: loanApp.amount,
      remainingPrincipal: loanApp.amount,
      interestRate: effectiveRate,
      remainingQuarters: Math.max(2, Math.round(loanApp.durationMonths / 3)),
      rating: loanApp.rating,
      collateralValue: loanApp.collateralValue,
      isSolidarityGroup: loanApp.isSolidarityGroup,
      isSyndicated: false,
      syndicateShare: 1.0,
      daysInArrears: 0,
      isImpaired: false,
      provisionAmount: 0,
    });

    inst.balanceSheet.clientLoans += loanApp.amount;
    inst.balanceSheet.cashAndEquivalents -= loanApp.amount * 0.8; // décaissement net
    inst.prudentialRatios = calculatePrudentialRatios(inst.balanceSheet, inst.activeLoans, zoneCfg, isMfi);
  } else if (type === 'REJECT_LOAN') {
    inst.pendingLoanApplications = inst.pendingLoanApplications.filter((l) => l.id !== loanId);
  } else if (type === 'CENTRAL_BANK_REFINANCE') {
    // Interdiction stricte aux Microfinances (R6)
    if (isMfi) {
      return res.status(403).json({
        success: false,
        message: 'Violation prudentielle : les institutions de microfinance (SFD) n\'ont pas accès au refinancement de la Banque Centrale.',
        regulatoryValidation: {
          isCompliant: false,
          usuryRespected: true,
          solvencyCompliant: true,
          liquidityCompliant: false,
          violations: ['Microfinance sans accès Banque Centrale'],
        },
      });
    }

    const amount = Number(refinanceAmount || 0);
    inst.balanceSheet.centralBankRefinancing += amount;
    inst.balanceSheet.cashAndEquivalents += amount;
    inst.prudentialRatios = calculatePrudentialRatios(inst.balanceSheet, inst.activeLoans, zoneCfg, isMfi);
  } else if (type === 'INTERBANK_ORDER') {
    if (interbankOrder) {
      inst.activeInterbankOrders.push(interbankOrder);
      // Ajouter également au carnet d'ordres partagé de la zone
      const mkt = db.sharedMarkets.get(inst.zone);
      if (mkt) {
        mkt.interbankOrderBook.unshift(interbankOrder);
      }
    }
  } else if (type === 'CAPITAL_RAISE') {
    const requestedAmount = Number(req.body.amount || 0);
    if (requestedAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Montant de levée de fonds invalide.' });
    }

    const currentRep = inst.shareholderReputation ?? 70;
    const raisesThisYear = inst.capitalRaisesThisYear ?? 0;
    const lossYears = inst.consecutiveLossYears ?? 0;
    const dividendYears = inst.consecutiveDividendYears ?? 0;
    const inAdmin = inst.isInProvisionalAdministration;

    // Règle prudentielle : Maximum 1 levée par an hors administration provisoire
    if (raisesThisYear >= 1 && !inAdmin) {
      return res.status(422).json({
        success: false,
        message: 'Plafond réglementaire atteint : Maximum 1 augmentation de capital par année simulée (sauf levée d\'urgence imposée sous administration provisoire).',
        regulatoryValidation: {
          isCompliant: false,
          usuryRespected: true,
          solvencyCompliant: false,
          liquidityCompliant: true,
          violations: ['Maximum 1 levée de capital par an'],
        },
      });
    }

    // Capacité maximale selon réputation et historique financier
    const baseCap = Math.max(5_000_000_000, (inst.balanceSheet.tier1Capital + inst.balanceSheet.retainedEarnings) * 0.40);
    let maxRaiseAmount = baseCap * (currentRep / 100);
    if (lossYears > 0) {
      maxRaiseAmount *= Math.max(0.30, Math.pow(0.70, lossYears));
    }
    if (inAdmin) {
      maxRaiseAmount = Math.max(maxRaiseAmount, 10_000_000_000);
    }

    if (requestedAmount > maxRaiseAmount && !inAdmin) {
      return res.status(422).json({
        success: false,
        message: `Montant excessif : Au vu de votre réputation actionnaire (${currentRep}/100)${lossYears > 0 ? ` et de vos ${lossYears} an(s) de pertes consécutives` : ''}, vos actionnaires refusent de souscrire plus de ${(maxRaiseAmount / 1e9).toFixed(2)} Mds ${zoneCfg.currencyCode}.`,
        regulatoryValidation: {
          isCompliant: false,
          usuryRespected: true,
          solvencyCompliant: false,
          liquidityCompliant: true,
          violations: ['Plafond de souscription actionnaire dépassé'],
        },
      });
    }

    // Coût et dilution :
    // - Après dividendes réguliers : frais réduits (~2%)
    // - Après pertes : forte prime de risque et décote exigée par les investisseurs (10% à 25%)
    // - Sous administration provisoire : décote punitive de crise (30%)
    let costRate = 0.03;
    if (inAdmin) {
      costRate = 0.30;
    } else if (lossYears > 0) {
      costRate = Math.min(0.25, 0.06 + (lossYears * 0.08) + ((100 - currentRep) / 400));
    } else if (dividendYears > 0) {
      costRate = Math.max(0.015, 0.04 - (dividendYears * 0.01));
    } else {
      costRate = Math.max(0.03, (100 - currentRep) / 1000);
    }

    const netCashInjected = requestedAmount * (1 - costRate);
    const issuanceFees = requestedAmount * costRate;

    // Fonds propres immédiatement augmentés
    inst.balanceSheet.tier1Capital += requestedAmount;
    inst.balanceSheet.cashAndEquivalents += netCashInjected;
    inst.balanceSheet.retainedEarnings -= issuanceFees; // Frais d'émission

    // Réputation actionnaire diminuée proportionnellement au montant levé (dilution)
    const equityBefore = Math.max(1, inst.balanceSheet.tier1Capital + inst.balanceSheet.retainedEarnings - requestedAmount);
    const dilutionDrop = Math.max(3, Math.round((requestedAmount / equityBefore) * 25));
    inst.shareholderReputation = Math.max(5, currentRep - dilutionDrop);
    inst.capitalRaisesThisYear = raisesThisYear + 1;

    // Levée de l'administration provisoire si solvabilité restaurée
    if (inAdmin) {
      const pRatiosPreview = calculatePrudentialRatios(inst.balanceSheet, inst.activeLoans, zoneCfg, isMfi);
      const minSolv = isMfi ? zoneCfg.minSolvencyRatioMfi : zoneCfg.minSolvencyRatioBank;
      if (pRatiosPreview.solvencyRatio >= minSolv) {
        inst.isInProvisionalAdministration = false;
        inst.provisionalAdminQuarterLeft = 0;
      }
    }

    inst.prudentialRatios = calculatePrudentialRatios(inst.balanceSheet, inst.activeLoans, zoneCfg, isMfi);
  } else if (type === 'SELL_LOAN_SECONDARY_MARKET') {
    const { loanId, buyerId } = req.body;
    const loanIndex = inst.activeLoans.findIndex((l) => l.id === loanId);
    if (loanIndex === -1) {
      return res.status(404).json({ success: false, message: 'Créance introuvable dans votre portefeuille actif.' });
    }

    const buyer = SECONDARY_BUYER_PROFILES.find((b) => b.id === buyerId) || SECONDARY_BUYER_PROFILES[0];
    const loan = inst.activeLoans[loanIndex];
    const pricing = calculateSecondarySalePricing(loan, buyer, zoneCfg.riskWeights);

    if (!pricing.isEligible) {
      return res.status(422).json({
        success: false,
        message: pricing.ineligibilityReason || 'Opération refusée par l\'acheteur.',
      });
    }

    const rwaBefore = inst.prudentialRatios.rwaTotal || 1;

    // Retrait de la créance du bilan
    inst.activeLoans.splice(loanIndex, 1);
    inst.balanceSheet.clientLoans = Math.max(0, inst.balanceSheet.clientLoans - pricing.grossPrincipal);
    inst.balanceSheet.provisionsForImpairedLoans = Math.max(0, inst.balanceSheet.provisionsForImpairedLoans - pricing.provisions);
    inst.balanceSheet.cashAndEquivalents += pricing.cashReceived;
    inst.balanceSheet.retainedEarnings += pricing.gainOrLoss;

    // Recalcul du RWA et des ratios
    inst.prudentialRatios = calculatePrudentialRatios(inst.balanceSheet, inst.activeLoans, zoneCfg, isMfi);
    const rwaAfter = inst.prudentialRatios.rwaTotal || 1;
    const rwaRelievedReal = Math.max(0, rwaBefore - rwaAfter);

    return res.json({
      success: true,
      message: `Cession réussie auprès de ${buyer.name} : +${(pricing.cashReceived / 1e9).toFixed(2)} Mds encaissés, RWA allégé de ${(rwaRelievedReal / 1e9).toFixed(2)} Mds.`,
      pricing,
      rwaRelievedReal,
      institutionState: inst,
    });
  }

  // Journal d'audit Append-Only
  const auditId = `audit-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  db.auditLogs.push({
    id: auditId,
    userId: uid,
    institutionId: inst.id,
    action: type,
    payload: req.body,
    regulatoryValidation: {
      isCompliant: true,
      usuryRespected: true,
      solvencyCompliant: true,
      liquidityCompliant: true,
      violations: [],
    },
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    message: 'Décision validée par le moteur prudentiel serveur et journalisée.',
    auditLogId: auditId,
    institutionState: inst,
    regulatoryValidation: {
      isCompliant: true,
      usuryRespected: true,
      solvencyCompliant: true,
      liquidityCompliant: true,
      violations: [],
    },
  });
});

// ==========================================
// 4. API: TICK DU MONDE SERVEUR-AUTORITAIRE
// ==========================================

app.post('/api/game/tick', (req: Request, res: Response) => {
  const uid = getAuthenticatedUid(req);
  const inst = db.institutions.get(uid);

  if (!inst) {
    return res.status(404).json({ success: false, message: 'Établissement introuvable.' });
  }

  const decisions = req.body || {};
  const seed = Date.now();

  // Exécution du moteur de simulation serveur pour l'établissement du joueur
  const simResult = simulateQuarter(inst, decisions, seed);
  db.institutions.set(uid, simResult.nextState);

  // Maintenance de la population d'IA dans la zone selon le nombre d'humains actifs
  maintainAIPopulation(inst.zone);

  // Exécution du tick pour les banques IA de la zone
  const aiList = db.aiBanks.get(inst.zone) || [];
  const updatedAIs = aiList.map((ai) => {
    const deltaElo = Math.floor((Math.random() - 0.48) * 15);
    return {
      ...ai,
      eloRating: Math.max(800, ai.eloRating + deltaElo),
      balanceSheet: {
        ...ai.balanceSheet,
        cashAndEquivalents: ai.balanceSheet.cashAndEquivalents * 1.02,
      },
    };
  });

  // RÈGLE 5 : Détection et exécution des instruments de scénarios pilotant les IA
  if (decisions.injectedScenarioId) {
    const scenario = GAME_SCENARIOS.find((s) => s.id === decisions.injectedScenarioId);
    if (scenario && scenario.acteurs_ia && scenario.acteurs_ia.length > 0) {
      for (const actor of scenario.acteurs_ia) {
        const targetAIs = updatedAIs.filter((ai) => {
          if (actor.target_id) return ai.id === actor.target_id;
          if (actor.target_type === 'BANK') return ai.type === 'COMMERCIAL_BANK';
          if (actor.target_type === 'MFI') return ai.type === 'MICROFINANCE';
          return true;
        });

        for (const ai of targetAIs) {
          if (actor.strategy_override === 'RUEE_DEPOTS') {
            ai.balanceSheet.demandDeposits *= 0.65;
            ai.ratios.lcrLiquidityRatio = 0.55;
            simResult.eventsLog.push(
              `[CONTAGION MARCHÉ IA] Ruée sur les dépôts chez ${ai.name} [IA] (-35% DAV). Fuite vers la qualité et tension sur les taux interbancaires.`
            );
          } else if (actor.strategy_override === 'AGRESSIVE_PRIX') {
            ai.strategy = 'AGRESSIVE';
            simResult.eventsLog.push(
              `[GUERRE DES PRIX IA] ${ai.name} [IA] casse ses taux de crédit de 250 bps. Pression concurrentielle sur les marges du trimestre.`
            );
          } else if (actor.strategy_override === 'DEFAUT_LIGNE') {
            ai.ratios.par90 = 0.14;
            simResult.eventsLog.push(
              `[DÉFAUT IA SUR LIGNE] La microfinance ${ai.name} [IA] franchit le seuil critique de PAR90 (14%). Déclenchement du covenant en conditions réelles.`
            );
          }
        }
      }
    }
  }

  db.aiBanks.set(inst.zone, updatedAIs);

  // Mettre à jour l'horloge du monde
  db.worldTime.currentServerQuarter = simResult.nextState.currentQuarter;
  db.worldTime.currentServerYear = simResult.nextState.currentYear;
  db.worldTime.lastTickTimestamp = Date.now();

  // Renouveler les dossiers de crédit en attente (nouvelles opportunités trimestrielles)
  const isMfi = simResult.nextState.type === 'MICROFINANCE';
  simResult.nextState.pendingLoanApplications = generateLoanApplications(
    inst.zone,
    isMfi,
    simResult.nextState.currentQuarter,
    seed + 42
  );

  // Log d'arrêté trimestriel
  db.auditLogs.push({
    id: `audit-tick-${Date.now()}`,
    userId: uid,
    institutionId: inst.id,
    action: 'QUARTER_TICK_EXECUTION',
    payload: {
      quarter: simResult.nextState.currentQuarter,
      year: simResult.nextState.currentYear,
      solvencyRatio: simResult.nextState.prudentialRatios.solvencyRatio,
      netIncome: simResult.incomeStatement.netIncome,
    },
    regulatoryValidation: {
      isCompliant: simResult.nextState.prudentialRatios.isCompliant,
      usuryRespected: true,
      solvencyCompliant: simResult.nextState.prudentialRatios.solvencyRatio >= (isMfi ? 0.15 : 0.115),
      liquidityCompliant: simResult.nextState.prudentialRatios.lcrLiquidityRatio >= 1.0,
      violations: simResult.eventsLog,
    },
    timestamp: new Date().toISOString(),
  });

  res.json({
    success: true,
    nextState: simResult.nextState,
    incomeStatement: simResult.incomeStatement,
    eventsLog: simResult.eventsLog,
    aiInstitutions: updatedAIs,
  });
});

// ==========================================
// 5. API: MARCHÉS PARTAGÉS TEMPS RÉEL
// ==========================================

app.get('/api/markets/live', (req: Request, res: Response) => {
  const zone = (req.query.zone as MonetaryZoneId) || 'UEMOA';
  maintainAIPopulation(zone);
  const mkt = db.sharedMarkets.get(zone);
  const zoneCfg = MONETARY_ZONES_CONFIG[zone];

  if (!mkt) {
    return res.status(404).json({ message: 'Zone inconnue' });
  }

  const zoneNews = db.narrativeNews.filter((n) => n.zone === zone || !n.zone);

  res.json({
    zone,
    policyRate: zoneCfg.centralBankPolicyRate,
    usuryRateBank: zoneCfg.usuryRateBank,
    usuryRateMfi: zoneCfg.usuryRateMfi,
    creditWindows: mkt.creditWindows,
    orderBook: mkt.interbankOrderBook,
    treasuryAuctions: mkt.treasuryAuctions,
    narrativeNews: zoneNews.slice(0, 5),
  });
});

// ==========================================
// 6. API: LIVE RANKINGS PARTAGÉ (RÈGLE 3 : 100% Humain par défaut)
// ==========================================

app.get('/api/rankings/live', (req: Request, res: Response) => {
  const zone = (req.query.zone as MonetaryZoneId) || 'UEMOA';
  const view = (req.query.view as string) || 'humans'; // RÈGLE 3.1 : Par défaut 'humans'
  maintainAIPopulation(zone);

  const aiList = db.aiBanks.get(zone) || [];

  // Rassembler tous les établissements réels humains de cette zone
  const humanList: Array<{
    id: string;
    name: string;
    country: string;
    type: string;
    isHuman: boolean;
    is_ai: false;
    isAi: false;
    ownerName: string;
    eloRating: number;
    solvencyRatio: number;
    netBankingIncome: number;
    nplRatio: number;
    accountStatus: 'VISITEUR' | 'DIRIGEANT_VERIFIE';
    isVerified: boolean;
    isCampusAccount: boolean;
    campusCode?: string;
    publicLinkedInOptIn: boolean;
    linkedinProfileUrl?: string;
  }> = [];

  for (const [uid, inst] of db.institutions.entries()) {
    if (inst.zone === zone && !isAIInstitution(inst)) {
      const p = db.players.get(uid);
      const isVerified = p?.accountStatus === 'DIRIGEANT_VERIFIE' || p?.isVerified === true;
      const isCampus = Boolean(p?.isCampusAccount);

      humanList.push({
        id: inst.id,
        name: inst.name,
        country: inst.country,
        type: inst.type,
        isHuman: true,
        is_ai: false,
        isAi: false,
        ownerName: p?.displayName || 'Gouverneur Humain',
        eloRating: inst.eloRating,
        solvencyRatio: inst.prudentialRatios.solvencyRatio,
        netBankingIncome: inst.lastIncomeStatement.netBankingIncome,
        nplRatio: inst.prudentialRatios.nplRatio,
        accountStatus: p?.accountStatus || 'VISITEUR',
        isVerified,
        isCampusAccount: isCampus,
        campusCode: p?.campusCode,
        publicLinkedInOptIn: Boolean(p?.publicLinkedInOptIn),
        linkedinProfileUrl: p?.publicLinkedInOptIn ? p?.linkedinProfileUrl : undefined,
      });
    }
  }

  // Filtrage Mode Campus (R6) : Tournoi de classe interne
  if (view === 'campus') {
    const campusCode = req.query.campusCode as string | undefined;
    const campusList = humanList.filter(
      (h) => h.isCampusAccount && (!campusCode || h.campusCode === campusCode)
    );
    campusList.sort((a, b) => b.eloRating - a.eloRating);

    return res.json({
      zone,
      season: 1,
      viewMode: 'CAMPUS_ONLY',
      campusCode: campusCode || 'TOUS_CAMPUS',
      totalCampus: campusList.length,
      leaderboard: campusList.map((item, idx) => ({ ...item, rank: idx + 1 })),
    });
  }

  // RÈGLE 2 & 6 : Dans le Live Ranking Global officiel UEMOA/CEMAC,
  // seuls les DIRIGEANTS VÉRIFIÉS (ou affichés avec badge officiel) sont classés
  humanList.sort((a, b) => b.eloRating - a.eloRating);

  // Vue 'humans' : Live Ranking Officiel
  if (view === 'humans') {
    const leaderboardWithRank = humanList.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));

    return res.json({
      zone,
      season: 1,
      viewMode: 'HUMANS_ONLY',
      totalHumans: humanList.length,
      totalVerified: humanList.filter((h) => h.isVerified).length,
      leaderboard: leaderboardWithRank,
    });
  }

  // Vue Secondaire : « Marché complet » (avec IA étiquetées [IA])
  const activeAIs = aiList.filter((ai) => ai.activeInMarket !== false);
  const allInstitutions = [
    ...humanList,
    ...activeAIs.map((ai) => ({
      id: ai.id,
      name: ai.name,
      country: ai.country,
      type: ai.type,
      isHuman: false,
      is_ai: true as const,
      isAi: true as const,
      ownerName: 'Infrastructure IA (Teneur de marché)',
      eloRating: ai.eloRating,
      solvencyRatio: ai.ratios.solvencyRatio,
      netBankingIncome: (ai.balanceSheet.clientLoans * 0.08) / 4,
      nplRatio: ai.ratios.nplRatio,
    })),
  ];

  allInstitutions.sort((a, b) => b.eloRating - a.eloRating);

  const leaderboardWithRank = allInstitutions.map((item, index) => ({
    ...item,
    rank: index + 1,
  }));

  res.json({
    zone,
    season: 1,
    viewMode: 'ALL_MARKET',
    totalHumans: humanList.length,
    totalAI: activeAIs.length,
    leaderboard: leaderboardWithRank,
  });
});

// ==========================================
// 7. API: FIL D'ACTUALITÉS & DÉPÊCHES DE MARCHÉ (RÈGLE 4)
// ==========================================

app.get('/api/news/live', (req: Request, res: Response) => {
  const zone = req.query.zone as MonetaryZoneId | undefined;
  const filtered = zone ? db.narrativeNews.filter((n) => n.zone === zone || !n.zone) : db.narrativeNews;
  res.json({
    success: true,
    news: filtered,
  });
});

// ==========================================
// 8. API: KPI BUSINESS SANS AUCUNE IA (RÈGLE 6.2)
// ==========================================

app.get('/api/admin/metrics', (req: Request, res: Response) => {
  const allInst = Array.from(db.institutions.values());
  const activePlayersList = allInst.map((i) => ({ id: i.id, is_ai: isAIInstitution(i) }));
  
  const humanCount = activePlayersList.filter((p) => !isAIInstitution(p)).length;

  const kpis = filterHumanKPIs({
    totalAccounts: humanCount,
    dau: Math.min(humanCount, 15),
    wau: Math.min(humanCount, 35),
    mau: Math.min(humanCount, 85),
    activePlayersList,
  });

  res.json({
    success: true,
    kpis,
    aiExcludedCount: activePlayersList.filter((p) => isAIInstitution(p)).length,
    policy: 'RÈGLE 6.2 : Strict 0% IA dans les métriques business et monétisation',
  });
});

// ==========================================
// 9. API: JOURNAL D'AUDIT APPEND-ONLY
// ==========================================

app.get('/api/audit/journal', (req: Request, res: Response) => {
  const uid = getAuthenticatedUid(req);
  const logs = db.auditLogs.filter((l) => l.userId === uid);
  res.json({ logs });
});

// ==========================================
// 8. VITE MIDDLEWARE (Dev & Prod Handling)
// ==========================================

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`BANK WAR Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
