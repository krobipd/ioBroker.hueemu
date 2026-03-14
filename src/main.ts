/**
 * ioBroker Hue Emulator Adapter
 * Emulates a Philips Hue Bridge for smart home integrations
 */

import * as utils from '@iobroker/adapter-core';
import * as uuid from 'uuid';
import * as forge from 'node-forge';

import { HueEmuDefinition } from './definition/hue-emu-definition';
import { HueServer } from './server';
import { HueSsdpServer } from './discovery';
import { ApiHandler, type DeviceConfig } from './hue-api';
import type { HueEmulatorConfig, BridgeIdentity, TlsConfig, Logger } from './types/config';
import { generateBridgeId, generateSerialNumber } from './types/config';

// Augment the adapter.config object with the actual types
declare global {
     
    namespace ioBroker {
        interface AdapterConfig {
            host: string;
            port: number;
            discoveryHost: string;
            discoveryPort: number;
            httpsPort: number | undefined;
            udn: string;
            mac: string;
            upnpPort: number | undefined;
            devices: DeviceConfig[];
            [key: string]: any;
        }
    }
}

/**
 * Hue Emulator Adapter
 */
export class HueEmu extends utils.Adapter {
    private pairingTimeoutId: ReturnType<typeof setTimeout> | null = null;
    private _pairingEnabled = false;
    private _disableAuth = false;

    private definition: HueEmuDefinition;
    private hueServer: HueServer | null = null;
    private ssdpServer: HueSsdpServer | null = null;
    private apiHandler: ApiHandler | null = null;

    public constructor(options: Partial<utils.AdapterOptions> = {}) {
        super({
            ...options,
            name: 'hueemu',
        });

        this.on('ready', this.onReady.bind(this));
        this.on('objectChange', this.onObjectChange.bind(this));
        this.on('stateChange', this.onStateChange.bind(this));
        this.on('message', this.onMessage.bind(this));
        this.on('unload', this.onUnload.bind(this));

        this.definition = new HueEmuDefinition(this);
    }

    get pairingEnabled(): boolean {
        return this._pairingEnabled;
    }

    set pairingEnabled(value: boolean) {
        this._pairingEnabled = value;
        this.setState('startPairing', { ack: true, val: value });
    }

    get disableAuth(): boolean {
        return this._disableAuth;
    }

    set disableAuth(value: boolean) {
        this._disableAuth = value;
        this.setState('disableAuth', { ack: true, val: value });
    }

    /**
     * Called when databases are connected and adapter received configuration
     */
    private async onReady(): Promise<void> {
        this.log.silly('onReady called. Loading configuration');

        try {
            // Parse and validate configuration
            const emulatorConfig = await this.buildConfig();

            // Create logger adapter
            const logger = this.createLogger();

            // Get device configurations from admin UI
            const devices: DeviceConfig[] = this.config.devices || [];
            this.log.info(`Loaded ${devices.length} device(s) from configuration`);

            // Initialize SSDP discovery server
            this.ssdpServer = new HueSsdpServer({
                identity: emulatorConfig.identity,
                host: emulatorConfig.discoveryHost || emulatorConfig.host,
                port: emulatorConfig.discoveryPort || emulatorConfig.port,
                ssdpPort: emulatorConfig.upnpPort,
                logger
            });

            // Create API handler with device configurations
            this.apiHandler = new ApiHandler({
                adapter: this as any,
                configServiceConfig: {
                    identity: emulatorConfig.identity,
                    discoveryHost: emulatorConfig.discoveryHost || emulatorConfig.host,
                    logger
                },
                devices,
                logger
            });

            // Initialize API handler (sets up state subscriptions for device bindings)
            await this.apiHandler.initialize();

            // Initialize HTTP server
            this.hueServer = new HueServer({
                config: emulatorConfig,
                handler: this.apiHandler,
                logger
            });

            // Start servers
            await this.ssdpServer.start();
            await this.hueServer.start();

            // Initialize adapter states
            await this.initializeAdapterStates();

            // Subscribe to state changes (own states)
            this.subscribeStates('*');

            // Log device info
            if (devices.length > 0) {
                this.log.info('Configured devices:');
                devices.forEach((device, index) => {
                    const mappedStates: string[] = [];
                    if (device.onState) mappedStates.push('on');
                    if (device.briState) mappedStates.push('bri');
                    if (device.ctState) mappedStates.push('ct');
                    if (device.hueState) mappedStates.push('hue');
                    if (device.satState) mappedStates.push('sat');
                    if (device.xyState) mappedStates.push('xy');
                    this.log.info(`  ${index + 1}. ${device.name} (${device.lightType}) - mapped: ${mappedStates.join(', ') || 'none'}`);
                });
            }

            this.log.info('Hue Emulator started successfully');

        } catch (error) {
            this.log.error(`Failed to start Hue Emulator: ${error}`);
        }
    }

    /**
     * Build emulator configuration from adapter config
     */
    private async buildConfig(): Promise<HueEmulatorConfig> {
        // Parse configuration values
        const host = this.config.host?.trim() || '';
        const port = this.toPort(this.config.port);
        const discoveryHost = this.config.discoveryHost?.trim() || host;
        const discoveryPort = this.toPort(this.config.discoveryPort) || port;
        const httpsPort = this.toUndefinedPort(this.config.httpsPort);
        const udn = this.config.udn?.trim() || uuid.v4();
        const mac = this.config.mac?.trim() || '';
        const upnpPort = this.toDefaultPort(this.config.upnpPort, 1900);

        // Build bridge identity
        const identity: BridgeIdentity = {
            udn,
            mac,
            bridgeId: generateBridgeId(mac),
            modelId: 'BSB002',
            serialNumber: generateSerialNumber(mac)
        };

        // Build TLS config if HTTPS is enabled
        let https: TlsConfig | undefined;
        if (httpsPort) {
            const cert = await this.generateCertificate();
            https = {
                port: httpsPort,
                cert: cert.certificate,
                key: cert.privateKey
            };
        }

        return {
            host,
            port,
            discoveryHost,
            discoveryPort,
            https,
            upnpPort,
            identity
        };
    }

    /**
     * Generate a self-signed certificate for HTTPS
     */
    private async generateCertificate(): Promise<{ certificate: string; privateKey: string }> {
        this.log.info('Generating self-signed certificate for HTTPS');

        const keys = forge.pki.rsa.generateKeyPair(2048);
        const cert = forge.pki.createCertificate();

        cert.publicKey = keys.publicKey;
        cert.serialNumber = '01';
        cert.validity.notBefore = new Date();
        cert.validity.notAfter = new Date();
        cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);

        const attrs = [
            { name: 'commonName', value: 'Philips Hue' },
            { name: 'countryName', value: 'NL' },
            { name: 'organizationName', value: 'Philips Hue' }
        ];

        cert.setSubject(attrs);
        cert.setIssuer(attrs);
        cert.sign(keys.privateKey, forge.md.sha256.create());

        return {
            certificate: forge.pki.certificateToPem(cert),
            privateKey: forge.pki.privateKeyToPem(keys.privateKey)
        };
    }

    /**
     * Initialize adapter states
     */
    private async initializeAdapterStates(): Promise<void> {
        // Create createLight state (for legacy manual light creation)
        await this.setObjectNotExistsAsync('createLight', {
            type: 'state',
            common: {
                name: 'createLight',
                type: 'string',
                read: true,
                write: true,
                role: 'state',
                desc: 'JSON to create lights manually (legacy mode)'
            },
            native: {}
        });

        // Create startPairing state
        await this.setObjectNotExistsAsync('startPairing', {
            type: 'state',
            common: {
                name: 'startPairing',
                type: 'boolean',
                role: 'button',
                write: true,
                read: true,
                desc: 'Enable pairing mode for 50 seconds'
            },
            native: {}
        });
        this.pairingEnabled = false;

        // Create disableAuth state
        await this.setObjectNotExistsAsync('disableAuth', {
            type: 'state',
            common: {
                name: 'disableAuthentication',
                type: 'boolean',
                role: 'switch',
                write: true,
                read: true,
                desc: 'Disable authentication (allow all requests)'
            },
            native: {}
        });

        // Load disableAuth state
        const disableAuthState = await this.getStateAsync('disableAuth');
        this._disableAuth = (disableAuthState?.val as boolean) || false;

        // Create info channel
        await this.setObjectNotExistsAsync('info', {
            type: 'channel',
            common: {
                name: 'Adapter Information'
            },
            native: {}
        });

        // Create info.configuredDevices state
        const deviceCount = (this.config.devices || []).length;
        await this.setObjectNotExistsAsync('info.configuredDevices', {
            type: 'state',
            common: {
                name: 'Configured Devices',
                type: 'number',
                role: 'value',
                read: true,
                write: false,
                desc: 'Number of devices configured in admin UI'
            },
            native: {}
        });
        await this.setStateAsync('info.configuredDevices', { val: deviceCount, ack: true });
    }

    /**
     * Create a logger adapter for the modules
     */
    private createLogger(): Logger {
        return {
            silly: (msg: string) => this.log.silly(msg),
            debug: (msg: string) => this.log.debug(msg),
            info: (msg: string) => this.log.info(msg),
            warn: (msg: string) => this.log.warn(msg),
            error: (msg: string) => this.log.error(msg)
        };
    }

    /**
     * Called when adapter shuts down
     */
    private async onUnload(callback: () => void): Promise<void> {
        try {
            // Clear pairing timeout
            if (this.pairingTimeoutId) {
                clearTimeout(this.pairingTimeoutId);
                this.pairingTimeoutId = null;
            }

            // Stop SSDP server
            if (this.ssdpServer) {
                this.ssdpServer.stop();
            }

            // Stop HTTP server
            if (this.hueServer) {
                await this.hueServer.stop();
            }

            this.log.info('Hue Emulator stopped');
            callback();
        } catch (error) {
            this.log.error(`Error during shutdown: ${error}`);
            callback();
        }
    }

    /**
     * Called if a subscribed object changes
     */
    private onObjectChange(id: string, obj: ioBroker.Object | null | undefined): void {
        if (obj) {
            this.log.debug(`Object ${id} changed: ${JSON.stringify(obj)}`);
        } else {
            this.log.debug(`Object ${id} deleted`);
        }
    }

    /**
     * Called if a subscribed state changes
     */
    private onStateChange(id: string, state: ioBroker.State | null | undefined): void {
        if (!state) {
            this.log.debug(`State ${id} deleted`);
            return;
        }

        this.log.debug(`State ${id} changed: ${state.val} (ack = ${state.ack})`);

        // Update API handler state cache for device binding
        if (this.apiHandler && state.ack) {
            this.apiHandler.onStateChange(id, state.val);
        }

        // Only handle non-acked state changes for our own states
        if (state.ack) {
            return;
        }

        if (id === `${this.namespace}.createLight`) {
            this.handleCreateLight(id, state);
        } else if (id === `${this.namespace}.startPairing`) {
            this.handleStartPairing(state);
        } else if (id === `${this.namespace}.disableAuth`) {
            this.disableAuth = state.val as boolean;
        } else if (id.startsWith(this.namespace)) {
            // Acknowledge other own state changes
            this.setState(id, { ack: true, val: state.val });
        }
    }

    /**
     * Handle sendTo messages from admin UI
     */
    private async onMessage(obj: ioBroker.Message): Promise<void> {
        if (!obj || !obj.command) {
            return;
        }

        // Ignore device-manager messages
        if (obj.command.startsWith('dm:')) {
            return;
        }

        this.log.debug(`Received message: ${obj.command}`);

        // No custom commands needed - configuration is done via jsonConfig
        if (obj.callback) {
            this.sendTo(obj.from, obj.command, { error: 'Unknown command' }, obj.callback);
        }
    }

    /**
     * Handle startPairing state change
     */
    private handleStartPairing(state: ioBroker.State): void {
        if (this.pairingTimeoutId) {
            clearTimeout(this.pairingTimeoutId);
        }

        this.pairingEnabled = state.val as boolean;

        // Auto-disable pairing after 50 seconds
        if (state.val) {
            this.pairingTimeoutId = setTimeout(() => {
                this._pairingEnabled = false;
                this.setState('startPairing', { ack: true, val: false });
                this.log.info('Pairing mode automatically disabled after timeout');
            }, 50000);
        }
    }

    /**
     * Handle createLight state change (legacy mode)
     */
    private handleCreateLight(id: string, state: ioBroker.State): void {
        try {
            const lights = typeof state.val === 'object'
                ? state.val
                : JSON.parse(state.val as string);

            this.log.info(`Creating lights (legacy mode): ${JSON.stringify(lights)}`);

            Object.keys(lights).forEach(lightId => {
                try {
                    this.createLightDevice(lightId, lights);
                    this.createLightState(lightId, lights);
                    this.createLightName(lightId, lights);
                    this.createLightData(lightId, lights);

                    this.setState(id, { ack: true, val: state.val });
                } catch (error) {
                    this.log.warn(`Could not create light ${lightId}: ${error}`);
                }
            });
        } catch (error) {
            this.log.warn(`Could not parse lights: ${error}`);
        }
    }

    /**
     * Create light device object
     */
    private createLightDevice(lightId: string, lights: Record<string, any>): void {
        this.setObjectNotExists(lightId, {
            type: 'device',
            common: {
                name: lights[lightId].name
            },
            native: {}
        });
    }

    /**
     * Create light state channel and states
     */
    private createLightState(lightId: string, lights: Record<string, any>): void {
        this.setObjectNotExists(`${lightId}.state`, {
            type: 'channel',
            common: {
                name: 'state'
            },
            native: {}
        }, err => {
            if (!err) {
                this.definition.addFunction(lightId, 'state', undefined as unknown as string);
            }
        });

        Object.keys(lights[lightId].state).forEach(stateKey => {
            this.addState(`${lightId}.state.${stateKey}`, stateKey, lights[lightId].state[stateKey]);
        });
    }

    /**
     * Create light name state
     */
    private createLightName(lightId: string, lights: Record<string, any>): void {
        this.setObjectNotExists(`${lightId}.name`, {
            type: 'state',
            common: {
                name: 'name',
                type: 'string',
                role: 'text',
                read: true,
                write: true
            },
            native: {}
        });

        this.setState(`${lightId}.name`, { ack: true, val: lights[lightId].name });
    }

    /**
     * Create light data state
     */
    private createLightData(lightId: string, lights: Record<string, any>): void {
        const data: Record<string, any> = {};

        Object.keys(lights[lightId]).forEach(key => {
            if (key !== 'state' && key !== 'name') {
                data[key] = lights[lightId][key];
            }
        });

        this.setObjectNotExists(`${lightId}.data`, {
            type: 'state',
            common: {
                name: 'data',
                type: 'object',
                role: 'state',
                read: true,
                write: true
            },
            native: {}
        });

        this.setState(`${lightId}.data`, { ack: true, val: JSON.stringify(data) });
    }

    /**
     * Add a state with type detection
     */
    private addState(id: string, name: string, value: any): void {
        const valueType = typeof value;
        let commonType: ioBroker.CommonType = 'mixed';

        if (valueType === 'number' || valueType === 'string' || valueType === 'boolean' || valueType === 'object') {
            commonType = valueType;
        }

        this.setObjectNotExists(id, {
            type: 'state',
            common: {
                name,
                type: commonType,
                role: HueEmuDefinition.determineRole('state', name),
                read: true,
                write: true
            },
            native: {}
        });

        this.setState(id, { ack: true, val: value });
    }

    /**
     * Parse port number
     */
    private toPort(port: any): number {
        if (port) {
            return typeof port === 'number' ? port : parseInt(port.toString().trim(), 10);
        }
        throw new Error('Port not specified');
    }

    /**
     * Parse port with default value
     */
    private toDefaultPort(port: any, defaultPort: number): number {
        const parsed = this.toUndefinedPort(port);
        return parsed ?? defaultPort;
    }

    /**
     * Parse optional port
     */
    private toUndefinedPort(port: any): number | undefined {
        if (port) {
            return typeof port === 'number' ? port : parseInt(port.toString(), 10);
        }
        return undefined;
    }
}

if (require.main !== module) {
    // Export the constructor in compact mode
    module.exports = (options: Partial<utils.AdapterOptions> | undefined) => new HueEmu(options);
} else {
    // Start the instance directly
    (() => new HueEmu())();
}
