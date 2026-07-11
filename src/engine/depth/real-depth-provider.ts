import * as THREE from 'three';

export interface RealDepthFrame {
	available: boolean;
	usage: 'cpu-optimized' | 'gpu-optimized' | 'none';
	format: 'luminance-alpha' | 'float32' | 'unsigned-short' | null;
	width: number;
	height: number;
	texture: THREE.Texture | WebGLTexture | null;
	rawValueToMeters: number;
	normDepthBufferFromNormView: XRRigidTransform | null;
	updatedAt: number;
}

interface GpuDepthInformation {
	texture: WebGLTexture;
	width: number;
	height: number;
	rawValueToMeters: number;
	normDepthBufferFromNormView: XRRigidTransform;
}

interface GpuDepthBinding {
	getDepthInformation(view: XRView): GpuDepthInformation | null;
}

interface GpuDepthBindingConstructor {
	new (session: XRSession, context: WebGLRenderingContext | WebGL2RenderingContext): GpuDepthBinding;
}

const DEPTH_UPLOAD_INTERVAL_MS = 66;
const EMPTY_DEPTH_FRAME: RealDepthFrame = {
	available: false,
	usage: 'none',
	format: null,
	width: 0,
	height: 0,
	texture: null,
	rawValueToMeters: 0,
	normDepthBufferFromNormView: null,
	updatedAt: 0
};

export class RealDepthProvider {
	private session: XRSession | null = null;
	private binding: GpuDepthBinding | null = null;
	private texture: THREE.DataTexture | null = null;
	private uint16Buffer: Uint16Array | null = null;
	private float32Buffer: Float32Array | null = null;
	private textureWidth = 0;
	private textureHeight = 0;
	private textureFormat: RealDepthFrame['format'] = null;
	private currentFrame: RealDepthFrame = { ...EMPTY_DEPTH_FRAME };
	private lastUploadAt = 0;

	initialize(session: XRSession, renderer: THREE.WebGLRenderer): void {

		this.dispose();
		this.session = session;
		const usage = readDepthUsage( session );
		if ( usage === 'gpu-optimized' ) {
			try {
				const BindingCtor = ( window as unknown as { XRWebGLBinding?: GpuDepthBindingConstructor } ).XRWebGLBinding;
				this.binding = BindingCtor === undefined ? null : new BindingCtor( session, renderer.getContext() );
			} catch ( error ) {
				console.warn( '[RealDepthProviderGpuBindingUnavailable]', error );
			}
		}
		this.currentFrame = createEmptyDepthFrame( usage, readDepthFormat( session ) );

	}

	update(frame: XRFrame, view: XRView, time: number): RealDepthFrame {

		if ( this.session === null || this.currentFrame.usage === 'none' ) {
			return this.currentFrame;
		}
		if ( time - this.lastUploadAt < DEPTH_UPLOAD_INTERVAL_MS ) {
			return this.currentFrame;
		}
		this.lastUploadAt = time;
		this.currentFrame = this.currentFrame.usage === 'gpu-optimized'
			? this.readGpuDepth( view, time )
			: this.readCpuDepth( frame, view, time );
		return this.currentFrame;

	}

	getCurrentFrame(): RealDepthFrame {

		return this.currentFrame;

	}

	isAvailable(): boolean {

		return this.session !== null && this.currentFrame.usage !== 'none';

	}

	dispose(): void {

		this.texture?.dispose();
		this.texture = null;
		this.uint16Buffer = null;
		this.float32Buffer = null;
		this.textureWidth = 0;
		this.textureHeight = 0;
		this.textureFormat = null;
		this.binding = null;
		this.session = null;
		this.currentFrame = { ...EMPTY_DEPTH_FRAME };
		this.lastUploadAt = 0;

	}

	private readCpuDepth(frame: XRFrame, view: XRView, time: number): RealDepthFrame {

		const getDepthInformation = frame.getDepthInformation;
		if ( getDepthInformation === undefined || this.session === null ) {
			return createEmptyDepthFrame( 'cpu-optimized', readDepthFormat( this.session ) );
		}
		try {
			const info = getDepthInformation.call( frame, view );
			if ( info === null || info === undefined ) {
				return createEmptyDepthFrame( 'cpu-optimized', readDepthFormat( this.session ) );
			}
			const format = readDepthFormat( this.session );
			const texture = this.updateCpuTexture( info, format );
			return {
				available: texture !== null,
				usage: 'cpu-optimized',
				format,
				width: info.width,
				height: info.height,
				texture,
				rawValueToMeters: info.rawValueToMeters,
				normDepthBufferFromNormView: info.normDepthBufferFromNormView,
				updatedAt: time
			};
		} catch ( error ) {
			console.warn( '[RealDepthProviderCpuReadFailed]', error );
			return createEmptyDepthFrame( 'cpu-optimized', readDepthFormat( this.session ) );
		}

	}

	private readGpuDepth(view: XRView, time: number): RealDepthFrame {

		if ( this.binding === null || this.session === null ) {
			return createEmptyDepthFrame( 'gpu-optimized', readDepthFormat( this.session ) );
		}
		try {
			const info = this.binding.getDepthInformation( view );
			if ( info === null || info === undefined ) {
				return createEmptyDepthFrame( 'gpu-optimized', readDepthFormat( this.session ) );
			}
			return {
				available: true,
				usage: 'gpu-optimized',
				format: readDepthFormat( this.session ),
				width: info.width,
				height: info.height,
				texture: info.texture,
				rawValueToMeters: info.rawValueToMeters,
				normDepthBufferFromNormView: info.normDepthBufferFromNormView,
				updatedAt: time
			};
		} catch ( error ) {
			console.warn( '[RealDepthProviderGpuReadFailed]', error );
			return createEmptyDepthFrame( 'gpu-optimized', readDepthFormat( this.session ) );
		}

	}

	private updateCpuTexture(info: XRCPUDepthInformation, format: RealDepthFrame['format']): THREE.DataTexture | null {

		if ( format === 'float32' ) {
			const source = info.data instanceof Float32Array ? info.data : new Float32Array( info.data );
			if ( this.needsCpuTextureRebuild( source.length, info.width, info.height, format ) ) {
				this.texture?.dispose();
				this.float32Buffer = new Float32Array( source.length );
				this.uint16Buffer = null;
				this.texture = createDepthTexture( this.float32Buffer, info.width, info.height, THREE.FloatType );
			}
			this.float32Buffer!.set( source );
		} else {
			const source = info.data instanceof Uint16Array ? info.data : new Uint16Array( info.data );
			if ( this.needsCpuTextureRebuild( source.length, info.width, info.height, format ) ) {
				this.texture?.dispose();
				this.uint16Buffer = new Uint16Array( source.length );
				this.float32Buffer = null;
				this.texture = createDepthTexture( this.uint16Buffer, info.width, info.height, THREE.UnsignedShortType );
			}
			this.uint16Buffer!.set( source );
		}
		this.textureWidth = info.width;
		this.textureHeight = info.height;
		this.textureFormat = format;
		if ( this.texture !== null ) this.texture.needsUpdate = true;
		return this.texture;

	}

	private needsCpuTextureRebuild(length: number, width: number, height: number, format: RealDepthFrame['format']): boolean {

		return this.texture === null
			|| this.textureWidth !== width
			|| this.textureHeight !== height
			|| this.textureFormat !== format
			|| ( this.float32Buffer?.length ?? this.uint16Buffer?.length ?? 0 ) !== length;

	}
}

function createDepthTexture(data: Uint16Array | Float32Array, width: number, height: number, type: THREE.TextureDataType): THREE.DataTexture {

	const texture = new THREE.DataTexture( data, width, height, THREE.RedFormat, type );
	texture.minFilter = THREE.NearestFilter;
	texture.magFilter = THREE.NearestFilter;
	texture.generateMipmaps = false;
	texture.flipY = false;
	texture.colorSpace = THREE.NoColorSpace;
	return texture;

}

function createEmptyDepthFrame(usage: RealDepthFrame['usage'], format: RealDepthFrame['format']): RealDepthFrame {

	return { ...EMPTY_DEPTH_FRAME, usage, format };

}

function readDepthUsage(session: XRSession | null): RealDepthFrame['usage'] {

	try {
		const value = ( session as unknown as { depthUsage?: unknown } | null )?.depthUsage;
		return value === 'cpu-optimized' || value === 'gpu-optimized' ? value : 'none';
	} catch {
		return 'none';
	}

}

function readDepthFormat(session: XRSession | null): RealDepthFrame['format'] {

	try {
		const value = ( session as unknown as { depthDataFormat?: unknown } | null )?.depthDataFormat;
		return value === 'luminance-alpha' || value === 'float32' || value === 'unsigned-short' ? value : null;
	} catch {
		return null;
	}

}
