import * as THREE from 'three';

export interface RealDepthFrame {
	available: boolean;
	usage: 'cpu-optimized' | 'gpu-optimized' | 'none';
	format?: string;
	width?: number;
	height?: number;
	texture?: THREE.Texture | WebGLTexture | null;
	rawValueToMeters?: number;
	normDepthBufferFromNormView?: unknown;
	timestamp?: number;
}

const EMPTY_DEPTH_FRAME: RealDepthFrame = {
	available: false,
	usage: 'none'
};

export class RealDepthProvider {
	private session: XRSession | null = null;
	private renderer: THREE.WebGLRenderer | null = null;
	private binding: unknown = null;
	private currentFrame: RealDepthFrame = EMPTY_DEPTH_FRAME;

	initialize(session: XRSession, renderer: THREE.WebGLRenderer): void {
		this.session = session;
		this.renderer = renderer;
		this.binding = createXRWebGLBinding( session, renderer );
		this.currentFrame = {
			available: false,
			usage: readDepthUsage( session ),
			format: readDepthFormat( session )
		};
	}

	update(frame: XRFrame, view: XRView): RealDepthFrame {
		if ( this.session === null ) {
			this.currentFrame = EMPTY_DEPTH_FRAME;
			return this.currentFrame;
		}

		const usage = readDepthUsage( this.session );
		this.currentFrame = usage === 'gpu-optimized'
			? readGpuDepthFrame( this.binding, view, this.session )
			: readCpuDepthFrame( frame, view, this.session );
		return this.currentFrame;
	}

	getCurrentFrame(): RealDepthFrame {
		return this.currentFrame;
	}

	dispose(): void {
		this.session = null;
		this.renderer = null;
		this.binding = null;
		this.currentFrame = EMPTY_DEPTH_FRAME;
	}
}

function readCpuDepthFrame(frame: XRFrame, view: XRView, session: XRSession): RealDepthFrame {
	const getDepthInformation = ( frame as unknown as { getDepthInformation?: ( view: XRView ) => unknown } ).getDepthInformation;
	if ( typeof getDepthInformation !== 'function' ) {
		return {
			available: false,
			usage: readDepthUsage( session ),
			format: readDepthFormat( session ),
			timestamp: performance.now()
		};
	}

	try {
		const depthInfo = getDepthInformation.call( frame, view ) as {
			width?: number;
			height?: number;
			rawValueToMeters?: number;
			normDepthBufferFromNormView?: unknown;
		} | null | undefined;
		return {
			available: depthInfo !== null && depthInfo !== undefined,
			usage: 'cpu-optimized',
			format: readDepthFormat( session ),
			width: depthInfo?.width,
			height: depthInfo?.height,
			rawValueToMeters: depthInfo?.rawValueToMeters,
			normDepthBufferFromNormView: depthInfo?.normDepthBufferFromNormView,
			timestamp: performance.now()
		};
	} catch {
		return {
			available: false,
			usage: 'cpu-optimized',
			format: readDepthFormat( session ),
			timestamp: performance.now()
		};
	}
}

function readGpuDepthFrame(binding: unknown, view: XRView, session: XRSession): RealDepthFrame {
	const getDepthInformation = ( binding as { getDepthInformation?: ( view: XRView ) => unknown } | null )?.getDepthInformation;
	if ( typeof getDepthInformation !== 'function' ) {
		return {
			available: false,
			usage: 'gpu-optimized',
			format: readDepthFormat( session ),
			timestamp: performance.now()
		};
	}

	try {
		const depthInfo = getDepthInformation.call( binding, view ) as {
			texture?: WebGLTexture;
			width?: number;
			height?: number;
			rawValueToMeters?: number;
			normDepthBufferFromNormView?: unknown;
		} | null | undefined;
		return {
			available: depthInfo !== null && depthInfo !== undefined,
			usage: 'gpu-optimized',
			format: readDepthFormat( session ),
			texture: depthInfo?.texture ?? null,
			width: depthInfo?.width,
			height: depthInfo?.height,
			rawValueToMeters: depthInfo?.rawValueToMeters,
			normDepthBufferFromNormView: depthInfo?.normDepthBufferFromNormView,
			timestamp: performance.now()
		};
	} catch {
		return {
			available: false,
			usage: 'gpu-optimized',
			format: readDepthFormat( session ),
			timestamp: performance.now()
		};
	}
}

function createXRWebGLBinding(session: XRSession, renderer: THREE.WebGLRenderer): unknown {
	const BindingCtor = ( window as unknown as { XRWebGLBinding?: new ( session: XRSession, context: WebGLRenderingContext | WebGL2RenderingContext ) => unknown } ).XRWebGLBinding;
	if ( BindingCtor === undefined ) {
		return null;
	}

	return new BindingCtor( session, renderer.getContext() );
}

function readDepthUsage(session: XRSession): RealDepthFrame['usage'] {
	const usage = ( session as unknown as { depthUsage?: unknown } ).depthUsage;
	return usage === 'cpu-optimized' || usage === 'gpu-optimized' ? usage : 'none';
}

function readDepthFormat(session: XRSession): string | undefined {
	const format = ( session as unknown as { depthDataFormat?: unknown } ).depthDataFormat;
	return typeof format === 'string' ? format : undefined;
}
