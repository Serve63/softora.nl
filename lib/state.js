'use strict';

/**
 * lib/state.js — Gedeelde in-memory runtime state.
 *
 * Arrays, Maps en Sets worden geëxporteerd als live referenties.
 * Wijzigingen (push, set, delete) zijn zichtbaar voor iedereen die dit module importeert.
 *
 * Let-variabelen (primitieven zoals supabaseStateHydrated) zitten nog in server.js
 * en worden daar direct beheerd.
 */

// --- Coldcalling / webhook events ---
const recentWebhookEvents = [];
const recentCallUpdates = [];
const callUpdatesById = new Map();
const retellCallStatusRefreshByCallId = new Map();

// --- AI call insights ---
const recentAiCallInsights = [];
const aiCallInsightsByCallId = new Map();
const aiAnalysisFingerprintByCallId = new Map();
const aiAnalysisInFlightCallIds = new Set();

// --- Dashboard & audit ---
const recentDashboardActivities = [];
const recentSecurityAuditEvents = [];

// --- UI state ---
const inMemoryUiStateByScope = new Map();

// --- Agenda & appointments ---
const generatedAgendaAppointments = [];
const agendaAppointmentIdByCallId = new Map();

// --- Leads ---
const dismissedInterestedLeadCallIds = new Set();
const dismissedInterestedLeadKeys = new Set();
const leadOwnerAssignmentsByCallId = new Map();

// --- Sequential dispatch queues ---
const sequentialDispatchQueues = new Map();
const sequentialDispatchQueueIdByCallId = new Map();

module.exports = {
  recentWebhookEvents,
  recentCallUpdates,
  callUpdatesById,
  retellCallStatusRefreshByCallId,
  recentAiCallInsights,
  aiCallInsightsByCallId,
  aiAnalysisFingerprintByCallId,
  aiAnalysisInFlightCallIds,
  recentDashboardActivities,
  recentSecurityAuditEvents,
  inMemoryUiStateByScope,
  generatedAgendaAppointments,
  agendaAppointmentIdByCallId,
  dismissedInterestedLeadCallIds,
  dismissedInterestedLeadKeys,
  leadOwnerAssignmentsByCallId,
  sequentialDispatchQueues,
  sequentialDispatchQueueIdByCallId,
};
