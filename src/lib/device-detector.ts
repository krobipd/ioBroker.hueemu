/**
 * Device Detector Service
 * Uses @iobroker/type-detector to automatically detect device types
 * and map them to Hue light types
 */

import ChannelDetector, { Types, type DetectorState } from '@iobroker/type-detector';
import type { Logger } from '../types/config';

/**
 * Hue light type identifiers
 */
export type HueLightType = 'onoff' | 'dimmable' | 'ct' | 'color';

/**
 * Detected device result
 */
export interface DetectedDevice {
    /** Detected Hue light type */
    lightType: HueLightType;
    /** Human-readable type name */
    typeName: string;
    /** Detected state mappings */
    states: {
        on?: string;
        bri?: string;
        ct?: string;
        hue?: string;
        sat?: string;
        xy?: string;
    };
    /** Original type-detector type */
    originalType: string;
    /** Device name from ioBroker */
    name?: string;
}

/**
 * Adapter interface for device detection
 */
export interface DetectorAdapter {
    getObjectAsync(id: string): Promise<ioBroker.Object | null | undefined>;
    getForeignObjectsAsync(pattern: string, type?: ioBroker.ObjectType): Promise<Record<string, ioBroker.Object>>;
    getEnumsAsync(enumName?: string): Promise<Record<string, ioBroker.EnumObject>>;
}

/**
 * Type-detector types that map to lights
 */
const LIGHT_TYPES: Types[] = [
    Types.light,
    Types.dimmer,
    Types.ct,
    Types.rgb,
    Types.rgbSingle,
    Types.rgbwSingle,
    Types.hue,
    Types.cie,
    Types.socket
];

/**
 * Maps type-detector types to Hue light types
 */
const TYPE_TO_HUE: Record<string, HueLightType> = {
    [Types.rgb]: 'color',
    [Types.rgbSingle]: 'color',
    [Types.rgbwSingle]: 'color',
    [Types.hue]: 'color',
    [Types.cie]: 'color',
    [Types.ct]: 'ct',
    [Types.dimmer]: 'dimmable',
    [Types.light]: 'dimmable',
    [Types.socket]: 'onoff'
};

/**
 * Human-readable type names
 */
const TYPE_NAMES: Record<HueLightType, string> = {
    'onoff': 'On/Off Light',
    'dimmable': 'Dimmable Light',
    'ct': 'Color Temperature Light',
    'color': 'Extended Color Light'
};

/**
 * Device Detector class
 */
export class DeviceDetector {
    private readonly adapter: DetectorAdapter;
    private readonly logger?: Logger;
    private detector: ChannelDetector;

    constructor(adapter: DetectorAdapter, logger?: Logger) {
        this.adapter = adapter;
        this.logger = logger;
        this.detector = new ChannelDetector();
    }

    /**
     * Detect device type and states from an ioBroker object ID
     */
    async detect(objectId: string): Promise<DetectedDevice | null> {
        this.log('debug', `Detecting device for: ${objectId}`);

        try {
            // Get the object and its parent structure
            const baseObj = await this.adapter.getObjectAsync(objectId);
            if (!baseObj) {
                this.log('warn', `Object not found: ${objectId}`);
                return null;
            }

            // Determine the search root (device or channel)
            const searchRoot = this.getSearchRoot(objectId, baseObj);
            this.log('debug', `Search root: ${searchRoot}`);

            // Get all objects under the search root
            const objects = await this.adapter.getForeignObjectsAsync(`${searchRoot}.*`);

            // Add the root object itself
            objects[searchRoot] = baseObj;

            // Also get the parent if it's a state
            if (baseObj.type === 'state') {
                const parentId = objectId.substring(0, objectId.lastIndexOf('.'));
                const parentObj = await this.adapter.getObjectAsync(parentId);
                if (parentObj) {
                    objects[parentId] = parentObj;
                }
            }

            // Detect the device type
            const detected = this.detector.detect({
                id: searchRoot,
                objects,
                _keysOptional: Object.keys(objects),
                _usedIdsOptional: [],
                ignoreIndicators: ['UNREACH_STICKY', 'STICKY_UNREACH', 'LOWBAT'],
                allowedTypes: LIGHT_TYPES
            });

            if (!detected || detected.length === 0) {
                this.log('debug', `No light device detected for: ${objectId}`);
                return null;
            }

            // Use the first (most complex) detection
            const device = detected[0];
            this.log('info', `Detected type: ${device.type} for ${objectId}`);

            // Map to Hue light type
            const hueLightType = TYPE_TO_HUE[device.type] || 'onoff';

            // Extract state mappings
            const states = this.extractStates(device.states as DetectorState[]);

            // Get device name
            const name = baseObj.common?.name;
            const deviceName = typeof name === 'object' ? name.en || Object.values(name)[0] : name;

            return {
                lightType: hueLightType,
                typeName: TYPE_NAMES[hueLightType],
                states,
                originalType: device.type,
                name: deviceName as string | undefined
            };

        } catch (error) {
            this.log('error', `Detection failed for ${objectId}: ${error}`);
            return null;
        }
    }

    /**
     * Get all detectable devices from a room or function enum
     */
    async detectFromEnum(enumId: string): Promise<DetectedDevice[]> {
        this.log('debug', `Detecting devices from enum: ${enumId}`);
        const results: DetectedDevice[] = [];

        try {
            const enumObj = await this.adapter.getObjectAsync(enumId) as ioBroker.EnumObject | null;
            if (!enumObj?.common?.members) {
                return results;
            }

            for (const memberId of enumObj.common.members) {
                const detected = await this.detect(memberId);
                if (detected) {
                    results.push(detected);
                }
            }
        } catch (error) {
            this.log('error', `Enum detection failed: ${error}`);
        }

        return results;
    }

    /**
     * Get the search root for detection
     */
    private getSearchRoot(objectId: string, obj: ioBroker.Object): string {
        // If it's already a device or channel, use it
        if (obj.type === 'device' || obj.type === 'channel') {
            return objectId;
        }

        // For states, go up to parent channel/device
        if (obj.type === 'state') {
            const parts = objectId.split('.');
            if (parts.length > 3) {
                // Try parent
                return parts.slice(0, -1).join('.');
            }
        }

        return objectId;
    }

    /**
     * Extract Hue-compatible states from detected states
     */
    private extractStates(states: DetectorState[]): DetectedDevice['states'] {
        const result: DetectedDevice['states'] = {};

        for (const state of states) {
            const id = state.id;
            const name = state.name;

            if (!id) continue;

            // Map type-detector state names to Hue states
            switch (name) {
                case 'ON':
                case 'SET':
                case 'POWER':
                    if (!result.on) result.on = id;
                    break;
                case 'DIMMER':
                case 'BRIGHTNESS':
                case 'LEVEL':
                    if (!result.bri) result.bri = id;
                    break;
                case 'TEMPERATURE':
                case 'COLOR_TEMP':
                    if (!result.ct) result.ct = id;
                    break;
                case 'HUE':
                    if (!result.hue) result.hue = id;
                    break;
                case 'SATURATION':
                    if (!result.sat) result.sat = id;
                    break;
                case 'CIE':
                case 'XY':
                    if (!result.xy) result.xy = id;
                    break;
                // RGB will be handled specially if needed
                case 'RGB':
                    // For RGB, we might need to convert - store as xy placeholder
                    if (!result.xy && !result.hue) {
                        result.xy = id;
                    }
                    break;
            }
        }

        return result;
    }

    /**
     * Log a message
     */
    private log(level: 'debug' | 'info' | 'warn' | 'error', message: string): void {
        if (this.logger) {
            this.logger[level](`[DeviceDetector] ${message}`);
        }
    }
}

/**
 * Get rooms from ioBroker
 */
export async function getRooms(adapter: DetectorAdapter): Promise<Array<{ value: string; label: string }>> {
    const enums = await adapter.getEnumsAsync('rooms');
    const rooms: Array<{ value: string; label: string }> = [];

    for (const [id, obj] of Object.entries(enums)) {
        if (obj?.common?.name) {
            const name = obj.common.name;
            const label = typeof name === 'object' ? name.en || Object.values(name)[0] : name;
            rooms.push({ value: id, label: label as string });
        }
    }

    return rooms.sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Get functions from ioBroker
 */
export async function getFunctions(adapter: DetectorAdapter): Promise<Array<{ value: string; label: string }>> {
    const enums = await adapter.getEnumsAsync('functions');
    const functions: Array<{ value: string; label: string }> = [];

    for (const [id, obj] of Object.entries(enums)) {
        if (obj?.common?.name) {
            const name = obj.common.name;
            const label = typeof name === 'object' ? name.en || Object.values(name)[0] : name;
            functions.push({ value: id, label: label as string });
        }
    }

    return functions.sort((a, b) => a.label.localeCompare(b.label));
}
