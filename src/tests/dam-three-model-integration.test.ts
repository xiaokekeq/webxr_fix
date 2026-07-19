import { describe, expect, it } from 'vitest';
import configText from '../../public/projects/dam/configs/dz1207.config.json?raw';
import pipeText from '../../public/projects/dam/properties/dz1207.pipes.json?raw';
import primaryObjText from '../../public/projects/dam/models/zu02/zu02.obj?raw';
import { solveEngineeringRegistration } from '@/localization/coarse/engineering-registration.js';
import {
	normalizeDemoModelConfig,
	type RawDemoModelConfig
} from '@/models/config/demo-model-config.js';
import type { PipeRecord } from '@/models/types/pipe-record.js';

describe( 'DAM three-model integration data', () => {

	it( 'matches zu02 layers and keeps surveyed registration below the configured tolerance', () => {

		const config = normalizeDemoModelConfig( JSON.parse( configText ) as RawDemoModelConfig );
		const solution = solveEngineeringRegistration( config );
		const pipes = ( JSON.parse( pipeText ) as { pipes: PipeRecord[] } ).pipes;
		const objectNames = [ ...primaryObjText.matchAll( /^o\s+(.+)$/gm ) ].map( ( match ) => match[ 1 ].trim() );

		expect( new Set( pipes.map( ( pipe ) => pipe.name ) ) ).toEqual( new Set( objectNames ) );
		expect( solution.modelToSite.rmsErrorMeters ).toBeLessThan( config.markerCalibration?.maxSelfCheckErrorMeters ?? 0 );
		expect( config.markers[ 0 ]?.cornersEnu ).toHaveLength( 4 );

	} );

} );
