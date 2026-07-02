<script setup lang="ts">
import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';

interface TabItem {
	key: string;
	label: string;
	path: string;
	icon: string;
}

const TEXT = {
	navLabel: '\u4e3b\u5bfc\u822a',
	home: '\u9996\u9875',
	ar: 'AR\u5de1\u67e5',
	map: '\u5730\u56fe',
	records: '\u8bb0\u5f55',
	profile: '\u6211\u7684'
} as const;

const route = useRoute();
const router = useRouter();

const tabs: TabItem[] = [
	{ key: 'home', label: TEXT.home, path: '/', icon: '\u2302' },
	{ key: 'ar', label: TEXT.ar, path: '/ar', icon: 'AR' },
	{ key: 'map', label: TEXT.map, path: '/map', icon: '\u25eb' },
	{ key: 'records', label: TEXT.records, path: '/records', icon: '\u2630' },
	{ key: 'profile', label: TEXT.profile, path: '/profile', icon: '\u25c9' }
];

const activePath = computed( () => {
	const matched = tabs.find( ( item ) => route.path === item.path || route.path.startsWith( `${item.path}/` ) );
	return matched?.path ?? '/';
} );

function navigate(path: string): void {

	if ( route.path === path ) {
		return;
	}

	void router.push( path );

}
</script>

<template>
	<nav class="app-tabbar" :aria-label="TEXT.navLabel">
		<button
			v-for="tab in tabs"
			:key="tab.key"
			type="button"
			class="app-tabbar-item"
			:class="{ active: activePath === tab.path, accent: tab.key === 'ar' }"
			@click="navigate(tab.path)"
		>
			<span class="app-tabbar-icon">{{ tab.icon }}</span>
			<span class="app-tabbar-label">{{ tab.label }}</span>
		</button>
	</nav>
</template>

<style scoped>
.app-tabbar {
	position: fixed;
	left: 0;
	right: 0;
	bottom: 0;
	display: grid;
	grid-template-columns: repeat(5, minmax(0, 1fr));
	align-items: end;
	padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
	background: rgba(6, 11, 20, 0.94);
	backdrop-filter: blur(16px);
	border-top: 1px solid rgba(255, 255, 255, 0.08);
	box-shadow: 0 -10px 28px rgba(0, 0, 0, 0.28);
	z-index: 60;
}

.app-tabbar-item {
	display: flex;
	flex-direction: column;
	align-items: center;
	justify-content: center;
	gap: 4px;
	min-height: 52px;
	border: 0;
	background: transparent;
	color: rgba(220, 231, 255, 0.66);
	font-size: 11px;
	font-weight: 600;
	padding: 4px 2px;
}

.app-tabbar-item.accent .app-tabbar-icon {
	font-size: 14px;
	font-weight: 800;
	letter-spacing: 0.02em;
}

.app-tabbar-item.active {
	color: #33c7ff;
}

.app-tabbar-item.active .app-tabbar-icon {
	background: linear-gradient(180deg, rgba(47, 186, 255, 0.24), rgba(31, 115, 255, 0.14));
	border-color: rgba(69, 208, 255, 0.28);
	box-shadow: 0 0 18px rgba(0, 193, 255, 0.16);
}

.app-tabbar-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	border-radius: 10px;
	border: 1px solid rgba(255, 255, 255, 0.06);
	background: rgba(255, 255, 255, 0.03);
	font-size: 13px;
	line-height: 1;
}

.app-tabbar-label {
	line-height: 1.1;
	white-space: nowrap;
}
</style>
