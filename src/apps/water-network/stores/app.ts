import { defineStore } from 'pinia';
import { waterNetworkProjectConfig } from '../project-config.js';

export const useWaterNetworkAppStore = defineStore( 'water-network-app', {
	state: () => ( { selectedSiteId: waterNetworkProjectConfig.ui.sites[ 0 ]?.id ?? '' } )
} );
