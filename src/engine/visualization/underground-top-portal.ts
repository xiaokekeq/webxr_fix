import * as THREE from 'three';
import {
	createCpuDepthOcclusionUniforms,
	syncCpuDepthOcclusionUniforms,
	type CpuDepthOcclusionUniforms
} from '@/engine/depth/cpu-depth-occlusion.js';
import type { CpuDepthFrame } from '@/engine/depth/real-depth-provider.js';
import { isArDebugEnabled } from '@/engine/debug/ar-logger.js';
import { buildPortalRenderProxy } from './portal-render-proxy-builder.js';

const PORTAL_SURFACE_NAME = '__underground-top-portal-surface';
const PORTAL_RENDER_ORDER = 40;
const PORTAL_SURFACE_LIFT_METERS = 0.002;
const PORTAL_MAX_RESOLUTION = 1024;
const PORTAL_MIN_RESOLUTION = 384;
const PORTAL_FOREGROUND_THRESHOLD_METERS = readPortalNumber( 'portalThreshold', 0.05 );
const PORTAL_DEPTH_FEATHER_METERS = readPortalNumber( 'portalFeather', 0.025 );
const PORTAL_BACKGROUND_ALPHA = THREE.MathUtils.clamp( readPortalNumber( 'portalBackgroundAlpha', 0.9 ), 0.85, 1 );
const PORTAL_BACKGROUND_COLOR = new THREE.Color( readPortalColor( 'portalBackgroundColor', 0x06101a ) );
const PORTAL_DEBUG_MODE = readPortalDebugMode();

export type PortalState = 'idle' | 'initializing' | 'surface-ready' | 'content-ready' | 'ready' | 'failed';
type GeometryCalibrationState = 'dirty' | 'calibrating' | 'ready' | 'failed';
interface PortalCornerCorrespondence { id: string; sourceWorld: THREE.Vector3; targetWorld: THREE.Vector3; }

const vertexShader = /* glsl */`
precision highp float;

out vec2 vPortalUv;
out vec4 vDepthClipPosition;
out float vPortalSurfaceDepthMeters;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  vec4 clipPosition = projectionMatrix * mvPosition;
  vPortalUv = uv;
  vDepthClipPosition = clipPosition;
  vPortalSurfaceDepthMeters = -mvPosition.z;
  gl_Position = clipPosition;
}`;

const fragmentShader = /* glsl */`
precision highp float;
precision highp int;

uniform sampler2D uPortalColorTexture;
uniform bool uDepthOcclusionEnabled;
uniform highp usampler2D uRealDepthTexture;
uniform float uRawValueToMeters;
uniform mat4 uNormDepthBufferFromNormView;
uniform ivec2 uDepthTextureSize;
uniform float uForegroundThresholdMeters;
uniform float uDepthFeatherMeters;
uniform float uPortalBackgroundAlpha;
uniform vec3 uPortalBackgroundColor;
uniform int uDebugMode;

in vec2 vPortalUv;
in vec4 vDepthClipPosition;
in float vPortalSurfaceDepthMeters;
out vec4 outColor;

float sampleForegroundScore(ivec2 coord) {
  uint rawDepth = texelFetch(uRealDepthTexture, coord, 0).r;
  if (rawDepth == 0u) return -1.0;
  float realDepthMeters = float(rawDepth) * uRawValueToMeters;
  float foregroundDelta = vPortalSurfaceDepthMeters - realDepthMeters;
  return smoothstep(
    uForegroundThresholdMeters - uDepthFeatherMeters,
    uForegroundThresholdMeters + uDepthFeatherMeters,
    foregroundDelta
  );
}

float foregroundMask() {
  if (!uDepthOcclusionEnabled || any(lessThanEqual(uDepthTextureSize, ivec2(0)))) return 0.0;

  vec2 ndc = vDepthClipPosition.xy / vDepthClipPosition.w;
  vec2 normViewUv = ndc * 0.5 + 0.5;
  normViewUv.y = 1.0 - normViewUv.y;
  vec4 transformed = uNormDepthBufferFromNormView * vec4(normViewUv, 0.0, 1.0);
  vec2 depthUvTopLeft = transformed.xy / transformed.w;
  if (any(lessThan(depthUvTopLeft, vec2(0.0))) || any(greaterThan(depthUvTopLeft, vec2(1.0)))) return 0.0;

  vec2 depthTextureUv = vec2(depthUvTopLeft.x, 1.0 - depthUvTopLeft.y);
  ivec2 center = clamp(
    ivec2(depthTextureUv * vec2(uDepthTextureSize)),
    ivec2(0),
    uDepthTextureSize - ivec2(1)
  );
  float total = 0.0;
  float valid = 0.0;
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      ivec2 coord = clamp(center + ivec2(x, y), ivec2(0), uDepthTextureSize - ivec2(1));
      float score = sampleForegroundScore(coord);
      if (score >= 0.0) {
        total += score;
        valid += 1.0;
      }
    }
  }
  return valid > 0.0 ? total / valid : 0.0;
}

void main() {
  if (uDebugMode == 1) {
    outColor = vec4(1.0, 0.0, 1.0, 0.85);
    return;
  }
  vec4 portalColor = texture(uPortalColorTexture, vPortalUv);
  vec3 portalBackground = uPortalBackgroundColor;
  vec3 visibleColor = mix(portalBackground, portalColor.rgb, portalColor.a);
  float baseAlpha = mix(uPortalBackgroundAlpha, 1.0, portalColor.a);
  if (uDebugMode == 2) {
    outColor = vec4(visibleColor, baseAlpha);
    return;
  }
  float finalAlpha = baseAlpha * (1.0 - foregroundMask());
  if (finalAlpha < 0.01) discard;
  outColor = vec4(visibleColor, finalAlpha);
}`;

export interface UndergroundTopPortalPickResult {
	hitPortal: boolean;
	sourceObject: THREE.Object3D | null;
}

export class UndergroundTopPortal {
	private readonly renderScene = new THREE.Scene();
	private readonly camera = new THREE.OrthographicCamera();
	private readonly portalRaycaster = new THREE.Raycaster();
	private readonly proxyToSource = new Map<THREE.Object3D, THREE.Object3D>();
	private readonly normal = new THREE.Vector3( 0, 1, 0 );
	private readonly axisU = new THREE.Vector3();
	private readonly axisV = new THREE.Vector3();
	private readonly center = new THREE.Vector3();
	private readonly previousViewport = new THREE.Vector4();
	private readonly previousScissor = new THREE.Vector4();
	private readonly previousClearColor = new THREE.Color();
	private readonly portalPickNdc = new THREE.Vector2();
	private readonly worldUp = new THREE.Vector3( 0, 1, 0 );
	private readonly lookAtTarget = new THREE.Vector3();
	private readonly bounds = new THREE.Box3();
	private readonly boundsSize = new THREE.Vector3();
	private readonly boundsCenter = new THREE.Vector3();
	private readonly cornerValues = new Float32Array( 24 );
	private readonly modelMatrixValues = new Float32Array( 16 );
	private sourceModel: THREE.Object3D | null = null;
	private sourceModelWasVisible = true;
	private renderModel: THREE.Object3D | null = null;
	private surface: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
	private renderTarget: THREE.WebGLRenderTarget | null = null;
	private uniforms: CpuDepthOcclusionUniforms & {
		uPortalColorTexture: { value: THREE.Texture | null };
		uForegroundThresholdMeters: { value: number };
		uDepthFeatherMeters: { value: number };
		uPortalBackgroundAlpha: { value: number };
		uPortalBackgroundColor: { value: THREE.Color };
		uDebugMode: { value: number };
	} | null = null;
	private portalDirty = true;
	private contentDirty = true;
	private offscreenRevision = 0;
	private lastRenderedRevision = -1;
	private offscreenState: 'not-required' | 'pending' | 'rendering' | 'ready' | 'failed' = 'pending';
	private lastOffscreenFailureReason = '';
	private proxyState: 'not-required' | 'missing' | 'building' | 'ready' | 'failed' = 'missing';
	private proxyBuildAttemptCount = 0;
	private proxyBuildSuccessCount = 0;
	private proxyBuildStats = { sourceRenderableCount: 0, proxyRenderableCount: 0, includedAnnotatedRenderableCount: 0, skippedHelperRenderableCount: 0, skippedUnsupportedRenderableCount: 0 };
	private lastProxyBuildFailureReason = '';
	private redrawCount = 0;
	private lastRedrawTimestamp = 0;
	private lastFrameError = '';
	private maxSourceCornerNdcError = -1;
	private sourceCornerNdc: THREE.Vector2[] = [];
	private sourceCornerIds: string[] = [];
	private originalCornerIds: string[] = [];
	private windingBefore = 'unknown';
	private windingWasReversed = false;
	private geometryCalibrationState: GeometryCalibrationState = 'dirty';
	private renderTargetCreationAttemptCount = 0;
	private lastRenderTargetCreationError = '';
	private cpuDepthDiagnostics = { enabled: false, available: false, stale: true, width: 0, height: 0, rawValueToMeters: 0 };
	private state: PortalState = 'idle';
	private failureReason = '';
	private waitingReason = '';
	private attemptId = 0;

	constructor(private readonly scene: THREE.Scene) {

		this.renderScene.add( new THREE.HemisphereLight( 0xffffff, 0x52657a, 2.2 ) );
		const light = new THREE.DirectionalLight( 0xffffff, 1.6 );
		light.position.set( 3, 8, 4 );
		this.renderScene.add( light );

	}

	update(args: {
		renderer: THREE.WebGLRenderer;
		mainCamera: THREE.Camera;
		model: THREE.Object3D;
		sourceModelCorners: THREE.Vector3[];
		targetSurfaceCorners: THREE.Vector3[];
		depthFrame: CpuDepthFrame;
		enabled: boolean;
	}): PortalState {

		if ( args.enabled === false ) {
			this.hide();
			return this.setState( 'idle' );
		}
		if ( this.state === 'failed' ) return 'failed';
		if ( this.state === 'idle' ) {
			this.attemptId += 1;
			this.setState( 'initializing' );
		}
		const sourceCorners = validateCorners( args.sourceModelCorners );
		const targetCorners = validateCorners( args.targetSurfaceCorners );
		if ( sourceCorners.ok === false ) return this.fail( sourceCorners.reason );
		if ( targetCorners.ok === false ) return this.fail( targetCorners.reason );
		this.bindSourceModel( args.model );
		if ( PORTAL_DEBUG_MODE === 'surface' ) this.proxyState = 'not-required';
		if ( PORTAL_DEBUG_MODE !== 'surface' ) {
			if ( this.countRenderableMeshes( this.sourceModel, false ) === 0 ) return this.fail( 'no-renderable-model-structure' );
			const proxyFailure = this.ensureRenderProxy();
			if ( proxyFailure !== null ) return this.fail( proxyFailure );
		}
		const geometryFailure = this.updateGeometry( args.renderer, sourceCorners.value, targetCorners.value );
		if ( geometryFailure !== null ) return this.fail( geometryFailure );
		this.syncModelMatrix();
		if ( this.ensureSurface() === false && PORTAL_DEBUG_MODE !== 'surface' ) {
			return this.fail( 'surface-unavailable' );
		}
		if ( this.surface === null || this.uniforms === null ) return this.fail( 'surface-unavailable' );
		this.setState( 'surface-ready' );
		syncCpuDepthOcclusionUniforms( this.uniforms!, args.depthFrame );
		if ( PORTAL_DEBUG_MODE !== 'full' || ( isArDebugEnabled() && readPortalFlag( 'portalDisableCpuDepth' ) ) ) this.uniforms!.uDepthOcclusionEnabled.value = false;
		this.cpuDepthDiagnostics = {
			enabled: this.uniforms!.uDepthOcclusionEnabled.value,
			available: args.depthFrame.available,
			stale: args.depthFrame.stale,
			width: args.depthFrame.width,
			height: args.depthFrame.height,
			rawValueToMeters: args.depthFrame.rawValueToMeters
		};
		this.surface!.visible = true;
		if ( this.portalDirty || ( this.contentDirty && PORTAL_DEBUG_MODE !== 'surface' ) ) {
			this.syncRenderModelState();
			if ( PORTAL_DEBUG_MODE !== 'surface' && this.countStructuralRenderableMeshes() === 0 ) return this.fail( 'render-proxy-empty' );
			this.setState( 'content-ready' );
			this.logDirtyDiagnostics( targetCorners.value, args.mainCamera );
			this.portalDirty = false;
			if ( PORTAL_DEBUG_MODE !== 'surface' && this.contentDirty ) this.render( args.renderer );
			else if ( PORTAL_DEBUG_MODE === 'surface' ) this.offscreenState = 'not-required';
		}
		if ( PORTAL_DEBUG_MODE !== 'surface' && this.offscreenState === 'ready' && this.sourceModel !== null ) this.sourceModel.visible = false;
		return this.setState( 'ready' );

	}

	pick(raycaster: THREE.Raycaster): UndergroundTopPortalPickResult {

		if ( this.surface === null || this.surface.visible === false ) {
			return { hitPortal: false, sourceObject: null };
		}
		const portalHit = raycaster.intersectObject( this.surface, false )[ 0 ];
		if ( portalHit?.uv === undefined ) {
			return { hitPortal: false, sourceObject: null };
		}
		this.portalPickNdc.set( portalHit.uv.x * 2 - 1, portalHit.uv.y * 2 - 1 );
		this.portalRaycaster.setFromCamera( this.portalPickNdc, this.camera );
		const modelHit = this.renderModel === null
			? undefined
			: this.portalRaycaster.intersectObject( this.renderModel, true )
				.find( ( hit ) => hit.object.visible );
		return {
			hitPortal: true,
			sourceObject: modelHit === undefined ? null : this.proxyToSource.get( modelHit.object ) ?? null
		};

	}

	markDirty(): void {

		this.portalDirty = true;
		this.markContentDirty();

	}

	beginAttempt(): void {

		this.attemptId += 1;
		this.setState( 'initializing' );
		this.portalDirty = true;
		this.geometryCalibrationState = 'dirty';
		this.markContentDirty();

	}

	setWaiting(reason: string): void {

		this.restoreSourceVisibility();
		if ( this.surface !== null ) this.surface.visible = false;
		this.failureReason = '';
		this.waitingReason = reason;
		this.setState( 'initializing' );

	}

	deactivate(): void {

		this.hide();
		this.setState( 'idle' );
		this.geometryCalibrationState = 'dirty';

	}

	setPrerequisiteFailure(reason: string): PortalState {

		if ( this.state === 'failed' && this.failureReason === reason ) return 'failed';
		return this.fail( reason );

	}

	reset(): void {

		this.restoreSourceVisibility();
		this.sourceModel = null;
		this.renderModel?.removeFromParent();
		this.renderModel = null;
		this.proxyToSource.clear();
		this.surface?.removeFromParent();
		this.surface?.geometry.dispose();
		this.surface?.material.dispose();
		this.surface = null;
		this.renderTarget?.dispose();
		this.renderTarget = null;
		this.uniforms = null;
		this.cornerValues.fill( Number.NaN );
		this.geometryCalibrationState = 'dirty';
		this.modelMatrixValues.fill( Number.NaN );
		this.portalDirty = true;
		this.markContentDirty();
		this.state = 'idle';
		this.failureReason = '';
		this.proxyState = 'missing';
		this.lastProxyBuildFailureReason = '';

	}

	dispose(): void {

		this.reset();

	}

	private hide(): void {

		this.restoreSourceVisibility();
		if ( this.surface !== null ) this.surface.visible = false;

	}

	private setState(state: PortalState): PortalState {

		if ( this.state !== state && isArDebugEnabled() ) console.info( '[PortalLifecycle]', { state, failureReason: this.failureReason || 'none', attemptId: this.attemptId } );
		this.state = state;
		if ( state !== 'failed' ) this.failureReason = '';
		if ( state !== 'initializing' ) this.waitingReason = '';
		return state;

	}

	private fail(reason: string): PortalState {

		this.failureReason = reason;
		this.hide();
		return this.setState( 'failed' );

	}

	private bindSourceModel(model: THREE.Object3D): void {

		if ( this.sourceModel === model ) return;
		this.restoreSourceVisibility();
		this.sourceModel = model;
		this.sourceModelWasVisible = model.visible;
		this.proxyState = 'missing';
		this.markContentDirty();

	}

	private restoreSourceVisibility(): void {

		if ( this.sourceModel !== null ) this.sourceModel.visible = this.sourceModelWasVisible;

	}

	private ensureRenderProxy(): string | null {

		if ( this.isRenderProxyValid() ) return null;
		return this.rebuildRenderProxy();

	}

	private isRenderProxyValid(): boolean {

		return this.renderModel !== null
			&& this.renderModel.parent === this.renderScene
			&& this.renderModel.visible
			&& this.renderModel.userData.__portalSourceRootId === this.sourceModel?.uuid
			&& this.countStructuralRenderableMeshes() > 0;

	}

	private rebuildRenderProxy(): string | null {

		if ( this.sourceModel === null ) return 'render-proxy-unavailable';
		this.proxyState = 'building';
		this.proxyBuildAttemptCount += 1;
		let nextRenderModel: THREE.Object3D | null = null;
		try {
			const build = buildPortalRenderProxy( this.sourceModel );
			nextRenderModel = build.root;
			nextRenderModel.visible = true;
			nextRenderModel.name = '__underground-top-portal-render-proxy';
			nextRenderModel.userData.__portalSourceRootId = this.sourceModel.uuid;
			nextRenderModel.matrixAutoUpdate = false;
			this.renderScene.add( nextRenderModel );
			if ( nextRenderModel.parent !== this.renderScene ) throw new Error( 'render-proxy-detached' );
			if ( build.proxyRenderableCount === 0 ) {
				nextRenderModel.removeFromParent();
				return 'render-proxy-empty';
			}
			this.renderModel?.removeFromParent();
			this.renderModel = nextRenderModel;
			this.proxyToSource.clear();
			for ( const [ proxy, source ] of build.proxyToSource ) this.proxyToSource.set( proxy, source );
			this.proxyBuildStats = {
				sourceRenderableCount: build.sourceRenderableCount,
				proxyRenderableCount: build.proxyRenderableCount,
				includedAnnotatedRenderableCount: build.includedAnnotatedRenderableCount,
				skippedHelperRenderableCount: build.skippedHelperRenderableCount,
				skippedUnsupportedRenderableCount: build.skippedUnsupportedRenderableCount
			};
			this.modelMatrixValues.fill( Number.NaN );
			this.proxyState = 'ready';
			this.proxyBuildSuccessCount += 1;
			this.lastProxyBuildFailureReason = '';
			this.portalDirty = true;
			this.markContentDirty();
			return null;
		} catch ( error ) {
			nextRenderModel?.removeFromParent();
			this.proxyState = 'failed';
			this.lastProxyBuildFailureReason = error instanceof Error ? error.message : String( error );
			return this.lastProxyBuildFailureReason.startsWith( 'render-proxy-' )
				? this.lastProxyBuildFailureReason
				: 'render-proxy-build-failed';
		}

	}

	private updateGeometry(renderer: THREE.WebGLRenderer, sourceCorners: THREE.Vector3[], targetCorners: THREE.Vector3[]): string | null {

		if ( this.hasCornerChanges( sourceCorners, targetCorners ) === false && this.geometryCalibrationState === 'ready' ) return null;
		this.geometryCalibrationState = 'calibrating';
		const correspondences: PortalCornerCorrespondence[] = sourceCorners.map( ( sourceWorld, index ) => ( { id: String( index ), sourceWorld, targetWorld: targetCorners[ index ] } ) );
		const center = correspondences.reduce( ( result, corner ) => result.add( corner.sourceWorld ), new THREE.Vector3() ).multiplyScalar( 0.25 );
		const axisU = new THREE.Vector3().subVectors( sourceCorners[ 1 ], sourceCorners[ 0 ] ).normalize();
		const normal = new THREE.Vector3().crossVectors( axisU, new THREE.Vector3().subVectors( sourceCorners[ 3 ], sourceCorners[ 0 ] ) ).normalize();
		const windingWasReversed = normal.dot( this.worldUp ) < 0;
		if ( windingWasReversed ) normal.negate();
		const axisV = new THREE.Vector3().crossVectors( normal, axisU ).normalize();
		axisU.crossVectors( axisV, normal ).normalize();
		if ( Math.abs( axisU.dot( axisV ) ) > 1e-5 || axisU.dot( new THREE.Vector3().crossVectors( axisV, normal ) ) < 0.999 ) return this.calibrationFailed( 'portal-camera-basis-invalid' );
		const projected = correspondences.map( ( corner ) => ( { corner, u: corner.sourceWorld.clone().sub( center ).dot( axisU ), v: corner.sourceWorld.clone().sub( center ).dot( axisV ) } ) );
		const minU = Math.min( ...projected.map( ( point ) => point.u ) ), maxU = Math.max( ...projected.map( ( point ) => point.u ) );
		const minV = Math.min( ...projected.map( ( point ) => point.v ) ), maxV = Math.max( ...projected.map( ( point ) => point.v ) );
		const epsilon = Math.max( maxU - minU, maxV - minV ) * 1e-3;
		const normalized = [ [ minU, minV ], [ maxU, minV ], [ maxU, maxV ], [ minU, maxV ] ].map( ( [ u, v ] ) => projected.find( ( point ) => Math.abs( point.u - u ) <= epsilon && Math.abs( point.v - v ) <= epsilon )?.corner );
		if ( normalized.some( ( corner ) => corner === undefined ) || new Set( normalized ).size !== 4 ) return this.calibrationFailed( 'portal-corner-order-ambiguous' );
		const camera = new THREE.OrthographicCamera( minU, maxU, maxV, minV );
		camera.position.copy( center ).addScaledVector( normal, 1 );
		camera.matrix.makeBasis( axisU, axisV, normal ).setPosition( camera.position );
		camera.matrix.decompose( camera.position, camera.quaternion, camera.scale );
		camera.matrixAutoUpdate = true;
		camera.updateProjectionMatrix(); camera.updateMatrixWorld( true );
		const expectedNdc = [ new THREE.Vector2( -1, -1 ), new THREE.Vector2( 1, -1 ), new THREE.Vector2( 1, 1 ), new THREE.Vector2( -1, 1 ) ];
		const sourceCornerNdc = normalized.map( ( corner ) => {
			const projected = corner!.sourceWorld.clone().project( camera );
			return new THREE.Vector2( projected.x, projected.y );
		} );
		const maxNdcError = Math.max( ...sourceCornerNdc.map( ( point, index ) => Math.hypot( point.x - expectedNdc[ index ].x, point.y - expectedNdc[ index ].y ) ) );
		if ( maxNdcError > 1e-3 ) return this.calibrationFailed( 'portal-source-footprint-not-orthographic' );
		const [ p0, p1, p2, p3 ] = normalized.map( ( corner ) => corner!.targetWorld );
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
			p0.x + normal.x * PORTAL_SURFACE_LIFT_METERS, p0.y + normal.y * PORTAL_SURFACE_LIFT_METERS, p0.z + normal.z * PORTAL_SURFACE_LIFT_METERS,
			p1.x + normal.x * PORTAL_SURFACE_LIFT_METERS, p1.y + normal.y * PORTAL_SURFACE_LIFT_METERS, p1.z + normal.z * PORTAL_SURFACE_LIFT_METERS,
			p2.x + normal.x * PORTAL_SURFACE_LIFT_METERS, p2.y + normal.y * PORTAL_SURFACE_LIFT_METERS, p2.z + normal.z * PORTAL_SURFACE_LIFT_METERS,
			p0.x + normal.x * PORTAL_SURFACE_LIFT_METERS, p0.y + normal.y * PORTAL_SURFACE_LIFT_METERS, p0.z + normal.z * PORTAL_SURFACE_LIFT_METERS,
			p2.x + normal.x * PORTAL_SURFACE_LIFT_METERS, p2.y + normal.y * PORTAL_SURFACE_LIFT_METERS, p2.z + normal.z * PORTAL_SURFACE_LIFT_METERS,
			p3.x + normal.x * PORTAL_SURFACE_LIFT_METERS, p3.y + normal.y * PORTAL_SURFACE_LIFT_METERS, p3.z + normal.z * PORTAL_SURFACE_LIFT_METERS
		], 3 ) );
		geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1 ], 2 ) );
		if ( this.resizeRenderTarget( renderer, maxU - minU, maxV - minV ) === false ) { geometry.dispose(); return this.calibrationFailed( 'render-target-unavailable' ); }
		this.surface?.geometry.dispose();
		if ( this.surface === null ) {
			this.surface = new THREE.Mesh( geometry, this.createMaterial() );
			this.surface.name = PORTAL_SURFACE_NAME;
			this.surface.frustumCulled = false;
			this.surface.renderOrder = PORTAL_RENDER_ORDER;
			this.surface.userData.__nonSelectableHelper = true;
			this.scene.add( this.surface );
		} else {
			this.surface.geometry = geometry;
		}
		this.axisU.copy( axisU ); this.axisV.copy( axisV ); this.normal.copy( normal ); this.center.copy( center );
		this.camera.copy( camera );
		this.sourceCornerIds = normalized.map( ( corner ) => corner!.id );
		this.originalCornerIds = correspondences.map( ( corner ) => corner.id );
		this.windingBefore = windingWasReversed ? 'clockwise' : 'counter-clockwise';
		this.windingWasReversed = windingWasReversed;
		this.sourceCornerNdc = sourceCornerNdc;
		this.maxSourceCornerNdcError = maxNdcError;
		this.commitCornerCache( sourceCorners, targetCorners );
		this.geometryCalibrationState = 'ready';
		this.portalDirty = true;
		this.markContentDirty();
		return null;

	}

	private createMaterial(): THREE.ShaderMaterial {

		this.uniforms = Object.assign( createCpuDepthOcclusionUniforms(), {
			uPortalColorTexture: { value: this.renderTarget?.texture ?? null },
			uForegroundThresholdMeters: { value: PORTAL_FOREGROUND_THRESHOLD_METERS },
			uDepthFeatherMeters: { value: PORTAL_DEPTH_FEATHER_METERS },
			uPortalBackgroundAlpha: { value: PORTAL_BACKGROUND_ALPHA },
			uPortalBackgroundColor: { value: PORTAL_BACKGROUND_COLOR },
			uDebugMode: { value: PORTAL_DEBUG_MODE === 'surface' ? 1 : PORTAL_DEBUG_MODE === 'texture' ? 2 : 0 }
		} );
		return new THREE.ShaderMaterial( {
			uniforms: this.uniforms,
			vertexShader,
			fragmentShader,
			glslVersion: THREE.GLSL3,
			transparent: true,
			depthTest: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			toneMapped: false
		} );

	}

	private ensureSurface(): boolean {

		return this.surface !== null && this.renderTarget !== null && this.uniforms !== null;

	}

	private resizeRenderTarget(renderer: THREE.WebGLRenderer, width: number, height: number): boolean {

		const maxSize = Math.min( PORTAL_MAX_RESOLUTION, renderer.capabilities.maxTextureSize );
		let targetWidth = maxSize;
		let targetHeight = Math.round( maxSize * height / width );
		if ( height > width ) {
			targetHeight = maxSize;
			targetWidth = Math.round( maxSize * width / height );
		}
		targetWidth = Math.min( maxSize, Math.max( PORTAL_MIN_RESOLUTION, targetWidth ) );
		targetHeight = Math.min( maxSize, Math.max( PORTAL_MIN_RESOLUTION, targetHeight ) );
		if ( this.renderTarget?.width === targetWidth && this.renderTarget.height === targetHeight ) return true;
		const nextTarget = this.createRenderTarget( renderer, targetWidth, targetHeight );
		if ( nextTarget === null ) return false;
		this.renderTarget?.dispose();
		this.renderTarget = nextTarget;
		if ( this.uniforms !== null ) this.uniforms.uPortalColorTexture.value = this.renderTarget.texture;
		this.portalDirty = true;
		this.markContentDirty();
		return true;

	}

	private createRenderTarget(renderer: THREE.WebGLRenderer, width: number, height: number): THREE.WebGLRenderTarget | null {

		const longEdge = Math.max( width, height );
		const aspect = width / height;
		const sampleOptions = renderer.capabilities.isWebGL2 ? [ Math.min( renderer.capabilities.maxSamples, 2 ), 0 ] : [ 0 ];
		for ( const candidateLongEdge of [ longEdge, Math.min( longEdge, 768 ), Math.min( longEdge, 512 ) ] ) {
			const candidateWidth = Math.max( PORTAL_MIN_RESOLUTION, Math.round( aspect >= 1 ? candidateLongEdge : candidateLongEdge * aspect ) );
			const candidateHeight = Math.max( PORTAL_MIN_RESOLUTION, Math.round( aspect >= 1 ? candidateLongEdge / aspect : candidateLongEdge ) );
			for ( const samples of sampleOptions ) {
				try {
					this.renderTargetCreationAttemptCount += 1;
					const target = new THREE.WebGLRenderTarget( candidateWidth, candidateHeight, {
						format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter,
						magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false
					} );
					target.samples = samples;
					return target;
				} catch ( error ) {
					this.lastRenderTargetCreationError = error instanceof Error ? error.message : String( error );
					this.lastFrameError = this.lastRenderTargetCreationError;
				}
			}
		}
		return null;

	}

	private syncModelMatrix(): void {

		if ( this.sourceModel === null || this.renderModel === null ) return;
		this.sourceModel.updateMatrixWorld( true );
		if ( this.copyChangedMatrix( this.sourceModel.matrixWorld.elements ) === false ) return;
		this.renderModel.matrix.copy( this.sourceModel.matrixWorld );
		this.renderModel.matrixWorldNeedsUpdate = true;
		this.renderModel.updateMatrixWorld( true );
		this.bounds.setFromObject( this.renderModel );
		this.bounds.getSize( this.boundsSize );
		this.bounds.getCenter( this.boundsCenter );
		this.camera.far = Math.max( 50, this.camera.position.distanceTo( this.boundsCenter ) + this.boundsSize.length() + 10 );
		this.camera.updateProjectionMatrix();
		this.portalDirty = true;
		this.markContentDirty();

	}

	private syncRenderModelState(): void {

		if ( this.renderModel === null ) return;
		this.renderModel.visible = true;
		this.renderModel.traverse( ( renderObject ) => {
			if ( renderObject === this.renderModel ) return;
			const source = this.proxyToSource.get( renderObject );
			if ( source === undefined ) return;
			renderObject.visible = source.userData.__nonSelectableHelper === true || source instanceof THREE.Sprite
				? false
				: source.visible;
			if ( source instanceof THREE.Mesh && renderObject instanceof THREE.Mesh ) {
				renderObject.material = source.material;
			}
		} );

	}

	private countStructuralRenderableMeshes(): number {

		let count = 0;
		this.renderModel?.traverse( ( object ) => {
			if ( isRenderablePortalMesh( object ) ) count += 1;
		} );
		return count;

	}

	private countVisibleRenderableMeshes(): number {

		let count = 0;
		this.renderModel?.traverseVisible( ( object ) => {
			if ( isRenderablePortalMesh( object ) ) count += 1;
		} );
		return count;

	}

	private countRenderableMeshes(root: THREE.Object3D | null, visibleOnly: boolean): number {

		let count = 0;
		const visit = ( object: THREE.Object3D ) => { if ( isRenderablePortalMesh( object ) ) count += 1; };
		if ( visibleOnly ) root?.traverseVisible( visit );
		else root?.traverse( visit );
		return count;

	}

	private logDirtyDiagnostics(corners: THREE.Vector3[], mainCamera: THREE.Camera): void {

		if ( isArDebugEnabled() === false || this.sourceModel === null || this.renderModel === null ) return;
		this.renderModel.updateMatrixWorld( true );
		const box = new THREE.Box3().setFromObject( this.renderModel );
		const boxCenter = box.getCenter( new THREE.Vector3() );
		const boxSize = box.getSize( new THREE.Vector3() );
		const ndcBounds = projectBoxToNdc( box, this.camera );
		let visibleMeshCount = 0;
		let renderableVisibleMeshCount = 0;
		this.renderModel.traverseVisible( ( object ) => {
			if ( object instanceof THREE.Mesh ) {
				visibleMeshCount += 1;
				if ( object.geometry?.getAttribute( 'position' ) !== undefined && object.material !== undefined ) renderableVisibleMeshCount += 1;
			}
		} );
		const outside = ndcBounds.right < -1 || ndcBounds.left > 1 || ndcBounds.top < -1 || ndcBounds.bottom > 1;
		const edgeLengths = corners.map( ( point, index ) => point.distanceTo( corners[ ( index + 1 ) % 4 ] ) );
		const portalArea = corners.reduce( ( area, point, index ) => area + new THREE.Vector3().subVectors( point, this.center ).cross( new THREE.Vector3().subVectors( corners[ ( index + 1 ) % 4 ], this.center ) ).length() * 0.5, 0 );
		mainCamera.updateMatrixWorld( true );
		const frustum = new THREE.Frustum().setFromProjectionMatrix( new THREE.Matrix4().multiplyMatrices( mainCamera.projectionMatrix, mainCamera.matrixWorldInverse ) );
		console.info( '[PortalDirtyDiagnostic]', {
			corners: corners.map( vectorToObject ),
			cornerOrder: [ 0, 1, 2, 3 ], edgeLengths, portalArea,
			center: vectorToObject( this.center ), normal: vectorToObject( this.normal ),
			axisU: vectorToObject( this.axisU ), axisV: vectorToObject( this.axisV ),
			camera: { left: this.camera.left, right: this.camera.right, top: this.camera.top, bottom: this.camera.bottom, near: this.camera.near, far: this.camera.far },
			sourceModelMatrixWorld: this.sourceModel.matrixWorld.toArray(),
			renderProxyMatrixWorld: this.renderModel.matrixWorld.toArray(),
			renderProxyWorldBox: { center: vectorToObject( boxCenter ), size: vectorToObject( boxSize ) },
			portalModelNdcBounds: ndcBounds,
			renderProxyVisible: this.renderModel.visible,
			visibleMeshCount,
			structuralRenderableMeshCount: this.countStructuralRenderableMeshes(),
			visibleRenderableMeshCount: renderableVisibleMeshCount,
			renderTargetHasRenderableModel: renderableVisibleMeshCount > 0,
			surface: this.surface === null ? null : { visible: this.surface.visible, parent: this.surface.parent?.name || this.surface.parent?.type || 'none', layersMask: this.surface.layers.mask, cameraLayersMask: mainCamera.layers.mask, materialVisible: this.surface.material.visible, materialOpacity: this.surface.material.opacity, materialSide: this.surface.material.side, position: vectorToObject( this.surface.position ), scale: vectorToObject( this.surface.scale ), matrixWorld: this.surface.matrixWorld.toArray(), frustumCulled: this.surface.frustumCulled, inFrustum: frustum.intersectsObject( this.surface ) },
			cpuDepthOcclusionEnabled: this.uniforms?.uDepthOcclusionEnabled.value ?? false,
			result: outside ? 'Portal model is outside orthographic footprint.' : 'Portal model intersects orthographic footprint.'
		} );
		console.assert( this.renderModel.visible, 'Portal render proxy root must be visible.' );

	}

	private render(renderer: THREE.WebGLRenderer): void {

		if ( this.renderTarget === null ) return;
		const previousTarget = renderer.getRenderTarget();
		const previousXrEnabled = renderer.xr.enabled;
		const previousAutoClear = renderer.autoClear;
		const previousClearAlpha = renderer.getClearAlpha();
		renderer.getClearColor( this.previousClearColor );
		renderer.getViewport( this.previousViewport );
		renderer.getScissor( this.previousScissor );
		const previousScissorTest = renderer.getScissorTest();
		const previousOverrideMaterial = this.renderScene.overrideMaterial;
		try {
			this.offscreenState = 'rendering';
			renderer.xr.enabled = false;
			renderer.autoClear = false;
			renderer.setRenderTarget( this.renderTarget );
			renderer.setViewport( 0, 0, this.renderTarget.width, this.renderTarget.height );
			renderer.setScissorTest( false );
			renderer.setClearColor( 0x000000, 0 );
			renderer.clear( true, true, true );
			renderer.render( this.renderScene, this.camera );
			this.contentDirty = false;
			this.lastRenderedRevision = this.offscreenRevision;
			this.offscreenState = 'ready';
			this.redrawCount += 1;
			this.lastRedrawTimestamp = performance.now();
		} catch ( error ) {
			this.lastFrameError = error instanceof Error ? error.message : String( error );
			this.lastOffscreenFailureReason = this.lastFrameError;
			this.offscreenState = 'failed';
			throw error;
		} finally {
			renderer.setRenderTarget( previousTarget );
			renderer.xr.enabled = previousXrEnabled;
			renderer.autoClear = previousAutoClear;
			renderer.setClearColor( this.previousClearColor, previousClearAlpha );
			renderer.setViewport( this.previousViewport );
			renderer.setScissor( this.previousScissor );
			renderer.setScissorTest( previousScissorTest );
			this.renderScene.overrideMaterial = previousOverrideMaterial;
		}

	}

	getDiagnostics(): Record<string, string | number | boolean> {

		const proxyBounds = this.renderModel === null ? null : new THREE.Box3().setFromObject( this.renderModel );
		const proxyNdc = proxyBounds === null || proxyBounds.isEmpty() ? null : projectBoxToNdc( proxyBounds, this.camera );
		const matrixError = this.sourceModel === null || this.renderModel === null ? -1 : this.sourceModel.matrixWorld.elements.reduce( ( max, value, index ) => Math.max( max, Math.abs( value - this.renderModel!.matrixWorld.elements[ index ] ) ), 0 );
		return {
			portalState: this.state,
			portalFailureReason: this.failureReason || 'none',
			portalWaitingReason: this.waitingReason || 'none',
			lastPortalAttemptId: this.attemptId,
			debugMode: PORTAL_DEBUG_MODE,
			surfaceVisible: this.surface?.visible === true,
			dirty: this.portalDirty,
			offscreenRenderingRequired: PORTAL_DEBUG_MODE !== 'surface',
			offscreenRenderingSkippedReason: PORTAL_DEBUG_MODE === 'surface' ? 'surface-debug-mode' : 'none',
			offscreenState: this.offscreenState,
			contentDirty: this.contentDirty,
			offscreenRevision: this.offscreenRevision,
			lastRenderedRevision: this.lastRenderedRevision,
			lastOffscreenFailureReason: this.lastOffscreenFailureReason || 'none',
			proxyState: this.proxyState,
			proxySourceUuid: this.renderModel?.userData.__portalSourceRootId ?? 'none',
			activeSourceUuid: this.sourceModel?.uuid ?? 'none',
			proxyAttachedToRenderScene: this.renderModel?.parent === this.renderScene,
			proxyBuildAttemptCount: this.proxyBuildAttemptCount,
			proxyBuildSuccessCount: this.proxyBuildSuccessCount,
			lastProxyBuildFailureReason: this.lastProxyBuildFailureReason || 'none',
			renderProxyExists: this.renderModel !== null,
			proxyStructuralRenderableCount: this.countStructuralRenderableMeshes(),
			proxyVisibleRenderableCount: this.countVisibleRenderableMeshes(),
			...this.proxyBuildStats,
			renderProxyVisible: this.renderModel?.visible === true,
			sourceStructuralRenderableCount: this.countRenderableMeshes( this.sourceModel, false ),
			sourceVisibleRenderableCount: this.countRenderableMeshes( this.sourceModel, true ),
			renderProxyParentPath: this.renderModel?.parent?.name || this.renderModel?.parent?.type || 'none',
			matrixWorldMaxAbsError: matrixError,
			portalModelNdcBounds: proxyNdc === null ? 'none' : JSON.stringify( proxyNdc ),
			modelIntersectsCameraFootprint: proxyNdc !== null && !( proxyNdc.right < -1 || proxyNdc.left > 1 || proxyNdc.top < -1 || proxyNdc.bottom > 1 ),
			redrawCount: this.redrawCount,
			lastRedrawTimestamp: Math.round( this.lastRedrawTimestamp ),
			renderTarget: this.renderTarget === null ? 'none' : `${this.renderTarget.width}x${this.renderTarget.height}`,
			msaaSamples: this.renderTarget?.samples ?? 0,
			foregroundThresholdMeters: PORTAL_FOREGROUND_THRESHOLD_METERS,
			depthFeatherMeters: PORTAL_DEPTH_FEATHER_METERS,
			portalBackgroundAlpha: PORTAL_BACKGROUND_ALPHA,
			portalBackgroundColor: `#${PORTAL_BACKGROUND_COLOR.getHexString()}`,
			cpuDepthOcclusionEnabled: this.cpuDepthDiagnostics.enabled,
			depthFrameAvailable: this.cpuDepthDiagnostics.available,
			depthFrameStale: this.cpuDepthDiagnostics.stale,
			depthTextureWidth: this.cpuDepthDiagnostics.width,
			depthTextureHeight: this.cpuDepthDiagnostics.height,
			rawValueToMeters: this.cpuDepthDiagnostics.rawValueToMeters,
			maxPortalCornerDriftMeters: this.getMaxPortalCornerDrift(),
			maxSourceCornerNdcError: this.maxSourceCornerNdcError,
			geometryCalibrationState: this.geometryCalibrationState,
			sourceCornerIds: JSON.stringify( this.sourceCornerIds ),
			originalCornerIds: JSON.stringify( this.originalCornerIds ),
			normalizedCornerIds: JSON.stringify( this.sourceCornerIds ),
			windingBefore: this.windingBefore,
			windingAfter: 'counter-clockwise',
			windingWasReversed: this.windingWasReversed,
			sourceCornerNdc: JSON.stringify( this.sourceCornerNdc.map( ( point ) => [ point.x, point.y ] ) ),
			expectedSourceCornerNdc: JSON.stringify( [ [ -1, -1 ], [ 1, -1 ], [ 1, 1 ], [ -1, 1 ] ] ),
			renderTargetCreationAttemptCount: this.renderTargetCreationAttemptCount,
			lastRenderTargetCreationError: this.lastRenderTargetCreationError || 'none',
			lastFrameError: this.lastFrameError || 'none'
		};

	}

	private markContentDirty(): void {

		this.contentDirty = true;
		this.offscreenRevision += 1;
		if ( PORTAL_DEBUG_MODE !== 'surface' ) this.offscreenState = 'pending';

	}

	private calibrationFailed(reason: string): string {

		this.geometryCalibrationState = 'failed';
		return reason;

	}

	private hasCornerChanges(sourceCorners: THREE.Vector3[], targetCorners: THREE.Vector3[]): boolean {

		let changed = false;
		for ( const [ group, corners ] of [ [ 0, sourceCorners ], [ 1, targetCorners ] ] as const ) for ( let index = 0; index < 4; index += 1 ) {
			const point = corners[ index ];
			const offset = group * 12 + index * 3;
			const x = Math.fround( point.x );
			const y = Math.fround( point.y );
			const z = Math.fround( point.z );
			if ( this.cornerValues[ offset ] !== x || this.cornerValues[ offset + 1 ] !== y || this.cornerValues[ offset + 2 ] !== z ) changed = true;
		}
		return changed;

	}

	private commitCornerCache(sourceCorners: THREE.Vector3[], targetCorners: THREE.Vector3[]): void {

		for ( const [ group, corners ] of [ [ 0, sourceCorners ], [ 1, targetCorners ] ] as const ) for ( let index = 0; index < 4; index += 1 ) {
			const offset = group * 12 + index * 3;
			this.cornerValues[ offset ] = Math.fround( corners[ index ].x );
			this.cornerValues[ offset + 1 ] = Math.fround( corners[ index ].y );
			this.cornerValues[ offset + 2 ] = Math.fround( corners[ index ].z );
		}

	}

	private getMaxPortalCornerDrift(): number {

		const position = this.surface?.geometry.getAttribute( 'position' );
		if ( position === undefined || position === null ) return -1;
		let maxDrift = 0;
		for ( const [ cornerIndex, vertexIndex ] of [ [ 0, 0 ], [ 1, 1 ], [ 2, 2 ], [ 3, 5 ] ] ) {
			const offset = 12 + cornerIndex * 3;
			const dx = position.getX( vertexIndex ) - this.normal.x * PORTAL_SURFACE_LIFT_METERS - this.cornerValues[ offset ];
			const dy = position.getY( vertexIndex ) - this.normal.y * PORTAL_SURFACE_LIFT_METERS - this.cornerValues[ offset + 1 ];
			const dz = position.getZ( vertexIndex ) - this.normal.z * PORTAL_SURFACE_LIFT_METERS - this.cornerValues[ offset + 2 ];
			maxDrift = Math.max( maxDrift, Math.hypot( dx, dy, dz ) );
		}
		return maxDrift;

	}

	private copyChangedMatrix(elements: ArrayLike<number>): boolean {

		let changed = false;
		for ( let index = 0; index < 16; index += 1 ) {
			const value = Math.fround( elements[ index ] );
			if ( this.modelMatrixValues[ index ] !== value ) changed = true;
			this.modelMatrixValues[ index ] = value;
		}
		return changed;

	}

}

function isRenderablePortalMesh(object: THREE.Object3D): object is THREE.Mesh {

	return object instanceof THREE.Mesh
		&& object.userData.__nonSelectableHelper !== true
		&& object.userData.__visualizationHelper !== true
		&& object.geometry?.getAttribute( 'position' ) !== undefined
		&& object.material !== undefined;

}

function countRenderableMeshesIn(root: THREE.Object3D): number {

	let count = 0;
	root.traverse( ( object ) => { if ( isRenderablePortalMesh( object ) ) count += 1; } );
	return count;

}

function validateCorners(corners: THREE.Vector3[]): { ok: true; value: THREE.Vector3[] } | { ok: false; reason: string } {

	if ( corners.length !== 4 ) return { ok: false, reason: 'missing-control-points' };
	if ( corners.some( ( point ) => [ point.x, point.y, point.z ].some( ( value ) => Number.isFinite( value ) === false ) ) ) return { ok: false, reason: 'non-finite-corners' };
	for ( let first = 0; first < 4; first += 1 ) for ( let second = first + 1; second < 4; second += 1 ) {
		if ( corners[ first ].distanceToSquared( corners[ second ] ) < 1e-6 ) return { ok: false, reason: 'duplicate-corners' };
	}
	const normal = new THREE.Vector3().crossVectors( new THREE.Vector3().subVectors( corners[ 1 ], corners[ 0 ] ), new THREE.Vector3().subVectors( corners[ 3 ], corners[ 0 ] ) );
	if ( normal.lengthSq() < 1e-8 ) return { ok: false, reason: 'invalid-normal' };
	normal.normalize();
	if ( corners[ 1 ].distanceTo( corners[ 0 ] ) < 0.01 || corners[ 3 ].distanceTo( corners[ 0 ] ) < 0.01 ) return { ok: false, reason: 'degenerate-footprint' };
	return { ok: true, value: corners };

}

function projectBoxToNdc(box: THREE.Box3, camera: THREE.Camera): { left: number; right: number; bottom: number; top: number; near: number; far: number } {

	const result = { left: Infinity, right: -Infinity, bottom: Infinity, top: -Infinity, near: Infinity, far: -Infinity };
	for ( const x of [ box.min.x, box.max.x ] ) for ( const y of [ box.min.y, box.max.y ] ) for ( const z of [ box.min.z, box.max.z ] ) {
		const point = new THREE.Vector3( x, y, z ).project( camera );
		result.left = Math.min( result.left, point.x );
		result.right = Math.max( result.right, point.x );
		result.bottom = Math.min( result.bottom, point.y );
		result.top = Math.max( result.top, point.y );
		result.near = Math.min( result.near, point.z );
		result.far = Math.max( result.far, point.z );
	}
	return result;

}

function vectorToObject(vector: THREE.Vector3): { x: number; y: number; z: number } {

	return { x: vector.x, y: vector.y, z: vector.z };

}

function readPortalNumber(name: string, fallback: number): number {

	if ( import.meta.env.DEV === false ) return fallback;
	const value = Number( new URLSearchParams( window.location.search ).get( name ) );
	return Number.isFinite( value ) && value >= 0 ? value : fallback;

}

function readPortalColor(name: string, fallback: number): number {

	if ( typeof window === 'undefined' ) return fallback;
	const value = new URLSearchParams( window.location.search ).get( name )?.replace( '#', '' ) ?? '';
	return /^[0-9a-fA-F]{6}$/.test( value ) ? Number.parseInt( value, 16 ) : fallback;

}

function readPortalFlag(name: string): boolean {

	return typeof window !== 'undefined' && new URLSearchParams( window.location.search ).get( name ) === '1';

}

function readPortalDebugMode(): 'surface' | 'texture' | 'full' {

	if ( typeof window === 'undefined' ) return 'full';
	const mode = new URLSearchParams( window.location.search ).get( 'portalDebug' );
	return mode === 'surface' || mode === 'texture' ? mode : 'full';

}
