import * as G from './generate';
import { OrganisationDetails, ParticipantType } from '../types/organisation';

/** Type acronym: first 3 characters of the participant type, upper-case (MAN, IMP, INS, RET, AGG). */
export const typeAcronym = (type: ParticipantType) => type.slice(0, 3).toUpperCase();

/**
 * Search prefix for automated records of a type, e.g. AUTO-MAN.
 * Legal name = "<prefix> Legal <ABN>" so it carries both type and ABN and is unique.
 */
export const orgPrefix = (type: ParticipantType) => `AUTO-${typeAcronym(type)}`;

const ALL_TYPES: ParticipantType[] = ['manufacturer', 'importer', 'installer', 'retailer', 'aggregator'];

/** ABN of an automated record: the trailing 11 digits of "AUTO-<TYPE> Legal <ABN>". */
export function abnFromLegalName(legalName: string): string {
  const abn = legalName.match(/(\d{11})\s*$/)?.[1];
  if (!abn) throw new Error(`No ABN at the end of legal name "${legalName}"`);
  return abn;
}

/** Participant type encoded in an automated legal name (AUTO-MAN -> manufacturer), or null. */
export function typeFromLegalName(legalName: string): ParticipantType | null {
  const acronym = legalName.match(/^AUTO-([A-Z]{3}) /)?.[1];
  return ALL_TYPES.find(t => typeAcronym(t) === acronym) ?? null;
}

/** Builds a random, valid organisation for a new participant application. */
export function buildOrganisation(type: ParticipantType): OrganisationDetails {
  const prefix = orgPrefix(type);
  const abn = G.getRandomABN();
  const state = G.getRandomState();
  const postcode = G.getRandomPostCode(state);
  const street = G.getRandomStreetAddress();
  const unit = G.getRandomAddressLine2(); // '' most of the time

  return {
    prefix,
    participant_type: type,
    abn,
    legal_name: `${prefix} Legal ${abn}`,
    trading_name: `${prefix} Trading ${abn}`,
    contact_name: `${prefix} Contact ${abn}`,
    email: `AUTO.contact@${abn}.com`,
    phone: G.getRandomMobileNumber(),
    address: street,
    // When a unit exists it goes on line 1 and the street on line 2 (original behaviour)
    address_line_1: unit || street,
    address_line_2: unit ? street : undefined,
    state,
    postcode,
    suburb: G.getRandomSuburb(state, postcode),
  };
}
