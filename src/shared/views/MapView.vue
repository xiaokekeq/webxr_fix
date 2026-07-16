<script setup lang="ts">
import { onMounted, ref } from 'vue';
import AppTabBar from '@/shared/components/AppTabBar.vue';
import { useMap } from '@/composables/useMap.js';
import { useProjectUi } from '@/shared/config/project-config.js';

const { ui } = useProjectUi();
const mapRef = ref<HTMLElement | null>( null );
const { initMap, setMarkers, drawRoute, locateUser } = useMap( mapRef );

function handleLocate(): void {
	void locateUser().catch( () => undefined );
}

function setupMap(): void {
	const center = ui.value.sites[ 0 ];
	initMap( [ center.lng, center.lat ], ui.value.map.zoom );
	setMarkers( ui.value.map.markers );
	drawRoute( { path: ui.value.map.route, color: '#00d4ff' } );
}

onMounted( () => {
	if ( ( window as { AMap?: unknown } ).AMap !== undefined ) {
		setupMap();
		return;
	}
	const script = document.createElement( 'script' );
	script.src = `https://webapi.amap.com/maps?v=2.0&key=${import.meta.env.VITE_AMAP_KEY || ''}`;
	script.onload = setupMap;
	document.head.appendChild( script );
} );
</script>

<template>
	<main class="map-page">
		<div ref="mapRef" class="map-wrapper"></div>
		<section class="map-panel"><strong>{{ ui.map.title }}</strong><span>{{ ui.sites[0].name }}</span></section>
		<section class="map-legend"><div v-for="item in ui.map.legend" :key="item.type" class="legend-item"><i :class="item.type"></i>{{ item.label }}</div></section>
		<button class="map-locate" type="button" aria-label="定位" @click="handleLocate"><van-icon name="aim" size="20" /></button>
	</main>
	<AppTabBar />
</template>

<style scoped>
.map-page { position:relative; width:100%; height:100vh; overflow:hidden; background:#0a0e17; }.map-wrapper { width:100%; height:100%; }.map-panel, .map-legend { position:fixed; z-index:10; border:1px solid var(--border); border-radius:10px; background:rgba(10,14,23,.9); backdrop-filter:blur(10px); }.map-panel { top:14px; left:14px; display:grid; gap:3px; padding:10px 12px; }.map-panel strong { font-size:14px; }.map-panel span, .legend-item { color:var(--text-secondary); font-size:11px; }.map-legend { top:14px; right:14px; display:grid; gap:7px; padding:10px; }.legend-item { display:flex; align-items:center; gap:6px; }.legend-item i { width:8px; height:8px; border-radius:50%; background:var(--primary); }.legend-item i.risk { background:var(--danger); }.legend-item i.station { background:var(--accent); }.map-locate { position:fixed; right:16px; bottom:92px; z-index:10; display:grid; width:42px; height:42px; place-items:center; border:1px solid var(--border-active); border-radius:50%; background:var(--bg-card); color:var(--primary); }
</style>
