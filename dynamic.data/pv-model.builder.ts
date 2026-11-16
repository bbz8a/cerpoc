import { getAllPVDevices, getUnusedPVDevices } from '../utils/pv-devices';
import { PVDevice } from '../utils/pv-device';

/** cell_technology options on the PV module rules (v1) */
export type CellTechnology = 'mono_perc' | 'topcon' | 'hjt' | 'thin_film';

/**
 * Maps data/pv.imported.device.json cellTechnology -> form option.
 * Devices with no option in PV module rules v1 (HPBC, HPDC, N-Type Bycium+,
 * N-Type Q.ANTUM) live in data/pv.imported.device.unused.json.
 */
const CELL_TECH: Record<string, CellTechnology> = {
  'Mono PERC': 'mono_perc',
  'N-Type TOPCon': 'topcon',
  'HJT': 'hjt',
  'Thin Film CdTe': 'thin_film',
};

export interface PvModel {
  deviceClass: 'pv_module';
  modelNumber: string;      // decorated, unique per run
  modelName: string;
  ratedPowerW: number;
  cellTechnology: CellTechnology;
  source: PVDevice;         // original JSON row
}

/** Random, upper-case decoration so a reused JSON device is unique per manufacturer. */
export function randomPrefix(): string {
  return `AUTO-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/** Defensive filter - the main data file should only hold mappable devices. */
export function mappableDevices(): PVDevice[] {
  return getAllPVDevices().filter(d => d.cellTechnology in CELL_TECH);
}

/** Cell technologies excluded because the form has no option for them (data/rules gap). */
export function unmappableCellTechnologies(): string[] {
  return [...new Set(getUnusedPVDevices().map(d => d.cellTechnology))];
}

/** Picks a random mappable device from the JSON and decorates its model number with a random prefix. */
export function buildPvModel(): PvModel {
  const pool = mappableDevices();
  const d = pool[Math.floor(Math.random() * pool.length)];
  return {
    deviceClass: 'pv_module',
    modelNumber: `${randomPrefix()}-${d.modelNumber}`,
    modelName: d.modelName,
    ratedPowerW: d.ratedOutputAtSTC,
    cellTechnology: CELL_TECH[d.cellTechnology],
    source: d,
  };
}
