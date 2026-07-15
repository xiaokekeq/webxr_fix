import * as THREE from 'three';
import type { ArFromEnuSolution } from '@/localization/core/ar-from-enu-solution.js';
import type { EnuPoint } from '@/engine/annotation/annotation-types.js';

export class ArCoordinateService {

	private solution: ArFromEnuSolution | null = null;
	private sessionId: string | null = null;

	setArFromEnuSolution(solution: ArFromEnuSolution | null, sessionId?: string | null): void {

		this.solution = solution;
		this.sessionId = sessionId ?? solution?.sessionId ?? null;

	}

	clear(): void {

		this.solution = null;
		this.sessionId = null;

	}

	hasCalibration(): boolean {

		return this.solution !== null;

	}

	getCurrentSolution(): ArFromEnuSolution | null {

		return this.solution;

	}

	enuToAr(point: EnuPoint, target = new THREE.Vector3()): THREE.Vector3 | null {

		if ( this.solution === null ) {
			return null;
		}

		return target
			.set( point.east, point.north, point.up )
			.applyMatrix4( this.solution.matrix );

	}

	enuVectorToAr(vector: EnuPoint, target = new THREE.Vector3()): THREE.Vector3 | null {

		if ( this.solution === null ) {
			return null;
		}

		return target
			.set( vector.east, vector.north, vector.up )
			.applyMatrix3( new THREE.Matrix3().setFromMatrix4( this.solution.matrix ) );

	}

}
