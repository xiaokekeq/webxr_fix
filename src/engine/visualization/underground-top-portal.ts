import * as THREE from 'three';
import {
	createCpuDepthOcclusionUniforms,
	syncCpuDepthOcclusionUniforms,
	type CpuDepthOcclusionUniforms
} from '@/engine/depth/cpu-depth-occlusion.js';
import type { CpuDepthFrame } from '@/engine/depth/real-depth-provider.js';
import { isArDebugEnabled } from '@/engine/debug/ar-logger.js';

const PORTAL_SURFACE_NAME = '__underground-top-portal-surface';
const PORTAL_RENDER_ORDER = 40;
const PORTAL_SURFACE_LIFT_METERS = 0.002;
const PORTAL_MAX_RESOLUTION = 1024;
const PORTAL_MIN_RESOLUTION = 384;
const PORTAL_FOREGROUND_THRESHOLD_METERS = readPortalNumber( 'portalThreshold', 0.05 );
const PORTAL_DEPTH_FEATHER_METERS = readPortalNumber( 'portalFeather', 0.025 );
const PORTAL_BACKGROUND_ALPHA = THREE.MathUtils.clamp( readPortalNumber( 'portalBackgroundAlpha', 0.9 ), 0.85, 1 );
const PORTAL_DEBUG_MODE = readPortalDebugMode();

export type PortalState = 'idle' | 'initializing' | 'surface-ready' | 'content-ready' | 'ready' | 'failed';

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
  vec3 portalBackground = vec3(0.025, 0.055, 0.08);
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
	private readonly sourceObjects = new Map<string, THREE.Object3D>();
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
	private readonly cornerValues = new Float32Array( 12 );
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
		uDebugMode: { value: number };
	} | null = null;
	private portalDirty = true;
	private redrawCount = 0;
	private lastRedrawTimestamp = 0;
	private lastFrameError = '';
	private state: PortalState = 'idle';
	private failureReason = '';
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
		model: THREE.Object3D | null;
		footprintCorners: THREE.Vector3[];
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
		if ( args.model === null ) return this.fail( 'missing-model' );
		const corners = validateAndOrderCorners( args.footprintCorners );
		if ( corners.ok === false ) return this.fail( corners.reason );

		this.setSourceModel( args.model );
		this.updateGeometry( args.renderer, corners.value );
		this.syncModelMatrix();
		if ( this.ensureSurface() === false && PORTAL_DEBUG_MODE !== 'surface' ) {
			return this.fail( this.renderTarget === null ? 'render-target-unavailable' : 'surface-unavailable' );
		}
		if ( this.surface === null || this.uniforms === null ) return this.fail( 'surface-unavailable' );
		this.setState( 'surface-ready' );
		syncCpuDepthOcclusionUniforms( this.uniforms!, args.depthFrame );
		if ( PORTAL_DEBUG_MODE !== 'full' || ( isArDebugEnabled() && readPortalFlag( 'portalDisableCpuDepth' ) ) ) this.uniforms!.uDepthOcclusionEnabled.value = false;
		this.sourceModel!.visible = false;
		this.surface!.visible = true;
		if ( this.portalDirty ) {
			this.syncRenderModelState();
			if ( PORTAL_DEBUG_MODE !== 'surface' && this.countRenderableMeshes() === 0 ) return this.fail( 'no-renderable-meshes' );
			this.setState( 'content-ready' );
			this.logDirtyDiagnostics( corners.value, args.mainCamera );
			if ( PORTAL_DEBUG_MODE !== 'surface' ) this.render( args.renderer );
			else this.portalDirty = false;
		}
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
		const sourceId = modelHit?.object.userData.__portalSourceObjectId;
		return {
			hitPortal: true,
			sourceObject: typeof sourceId === 'string' ? this.sourceObjects.get( sourceId ) ?? null : null
		};

	}

	markDirty(): void {

		this.portalDirty = true;

	}

	beginAttempt(): void {

		this.attemptId += 1;
		this.setState( 'initializing' );
		this.portalDirty = true;

	}

	reset(): void {

		this.restoreSourceVisibility();
		this.sourceModel = null;
		this.renderModel?.removeFromParent();
		this.renderModel = null;
		this.sourceObjects.clear();
		this.surface?.removeFromParent();
		this.surface?.geometry.dispose();
		this.surface?.material.dispose();
		this.surface = null;
		this.renderTarget?.dispose();
		this.renderTarget = null;
		this.uniforms = null;
		this.cornerValues.fill( Number.NaN );
		this.modelMatrixValues.fill( Number.NaN );
		this.portalDirty = true;
		this.state = 'idle';
		this.failureReason = '';

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
		return state;

	}

	private fail(reason: string): PortalState {

		this.failureReason = reason;
		this.hide();
		return this.setState( 'failed' );

	}

	private setSourceModel(model: THREE.Object3D): void {

		if ( this.sourceModel === model ) return;
		this.restoreSourceVisibility();
		this.sourceModel = model;
		this.sourceModelWasVisible = model.visible;
		this.rebuildRenderModel();

	}

	private restoreSourceVisibility(): void {

		if ( this.sourceModel !== null ) this.sourceModel.visible = this.sourceModelWasVisible;

	}

	private rebuildRenderModel(): void {

		this.renderModel?.removeFromParent();
		this.sourceObjects.clear();
		if ( this.sourceModel === null ) return;
		// This renderProxy shares the source model's geometry/material resources. It is only
		// rendered into the Portal target and is never attached to the main XR scene.
		this.renderModel = this.sourceModel.clone( true );
		this.renderModel.visible = true;
		this.renderModel.name = '__underground-top-portal-render-proxy';
		const sourceNodes: THREE.Object3D[] = [];
		const renderNodes: THREE.Object3D[] = [];
		this.sourceModel.traverse( ( object ) => sourceNodes.push( object ) );
		this.renderModel.traverse( ( object ) => renderNodes.push( object ) );
		for ( let index = 0; index < Math.min( sourceNodes.length, renderNodes.length ); index += 1 ) {
			const source = sourceNodes[ index ];
			const render = renderNodes[ index ];
			this.sourceObjects.set( source.uuid, source );
			render.userData.__portalSourceObjectId = source.uuid;
			if (
				index > 0
				&& ( source.userData.__nonSelectableHelper === true || source instanceof THREE.Sprite )
			) render.visible = false;
		}
		this.renderModel.matrixAutoUpdate = false;
		this.renderScene.add( this.renderModel );
		this.modelMatrixValues.fill( Number.NaN );
		this.portalDirty = true;

	}

	private updateGeometry(renderer: THREE.WebGLRenderer, corners: THREE.Vector3[]): void {

		if ( this.copyChangedCorners( corners ) === false ) return;
		const [ p0, p1, p2, p3 ] = corners;
		this.axisU.copy( p1 ).sub( p0 ).normalize();
		this.axisV.copy( p3 ).sub( p0 ).normalize();
		this.normal.crossVectors( this.axisU, this.axisV ).normalize();
		if ( this.normal.dot( this.worldUp ) < 0 ) this.normal.negate();
		this.center.copy( p0 ).add( p1 ).add( p2 ).add( p3 ).multiplyScalar( 0.25 );
		const width = 0.5 * ( p0.distanceTo( p1 ) + p3.distanceTo( p2 ) );
		const height = 0.5 * ( p0.distanceTo( p3 ) + p1.distanceTo( p2 ) );
		this.camera.left = - width / 2;
		this.camera.right = width / 2;
		this.camera.top = height / 2;
		this.camera.bottom = - height / 2;
		this.camera.position.copy( this.center ).addScaledVector( this.normal, 1 );
		this.camera.up.copy( this.axisV );
		this.lookAtTarget.copy( this.center ).addScaledVector( this.normal, -1 );
		this.camera.lookAt( this.lookAtTarget );
		this.camera.updateProjectionMatrix();
		this.camera.updateMatrixWorld( true );

		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute( 'position', new THREE.Float32BufferAttribute( [
			p0.x + this.normal.x * PORTAL_SURFACE_LIFT_METERS, p0.y + this.normal.y * PORTAL_SURFACE_LIFT_METERS, p0.z + this.normal.z * PORTAL_SURFACE_LIFT_METERS,
			p1.x + this.normal.x * PORTAL_SURFACE_LIFT_METERS, p1.y + this.normal.y * PORTAL_SURFACE_LIFT_METERS, p1.z + this.normal.z * PORTAL_SURFACE_LIFT_METERS,
			p2.x + this.normal.x * PORTAL_SURFACE_LIFT_METERS, p2.y + this.normal.y * PORTAL_SURFACE_LIFT_METERS, p2.z + this.normal.z * PORTAL_SURFACE_LIFT_METERS,
			p0.x + this.normal.x * PORTAL_SURFACE_LIFT_METERS, p0.y + this.normal.y * PORTAL_SURFACE_LIFT_METERS, p0.z + this.normal.z * PORTAL_SURFACE_LIFT_METERS,
			p2.x + this.normal.x * PORTAL_SURFACE_LIFT_METERS, p2.y + this.normal.y * PORTAL_SURFACE_LIFT_METERS, p2.z + this.normal.z * PORTAL_SURFACE_LIFT_METERS,
			p3.x + this.normal.x * PORTAL_SURFACE_LIFT_METERS, p3.y + this.normal.y * PORTAL_SURFACE_LIFT_METERS, p3.z + this.normal.z * PORTAL_SURFACE_LIFT_METERS
		], 3 ) );
		geometry.setAttribute( 'uv', new THREE.Float32BufferAttribute( [ 0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1 ], 2 ) );
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
		this.resizeRenderTarget( renderer, width, height );
		this.portalDirty = true;

	}

	private createMaterial(): THREE.ShaderMaterial {

		this.uniforms = Object.assign( createCpuDepthOcclusionUniforms(), {
			uPortalColorTexture: { value: this.renderTarget?.texture ?? null },
			uForegroundThresholdMeters: { value: PORTAL_FOREGROUND_THRESHOLD_METERS },
			uDepthFeatherMeters: { value: PORTAL_DEPTH_FEATHER_METERS },
			uPortalBackgroundAlpha: { value: PORTAL_BACKGROUND_ALPHA },
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

	private resizeRenderTarget(renderer: THREE.WebGLRenderer, width: number, height: number): void {

		const maxSize = Math.min( PORTAL_MAX_RESOLUTION, renderer.capabilities.maxTextureSize );
		let targetWidth = maxSize;
		let targetHeight = Math.round( maxSize * height / width );
		if ( height > width ) {
			targetHeight = maxSize;
			targetWidth = Math.round( maxSize * width / height );
		}
		targetWidth = Math.min( maxSize, Math.max( PORTAL_MIN_RESOLUTION, targetWidth ) );
		targetHeight = Math.min( maxSize, Math.max( PORTAL_MIN_RESOLUTION, targetHeight ) );
		if ( this.renderTarget?.width === targetWidth && this.renderTarget.height === targetHeight ) return;
		const nextTarget = this.createRenderTarget( renderer, targetWidth, targetHeight );
		if ( nextTarget === null ) return;
		this.renderTarget?.dispose();
		this.renderTarget = nextTarget;
		if ( this.uniforms !== null ) this.uniforms.uPortalColorTexture.value = this.renderTarget.texture;
		this.portalDirty = true;

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
					const target = new THREE.WebGLRenderTarget( candidateWidth, candidateHeight, {
						format: THREE.RGBAFormat, type: THREE.UnsignedByteType, minFilter: THREE.LinearFilter,
						magFilter: THREE.LinearFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false
					} );
					target.samples = samples;
					return target;
				} catch ( error ) {
					this.lastFrameError = error instanceof Error ? error.message : String( error );
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
		this.renderModel.matrixWorld.copy( this.sourceModel.matrixWorld );
		this.renderModel.updateMatrixWorld( true );
		this.bounds.setFromObject( this.renderModel );
		this.bounds.getSize( this.boundsSize );
		this.bounds.getCenter( this.boundsCenter );
		this.camera.far = Math.max( 50, this.camera.position.distanceTo( this.boundsCenter ) + this.boundsSize.length() + 10 );
		this.camera.updateProjectionMatrix();
		this.portalDirty = true;

	}

	private syncRenderModelState(): void {

		if ( this.renderModel === null ) return;
		this.renderModel.visible = true;
		this.renderModel.traverse( ( renderObject ) => {
			if ( renderObject === this.renderModel ) return;
			const sourceId = renderObject.userData.__portalSourceObjectId;
			const source = typeof sourceId === 'string' ? this.sourceObjects.get( sourceId ) : undefined;
			if ( source === undefined ) return;
			renderObject.visible = source.userData.__nonSelectableHelper === true || source instanceof THREE.Sprite
				? false
				: source.visible;
			if ( source instanceof THREE.Mesh && renderObject instanceof THREE.Mesh ) {
				renderObject.material = source.material;
			}
		} );

	}

	private countRenderableMeshes(): number {

		let count = 0;
		this.renderModel?.traverseVisible( ( object ) => {
			if ( object instanceof THREE.Mesh && object.geometry?.getAttribute( 'position' ) !== undefined && object.material !== undefined ) count += 1;
		} );
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
			renderableVisibleMeshCount,
			renderTargetHasRenderableModel: renderableVisibleMeshCount > 0,
			surface: this.surface === null ? null : { visible: this.surface.visible, parent: this.surface.parent?.name || this.surface.parent?.type || 'none', layersMask: this.surface.layers.mask, cameraLayersMask: mainCamera.layers.mask, materialVisible: this.surface.material.visible, materialOpacity: this.surface.material.opacity, materialSide: this.surface.material.side, position: vectorToObject( this.surface.position ), scale: vectorToObject( this.surface.scale ), matrixWorld: this.surface.matrixWorld.toArray(), frustumCulled: this.surface.frustumCulled, inFrustum: frustum.intersectsObject( this.surface ) },
			cpuDepthOcclusionEnabled: this.uniforms?.uDepthOcclusionEnabled.value ?? false,
			result: outside ? 'Portal model is outside orthographic footprint.' : 'Portal model intersects orthographic footprint.'
		} );
		console.assert( this.renderModel.visible, 'Portal render proxy root must be visible.' );
		console.assert( renderableVisibleMeshCount > 0, 'Portal render proxy must contain renderable visible meshes.' );

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
		try {
			renderer.xr.enabled = false;
			renderer.autoClear = false;
			renderer.setRenderTarget( this.renderTarget );
			renderer.setViewport( 0, 0, this.renderTarget.width, this.renderTarget.height );
			renderer.setScissorTest( false );
			renderer.setClearColor( 0x000000, 0 );
			renderer.clear( true, true, true );
			renderer.render( this.renderScene, this.camera );
			this.portalDirty = false;
			this.redrawCount += 1;
			this.lastRedrawTimestamp = performance.now();
		} catch ( error ) {
			this.lastFrameError = error instanceof Error ? error.message : String( error );
			throw error;
		} finally {
			renderer.setRenderTarget( previousTarget );
			renderer.xr.enabled = previousXrEnabled;
			renderer.autoClear = previousAutoClear;
			renderer.setClearColor( this.previousClearColor, previousClearAlpha );
			renderer.setViewport( this.previousViewport );
			renderer.setScissor( this.previousScissor );
			renderer.setScissorTest( previousScissorTest );
		}

	}

	getDiagnostics(): Record<string, string | number | boolean> {

		return {
			portalState: this.state,
			portalFailureReason: this.failureReason || 'none',
			lastPortalAttemptId: this.attemptId,
			debugMode: PORTAL_DEBUG_MODE,
			surfaceVisible: this.surface?.visible === true,
			dirty: this.portalDirty,
			redrawCount: this.redrawCount,
			lastRedrawTimestamp: Math.round( this.lastRedrawTimestamp ),
			renderTarget: this.renderTarget === null ? 'none' : `${this.renderTarget.width}x${this.renderTarget.height}`,
			msaaSamples: this.renderTarget?.samples ?? 0,
			foregroundThresholdMeters: PORTAL_FOREGROUND_THRESHOLD_METERS,
			depthFeatherMeters: PORTAL_DEPTH_FEATHER_METERS,
			portalBackgroundAlpha: PORTAL_BACKGROUND_ALPHA,
			lastFrameError: this.lastFrameError || 'none'
		};

	}

	private copyChangedCorners(corners: THREE.Vector3[]): boolean {

		let changed = false;
		for ( let index = 0; index < 4; index += 1 ) {
			const point = corners[ index ];
			const offset = index * 3;
			const x = Math.fround( point.x );
			const y = Math.fround( point.y );
			const z = Math.fround( point.z );
			if ( this.cornerValues[ offset ] !== x || this.cornerValues[ offset + 1 ] !== y || this.cornerValues[ offset + 2 ] !== z ) changed = true;
			this.cornerValues[ offset ] = x;
			this.cornerValues[ offset + 1 ] = y;
			this.cornerValues[ offset + 2 ] = z;
		}
		return changed;

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

function validateAndOrderCorners(corners: THREE.Vector3[]): { ok: true; value: THREE.Vector3[] } | { ok: false; reason: string } {

	if ( corners.length !== 4 ) return { ok: false, reason: 'missing-control-points' };
	if ( corners.some( ( point ) => [ point.x, point.y, point.z ].some( ( value ) => Number.isFinite( value ) === false ) ) ) return { ok: false, reason: 'non-finite-corners' };
	for ( let first = 0; first < 4; first += 1 ) for ( let second = first + 1; second < 4; second += 1 ) {
		if ( corners[ first ].distanceToSquared( corners[ second ] ) < 1e-6 ) return { ok: false, reason: 'duplicate-corners' };
	}
	const center = corners.reduce( ( sum, point ) => sum.add( point ), new THREE.Vector3() ).multiplyScalar( 0.25 );
	const normal = new THREE.Vector3().crossVectors( new THREE.Vector3().subVectors( corners[ 1 ], corners[ 0 ] ), new THREE.Vector3().subVectors( corners[ 3 ], corners[ 0 ] ) );
	if ( normal.lengthSq() < 1e-8 ) return { ok: false, reason: 'invalid-normal' };
	normal.normalize();
	const axisU = new THREE.Vector3().subVectors( corners[ 1 ], corners[ 0 ] ).normalize();
	const axisV = new THREE.Vector3().crossVectors( normal, axisU ).normalize();
	const ordered = [ ...corners ].sort( ( a, b ) => Math.atan2( new THREE.Vector3().subVectors( a, center ).dot( axisV ), new THREE.Vector3().subVectors( a, center ).dot( axisU ) ) - Math.atan2( new THREE.Vector3().subVectors( b, center ).dot( axisV ), new THREE.Vector3().subVectors( b, center ).dot( axisU ) ) );
	let area = 0;
	for ( let index = 0; index < 4; index += 1 ) area += new THREE.Vector3().subVectors( ordered[ index ], center ).cross( new THREE.Vector3().subVectors( ordered[ ( index + 1 ) % 4 ], center ) ).length() * 0.5;
	if ( area < 1e-4 || ordered.some( ( point, index ) => point.distanceTo( ordered[ ( index + 1 ) % 4 ] ) < 0.01 ) ) return { ok: false, reason: 'degenerate-footprint' };
	return { ok: true, value: ordered };

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

function readPortalFlag(name: string): boolean {

	return typeof window !== 'undefined' && new URLSearchParams( window.location.search ).get( name ) === '1';

}

function readPortalDebugMode(): 'surface' | 'texture' | 'full' {

	if ( import.meta.env.DEV === false || typeof window === 'undefined' ) return 'full';
	const mode = new URLSearchParams( window.location.search ).get( 'portalDebug' );
	return mode === 'surface' || mode === 'texture' ? mode : 'full';

}
