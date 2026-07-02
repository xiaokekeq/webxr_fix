import { formatManualPositionSummary, normalizeSignedDegrees } from '@/features/ar/utils/formatters.js';
import type {
	RegistrationStore
} from '@/localization/core/registration-store.js';
import type { ManualRegistrationState } from '@/localization/manual/manual-registration.js';

interface CreateManualReadoutSyncOptions {
	store: RegistrationStore;
}

export interface ManualReadoutSync {
	update(state: ManualRegistrationState): void;
}

export function createManualReadoutSync(options: CreateManualReadoutSyncOptions): ManualReadoutSync {

	const { store } = options;

	return {
		update(state) {

			store.patch( {
				manualReadout: {
					positionText: formatManualPositionSummary( state.offset ),
					yawText: `${normalizeSignedDegrees( state.yawDeg ).toFixed( 0 )}deg`,
					scaleText: `${state.scaleMultiplier.toFixed( 3 )}x`
				}
			} );

		}
	};

}









