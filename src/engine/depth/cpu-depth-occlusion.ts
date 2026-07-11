import * as THREE from 'three';
import type { CpuDepthFrame } from './real-depth-provider.js';

export interface CpuDepthOcclusionUniforms {
	[ key: string ]: THREE.IUniform;
	uDepthOcclusionEnabled: { value: boolean };
	uRealDepthTexture: { value: THREE.DataTexture | null };
	uRawValueToMeters: { value: number };
	uNormDepthBufferFromNormView: { value: THREE.Matrix4 };
	uDepthBiasMeters: { value: number };
}

export function createCpuDepthOcclusionUniforms(): CpuDepthOcclusionUniforms {

	return {
		uDepthOcclusionEnabled: { value: false },
		uRealDepthTexture: { value: null },
		uRawValueToMeters: { value: 0 },
		uNormDepthBufferFromNormView: { value: new THREE.Matrix4() },
		uDepthBiasMeters: { value: 0.04 }
	};

}

export function syncCpuDepthOcclusionUniforms(
	uniforms: CpuDepthOcclusionUniforms,
	frame: CpuDepthFrame
): void {

	uniforms.uDepthOcclusionEnabled.value = frame.available
		&& frame.stale === false
		&& frame.texture !== null
		&& frame.normDepthBufferFromNormView !== null;
	uniforms.uRealDepthTexture.value = frame.texture;
	uniforms.uRawValueToMeters.value = frame.rawValueToMeters;
	if ( frame.normDepthBufferFromNormView !== null ) {
		uniforms.uNormDepthBufferFromNormView.value.copy( frame.normDepthBufferFromNormView );
	}

}
