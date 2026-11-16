import fs from 'fs';
import path from 'path';
import { test } from '@playwright/test';

/**
 * Local cache of SUCCESSFUL transactions, one file per environment:
 *   data/cache/<host>.ledger.json   (git-ignored - describes one sandbox's state)
 *
 * Append-only events; fields are deliberately loose so they can change as the
 * application changes. Statuses are the application's own (e.g. pending,
 * approved). Later tests query the cache to pick their inputs, e.g. "an
 * approved manufacturer that has an approved PV model".
 *
 * Record ONLY after the application has confirmed success.
 */

export type LedgerEventName =
  | 'account.registered'    // email, displayName, status=pending_verification (no abn)
  | 'application.created'   // name, abn, type, status=pending
  | 'application.approved'  // abn, status=approved
  | 'model.requested'       // deviceId, abn, deviceClass, metadata, status=pending
  | 'model.approved'        // deviceId, abn, deviceClass, status=approved
  | 'unit.acquired'         // future: deviceId, abn, serialNumber, location
  | 'unit.installed'        // future: deviceId, abn, serialNumber, newLocation
  | 'unit.transferred'      // deviceId, serialNumber, participant = new owner
  | 'unit.corrected'        // deviceId, serialNumber (history correction appended)
  | 'user.invited'          // username, participant, role (participant self-service)
  | 'user.updated'          // username, participant, status = role / disabled
  | 'incident.raised'       // incidentId, unitId/modelId, participant = reporter, status=open
  | 'incident.status'       // incidentId, status = new status (CER)
  | 'recall.raised'         // recallId, modelId, batches / withdrawModel, status=open
  | 'recall.closed';        // recallId, status=closed

export interface LedgerEvent {
  at: string;
  event: LedgerEventName;
  status: string;
  /** participant/device events; absent for account events */
  abn?: string;
  [field: string]: unknown;
}

interface LedgerFile {
  environment: string;
  events: LedgerEvent[];
}

const CACHE_DIR = path.resolve(__dirname, '..', 'data', 'cache');

export function ledgerPath(): string {
  const host = new URL(process.env.BASE_URL ?? 'http://unknown').host.replace(/[^a-z0-9.-]/gi, '_');
  return path.join(CACHE_DIR, `${host}.ledger.json`);
}

function load(): LedgerFile {
  const file = ledgerPath();
  if (!fs.existsSync(file)) return { environment: process.env.BASE_URL ?? '', events: [] };
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Appends a successful transaction (tests run serially, so read-modify-write is safe). */
export function record(event: Omit<LedgerEvent, 'at'>): LedgerEvent {
  const ledger = load();
  let source: string | undefined;
  try { source = test.info().title; } catch { /* outside a test */ }
  const entry = { at: new Date().toISOString(), ...event, ...(source ? { source } : {}) } as LedgerEvent;
  ledger.events.push(entry);
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(ledgerPath(), JSON.stringify(ledger, null, 2) + '\n');
  try { test.info().annotations.push({ type: 'recorded', description: `${entry.event} ${entry.abn ?? entry.recallId ?? entry.incidentId ?? entry.username ?? entry.deviceId ?? entry.email ?? ''} ${entry.status}` }); } catch { /* outside a test */ }
  return entry;
}

export function events(name?: LedgerEventName): LedgerEvent[] {
  const all = load().events;
  return name ? all.filter(e => e.event === name) : all;
}

export interface CachedParticipant { abn: string; legalName: string; type: string; approvedAt: string }

/** Approved participants (latest first), optionally of one type. */
export function approvedParticipants(type?: string): CachedParticipant[] {
  const created = new Map(events('application.created').map(e => [String(e.abn), e]));
  return events('application.approved')
    .map(e => {
      const c = created.get(String(e.abn));
      return { abn: String(e.abn), legalName: String(e.legalName ?? c?.legalName ?? ''), type: String(e.type ?? c?.type ?? ''), approvedAt: e.at };
    })
    .filter(p => p.legalName && (!type || p.type === type))
    .reverse();
}

export interface CachedModel { deviceId: string; abn: string; deviceClass: string; modelNumber: string; approvedAt: string }

/** Approved device models (latest first), optionally filtered by ABN and/or class. */
export function approvedModels(filter: { abn?: string; deviceClass?: string } = {}): CachedModel[] {
  return events('model.approved')
    .filter(e => (!filter.abn || e.abn === filter.abn) && (!filter.deviceClass || e.deviceClass === filter.deviceClass))
    .map(e => ({ deviceId: String(e.deviceId), abn: String(e.abn), deviceClass: String(e.deviceClass), modelNumber: String(e.modelNumber ?? ''), approvedAt: e.at }))
    .reverse();
}

/** ABN -> device classes with approved models. */
export function participantsWithDevices(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const m of approvedModels()) {
    if (!map.has(m.abn)) map.set(m.abn, new Set());
    map.get(m.abn)!.add(m.deviceClass);
  }
  return map;
}
