import * as THREE from 'three';
import {
	createEnuFrame,
	ecefToEnu as ecefToEnuWithFrame,
	enuToEcef as enuToEcefWithFrame,
	enuToGeodetic as enuToGeodeticWithFrame,
	geodeticToEcef as geodeticToEcefCore,
	geodeticToEnu as geodeticToEnuWithFrame,
	type GeodeticCoordinate
} from '@/localization/core/geodesy.js';

export type GeodeticPosition = GeodeticCoordinate;

export function geodeticToEcef(
	position: GeodeticPosition,
	target = new THREE.Vector3()
): THREE.Vector3 {

	return target.copy( geodeticToEcefCore( position ) );

}

export function ecefToEnu(
	ecef: THREE.Vector3,
	origin: GeodeticPosition,
	target = new THREE.Vector3()
): THREE.Vector3 {

	return ecefToEnuWithFrame( ecef, createEnuFrame( origin ), target );

}

export function geodeticToEnu(
	position: GeodeticPosition,
	origin: GeodeticPosition,
	target = new THREE.Vector3()
): THREE.Vector3 {

	return geodeticToEnuWithFrame( position, createEnuFrame( origin ), target );

}

export function enuToEcef(
	enu: THREE.Vector3,
	origin: GeodeticPosition,
	target = new THREE.Vector3()
): THREE.Vector3 {

	return enuToEcefWithFrame( enu, createEnuFrame( origin ), target );

}

export function enuToGeodetic(
	enu: THREE.Vector3,
	origin: GeodeticPosition
): GeodeticPosition {

	return enuToGeodeticWithFrame( enu, createEnuFrame( origin ) );

}
