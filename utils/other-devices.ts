import manufacturerDevices from '../data/other.device.manufacturer.json';
import retailerProfiles from '../data/other.device.retailer.json';

/**
 * Real-world device and retailer seed data (basis of device metadata).
 * Business legal names / ABNs used in the app are always AUTO-generated -
 * the manufacturer/retailer names here are reference only.
 */
export type SeedDeviceType = 'PV_battery' | 'EV_battery' | 'ev_revolt_charger' | 'inverter';

export interface SeedDevice {
  manufacturer: string;
  businessAddress: string;
  deviceType: SeedDeviceType;
  deviceId: string;
  deviceName: string;
  countryOfOrigin: string;
}

export interface RetailerProfile {
  retailerName: string;
  supplierType: string;
  businessAddress: string;
  website: string;
  deviceTypesSold: SeedDeviceType[];
  notableBrandsStocked: string[];
}

export const seedDevices = manufacturerDevices as SeedDevice[];
export const retailers = retailerProfiles as RetailerProfile[];

export function seedDevicesOfType(type: SeedDeviceType): SeedDevice[] {
  return seedDevices.filter(d => d.deviceType === type);
}
