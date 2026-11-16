/** Values of the "Participant type" dropdown on the application form. */
export type ParticipantType = 'manufacturer' | 'importer' | 'installer' | 'retailer' | 'aggregator';

export interface OrganisationDetails {
  prefix: string;            // search prefix, e.g. AUTO-MAN
  legal_name: string;
  trading_name?: string;
  abn: string;
  participant_type: ParticipantType;
  contact_name: string;
  email: string;
  phone: string;
  address: string;           // street address
  address_line_1: string;
  address_line_2?: string;
  suburb: string;
  postcode: string;
  state: string;
}

export interface SystemIdentifiers {
  cer_id: string;
  cer_lastupdated: string;
  cer_version: string;
  application_status: string;
}

/** Values read back from the CER application review screen. */
export interface ApplicationIdentifiers {
  legalName: string;
  address: string | null;
  applicationId: string | null;
  participantId: string | null;
}
