import pvDevices from '../data/pv.imported.device.json';
import pvDevicesUnused from '../data/pv.imported.device.unused.json';
import { PVDevice } from './pv-device';

/**
 * Real-world PV module data. The app's PV module rules (a best guess by the
 * developers) only accept some cell technologies, so the data is split:
 *   pv.imported.device.json         - devices the form can accept (used by tests)
 *   pv.imported.device.unused.json  - devices with no matching cell_technology option
 */
const devices = pvDevices as PVDevice[];
const unused = pvDevicesUnused as PVDevice[];

export function getAllPVDevices(): PVDevice[] {
    return devices;
}

export function getUnusedPVDevices(): PVDevice[] {
    return unused;
}
