<template>
  <div class="page">
    <van-nav-bar
      title="交接班"
      left-arrow
      fixed
      placeholder
      @click-left="$router.back()"
    />
    <div class="shift-card card card-glow">
      <h3>班次交接登记</h3>
      <div class="shift-info">
        <span>当前班组：</span><strong>巡检一班</strong>
      </div>
      <div class="shift-info"><span>交班人：</span><strong>张工</strong></div>
      <van-field
        v-model="form.note"
        type="textarea"
        rows="3"
        placeholder="交接事项说明..."
      />
      <button class="btn-primary" style="margin-top: 12px; width: 100%">
        确认交接
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive } from "vue";
const form = reactive({ note: "" });
</script>

<style scoped>
.shift-card {
  padding: 20px;
}
.shift-card h3 {
  font-size: 16px;
  margin-bottom: 14px;
}
.shift-info {
  display: flex;
  gap: 8px;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.shift-info strong {
  color: #fff;
}
</style>
