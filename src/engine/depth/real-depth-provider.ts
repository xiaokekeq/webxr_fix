import * as THREE from 'three';

export type CpuDepthSampleEncoding = 'uint16-raw';

export interface CpuDepthFrame {
	sessionEnabled: boolean;
	available: boolean;
	validThisUpdate: boolean;
	stale: boolean;
	width: number;
	height: number;
	texture: THREE.DataTexture | null;
	sampleEncoding: CpuDepthSampleEncoding;
	rawValueToMeters: number;
	normDepthBufferFromNormView: THREE.Matrix4 | null;
	lastValidAt: number;
	ageMs: number;
}

const CPU_DEPTH_UPLOAD_INTERVAL_MS = 66;
const CPU_DEPTH_STALE_TIMEOUT_MS = 150;

const EMPTY_CPU_DEPTH_FRAME: CpuDepthFrame = {
	sessionEnabled: false,
	available: false,
	validThisUpdate: false,
	stale: true,
	width: 0,
	height: 0,
	texture: null,
	sampleEncoding: 'uint16-raw',
	rawValueToMeters: 0,
	normDepthBufferFromNormView: null,
	lastValidAt: 0,
	ageMs: Number.POSITIVE_INFINITY
};

export class RealDepthProvider {
	private session: XRSession | null = null;
	private depthEnabled = false;
	private width = 0;
	private height = 0;
	private cpuBuffer: Uint16Array | null = null;
	private texture: THREE.DataTexture | null = null;
	private readonly normDepthBufferFromNormView = new THREE.Matrix4();
	private currentFrame: CpuDepthFrame = createEmptyCpuDepthFrame();
	private lastUploadAt = 0;
	private lastValidAt = 0;
	private lastErrorLogAt = Number.NEGATIVE_INFINITY;
	private unsupportedConfigurationLogged = false;

	initialize(session: XRSession): void {

		this.dispose();
		this.session = session;
		const depthUsage = readDepthUsage( session );
		const depthDataFormat = readDepthDataFormat( session );
		this.depthEnabled = depthUsage === 'cpu-optimized' && depthDataFormat === 'luminance-alpha';
		this.currentFrame.sessionEnabled = this.depthEnabled;

		if ( this.depthEnabled === false && this.unsupportedConfigurationLogged === false ) {
			this.unsupportedConfigurationLogged = true;
			console.warn( '[UnsupportedDepthConfiguration]', { depthUsage, depthDataFormat } );
		}

	}

	update(frame: XRFrame, view: XRView, time: number): CpuDepthFrame {

		if ( this.depthEnabled === false || this.session === null ) {
			return this.currentFrame;
		}
		if ( time - this.lastUploadAt < CPU_DEPTH_UPLOAD_INTERVAL_MS ) {
			return this.refreshStaleState( time );
		}

		this.lastUploadAt = time;
		try {
			const depthInfo = frame.getDepthInformation( view );
			if ( depthInfo === null || depthInfo === undefined ) {
				return this.refreshStaleState( time );
			}

			const requiredLength = depthInfo.width * depthInfo.height;
			const source = new Uint16Array( depthInfo.data );
			if ( source.length < requiredLength ) {
				throw new Error( `CPU depth buffer length ${source.length} is smaller than ${requiredLength}` );
			}
			this.ensureTexture( depthInfo.width, depthInfo.height, requiredLength );
			this.cpuBuffer!.set( source.subarray( 0, requiredLength ) );
			this.texture!.needsUpdate = true;
			this.normDepthBufferFromNormView.fromArray( depthInfo.normDepthBufferFromNormView.matrix );
			this.lastValidAt = time;
			this.currentFrame = {
				sessionEnabled: true,
				available: true,
				validThisUpdate: true,
				stale: false,
				width: this.width,
				height: this.height,
				texture: this.texture,
				sampleEncoding: 'uint16-raw',
				rawValueToMeters: depthInfo.rawValueToMeters,
				normDepthBufferFromNormView: this.normDepthBufferFromNormView,
				lastValidAt: time,
				ageMs: 0
			};
			return this.currentFrame;
		} catch ( error ) {
			this.logReadFailure( error );
			return this.refreshStaleState( time );
		}

	}

	getCurrentFrame(): CpuDepthFrame {

		return this.currentFrame;

	}

	isSessionEnabled(): boolean {

		return this.depthEnabled;

	}

	hasValidFrame(): boolean {

		return this.currentFrame.available && this.currentFrame.stale === false;

	}

	dispose(): void {

		this.texture?.dispose();
		this.texture = null;
		this.cpuBuffer = null;
		this.session = null;
		this.depthEnabled = false;
		this.width = 0;
		this.height = 0;
		this.lastUploadAt = 0;
		this.lastValidAt = 0;
		this.lastErrorLogAt = Number.NEGATIVE_INFINITY;
		this.currentFrame = createEmptyCpuDepthFrame();

	}

	private ensureTexture(width: number, height: number, requiredLength: number): void {

		if (
			this.texture !== null
			&& this.width === width
			&& this.height === height
			&& this.cpuBuffer?.length === requiredLength
		) {
			return;
		}

		this.texture?.dispose();
		this.width = width;
		this.height = height;
		this.cpuBuffer = new Uint16Array( requiredLength );
		this.texture = new THREE.DataTexture(
			this.cpuBuffer,
			width,
			height,
			THREE.RedIntegerFormat,
			THREE.UnsignedShortType
		);
		this.texture.minFilter = THREE.NearestFilter;
		this.texture.magFilter = THREE.NearestFilter;
		this.texture.generateMipmaps = false;
		this.texture.flipY = false;
		this.texture.colorSpace = THREE.NoColorSpace;
		this.texture.unpackAlignment = 1;
		this.texture.needsUpdate = true;

	}

	private refreshStaleState(time: number): CpuDepthFrame {

		const ageMs = this.lastValidAt === 0 ? Number.POSITIVE_INFINITY : Math.max( 0, time - this.lastValidAt );
		const stale = ageMs > CPU_DEPTH_STALE_TIMEOUT_MS;
		this.currentFrame = {
			...this.currentFrame,
			sessionEnabled: this.depthEnabled,
			available: stale === false && this.texture !== null,
			validThisUpdate: false,
			stale,
			ageMs
		};
		return this.currentFrame;

	}

	private logReadFailure(error: unknown): void {

		const now = performance.now();
		if ( now - this.lastErrorLogAt < 3000 ) {
			return;
		}
		this.lastErrorLogAt = now;
		console.error( '[RealDepthProviderReadFailed]', {
			errorName: error instanceof Error ? error.name : typeof error,
			errorMessage: error instanceof Error ? error.message : String( error ),
			width: this.width,
			height: this.height,
			depthEnabled: this.depthEnabled
		} );

	}
}

function createEmptyCpuDepthFrame(): CpuDepthFrame {

	return { ...EMPTY_CPU_DEPTH_FRAME };

}

function readDepthUsage(session: XRSession): 'cpu-optimized' | null {

	try {
		return ( session as unknown as { depthUsage?: unknown } ).depthUsage === 'cpu-optimized'
			? 'cpu-optimized'
			: null;
	} catch {
		return null;
	}

}

function readDepthDataFormat(session: XRSession): 'luminance-alpha' | null {

	try {
		return ( session as unknown as { depthDataFormat?: unknown } ).depthDataFormat === 'luminance-alpha'
			? 'luminance-alpha'
			: null;
	} catch {
		return null;
	}

}
