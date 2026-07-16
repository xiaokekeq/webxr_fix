<script setup lang="ts">
import { onErrorCaptured, ref } from 'vue';

const error = ref( '' );
onErrorCaptured( ( caught ) => {
	error.value = caught instanceof Error ? caught.message : String( caught );
	return false;
} );
</script>

<template>
	<main v-if="error" class="page"><h1>自来水管网核查系统启动失败</h1><p>{{ error }}</p></main>
	<router-view v-else :key="$route.path" />
</template>
