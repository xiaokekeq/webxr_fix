<template>
	<div class="page">
		<van-nav-bar title="我的" fixed placeholder />

		<div class="profile-header card-glow">
			<div class="avatar">巡</div>
			<div class="profile-info">
				<div class="profile-name">张工</div>
				<div class="profile-role">巡检一班 · 负责人</div>
			</div>
		</div>

		<div class="profile-list">
			<div class="profile-item card" v-for="item in items" :key="item.label" @click="handleItemClick(item)">
				<span>{{ item.icon }}</span>
				<span class="pi-label">{{ item.label }}</span>
				<van-icon name="arrow" color="#556677" />
			</div>
		</div>

		<van-tabbar v-model="activeTab" route>
			<van-tabbar-item icon="home-o" to="/">首页</van-tabbar-item>
			<van-tabbar-item to="/ar">
				<template #icon><span class="tab-ar-icon">AR</span></template>
				AR巡查
			</van-tabbar-item>
			<van-tabbar-item icon="map-o" to="/map">地图</van-tabbar-item>
			<van-tabbar-item icon="todo-list-o" to="/records">记录</van-tabbar-item>
			<van-tabbar-item icon="user-o" to="/profile">我的</van-tabbar-item>
		</van-tabbar>
	</div>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useRouter } from 'vue-router';

const router = useRouter();
const activeTab = ref( 4 );

interface MenuItem {
	icon: string;
	label: string;
	route?: string;
}

const items: MenuItem[] = [
	{ icon: '人', label: '个人信息' },
	{ icon: '铃', label: '消息通知' },
	{ icon: '设', label: '系统设置' },
	{ icon: '册', label: '操作手册' },
	{ icon: '馈', label: '意见反馈' },
	{ icon: '准', label: '模型配准', route: '/model-calibration' }
];

function handleItemClick(item: MenuItem): void {
	if ( item.route ) {
		void router.push( item.route );
	}
}
</script>

<style scoped>
.profile-header {
	display: flex;
	align-items: center;
	gap: 14px;
	padding: 20px;
	margin-bottom: 14px;
}

.avatar {
	width: 52px;
	height: 52px;
	border-radius: 26px;
	background: rgba(0, 212, 255, 0.1);
	border: 2px solid var(--border);
	display: flex;
	align-items: center;
	justify-content: center;
	font-size: 20px;
	font-weight: 700;
}

.profile-name {
	font-size: 18px;
	font-weight: 600;
}

.profile-role {
	font-size: 12px;
	color: var(--text-secondary);
	margin-top: 4px;
}

.profile-list {
	display: flex;
	flex-direction: column;
	gap: 8px;
}

.profile-item {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 16px;
	cursor: pointer;
	font-size: 14px;
}

.pi-label {
	flex: 1;
}

.tab-ar-icon {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	font-size: 10px;
	font-weight: 700;
	line-height: 1;
	color: var(--primary);
	border: 1.5px solid var(--primary);
	border-radius: 4px;
	padding: 1px 3px;
}
</style>
