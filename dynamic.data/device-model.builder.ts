import { buildPvModel, randomPrefix } from './pv-model.builder';
import { SeedDevice, SeedDeviceType, seedDevicesOfType, retailers, RetailerProfile } from '../utils/other-devices';

/**
 * Device classes (values of the "Device class" dropdown) and their class
 * attributes as defined by the rules in force (captured 2026-11-14):
 *   battery            v2: chemistry (LFP|NMC|LTO|NCA), vpp_capable (true|false),
 *                          capacity_kwh (0.5-500), nominal_voltage_v (12-1500)
 *   ev_revolt_charger  v1: no attributes (JSON {})
 *   inverter           v1: hybrid (true|false), phases (1|3), rated_power_kw (0.1-5000)
 *   pv_module          v1: rated_power_w (50-1000), cell_technology (mono_perc|topcon|hjt|thin_film)
 *
 * Seed data:
 *   pv_module                 <- data/pv.imported.device.json
 *   battery / inverter / EV   <- data/other.device.manufacturer.json
 *     deviceType PV_battery | EV_battery -> battery, inverter -> inverter,
 *     ev_revolt_charger -> ev_revolt_charger
 * Attributes not present in the seed data are derived from the device name
 * (e.g. "LiFePO4" -> LFP, "11kWh" -> 11) or given realistic defaults.
 * Model numbers are decorated with a random AUTO-xxxxx prefix (unique per manufacturer).
 */
export const DEVICE_CLASSES = ['battery', 'ev_revolt_charger', 'inverter', 'pv_module'] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export interface DeviceModel {
  deviceClass: DeviceClass;
  modelNumber: string;
  modelName: string;
  /** Class attribute name -> value, as entered in the form */
  attributes: Record<string, string | number>;
  /** Seed data type, e.g. PV_battery / EV_battery */
  seedType?: string;
  source?: unknown;
}

export const CLASS_OF_SEED_TYPE: Record<SeedDeviceType, DeviceClass> = {
  PV_battery: 'battery',
  EV_battery: 'battery',
  inverter: 'inverter',
  ev_revolt_charger: 'ev_revolt_charger',
};

const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));
const within = (v: number | undefined, min: number, max: number) => (v !== undefined && v >= min && v <= max ? v : undefined);

function batteryAttributes(d: SeedDevice): Record<string, string | number> {
  const text = `${d.deviceName} ${d.deviceId}`;
  const chemistry = /LiFePO4|LFP/i.test(text) ? 'LFP' : /LTO/i.test(text) ? 'LTO' : /NCMA|NMC|NCM/i.test(text) ? 'NMC' : /NCA/i.test(text) ? 'NCA' : 'LFP';
  const kwh = within(num(text.match(/(\d+(?:\.\d+)?)\s?kWh/i)?.[1]), 0.5, 500)
    ?? within(num(d.deviceId.match(/(\d+(?:\.\d+)?)$/)?.[1]), 0.5, 500)
    ?? (d.deviceType === 'EV_battery' ? 75 : 10);
  const hv = d.deviceType === 'EV_battery' || /High Voltage/i.test(text);
  return { chemistry, vpp_capable: d.deviceType === 'PV_battery' ? 'true' : 'false', capacity_kwh: kwh, nominal_voltage_v: hv ? 400 : 51.2 };
}

function inverterAttributes(d: SeedDevice): Record<string, string | number> {
  const text = `${d.deviceName} ${d.deviceId}`;
  const micro = /Microinverter/i.test(text);
  const kw = micro ? 0.3
    : within(num(text.match(/(\d+(?:\.\d+)?)\s?kW/i)?.[1]), 0.1, 5000)
      // last number in the ID, e.g. FRN-GEN24-10.0 -> 10.0 (not 24)
      ?? within(num(d.deviceId.match(/(\d+(?:\.\d+)?)(?!.*\d)/)?.[1]), 0.1, 5000) ?? 10;
  const phases = /Three-Phase|Tripower|3SE/i.test(text) ? '3' : '1';
  return { hybrid: /Hybrid/i.test(text) ? 'true' : 'false', phases, rated_power_kw: kw };
}

/** Builds a model from a seed device (battery / inverter / EV charger). */
export function modelFromSeed(d: SeedDevice): DeviceModel {
  const deviceClass = CLASS_OF_SEED_TYPE[d.deviceType];
  const attributes = deviceClass === 'battery' ? batteryAttributes(d)
    : deviceClass === 'inverter' ? inverterAttributes(d) : {};
  return {
    deviceClass, seedType: d.deviceType,
    modelNumber: `${randomPrefix()}-${d.deviceId}`, modelName: d.deviceName,
    attributes, source: d,
  };
}

/** A random model of the given seed device type. */
export function buildModelOfSeedType(type: SeedDeviceType): DeviceModel {
  return modelFromSeed(pick(seedDevicesOfType(type)));
}

/** A random model of the given device class. */
export function buildDeviceModel(deviceClass: DeviceClass): DeviceModel {
  if (deviceClass === 'pv_module') {
    const pv = buildPvModel();
    return {
      deviceClass, seedType: 'pv_module', modelNumber: pv.modelNumber, modelName: pv.modelName,
      attributes: { rated_power_w: pv.ratedPowerW, cell_technology: pv.cellTechnology }, source: pv.source,
    };
  }
  const types = (Object.keys(CLASS_OF_SEED_TYPE) as SeedDeviceType[]).filter(t => CLASS_OF_SEED_TYPE[t] === deviceClass);
  return buildModelOfSeedType(pick(types));
}

/** A random retailer profile and one model per device type it sells. */
export function buildRetailerRange(): { profile: RetailerProfile; models: DeviceModel[] } {
  const profile = pick(retailers);
  return { profile, models: profile.deviceTypesSold.map(buildModelOfSeedType) };
}
