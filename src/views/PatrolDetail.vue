<template>
  <div class="page">
    <van-nav-bar
      title="巡检详情"
      left-arrow
      fixed
      placeholder
      @click-left="$router.back()"
    />

    <template v-if="task">
      <!-- 任务信息 -->
      <div class="detail-header card card-glow">
        <div class="dh-status-row">
          <span class="pc-status" :class="task.status">{{
            statusLabel(task.status)
          }}</span>
          <span class="tag" :class="`tag-${task.riskLevel}`">
            {{
              task.riskLevel === "high"
                ? "高风险"
                : task.riskLevel === "medium"
                  ? "中风险"
                  : "低风险"
            }}
          </span>
        </div>
        <h2 class="dh-title">{{ task.title }}</h2>
        <p class="dh-section">📍 {{ task.section }}</p>
        <div class="dh-info-row">
          <span>👤 {{ task.assignee }}</span>
          <span>🕐 {{ formatDate(task.startTime) }}</span>
        </div>
        <div class="progress-bar mt-12">
          <div class="progress-fill" :style="{ width: `${progress}%` }"></div>
        </div>
        <p class="progress-label">
          {{ checkedCount }}/{{ task.checkpoints.length }} 已检查
        </p>
      </div>

      <!-- AR 巡查入口 -->
      <div class="ar-entry-bar" @click="$router.push('/ar')">
        <div class="ar-entry-left">
          <span class="ar-entry-icon">📷</span>
          <div class="ar-entry-text">
            <div class="ar-entry-title">AR 实景巡查</div>
            <div class="ar-entry-desc">摄像头 + 实时标注，快速识别风险</div>
          </div>
        </div>
        <van-icon name="arrow" color="#00d4ff" />
      </div>

      <!-- 检查点列表 -->
      <div class="section">
        <h3 class="section-title">检查点</h3>
        <div class="checkpoint-list">
          <div
            class="checkpoint-item card"
            v-for="(cp, idx) in task.checkpoints"
            :key="cp.id"
            @click="openCheckpoint(cp, idx)"
          >
            <div class="cp-index">{{ idx + 1 }}</div>
            <div class="cp-content">
              <p class="cp-name">{{ cp.name }}</p>
              <p class="cp-coords">
                {{ cp.lng.toFixed(4) }}, {{ cp.lat.toFixed(4) }}
              </p>
            </div>
            <div class="cp-status">
              <van-icon
                v-if="cp.checked"
                name="success"
                color="#00ff88"
                size="22"
              />
              <span v-else class="cp-pending">待检</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 检查点检查弹窗 -->
      <van-popup
        v-model:show="showCheck"
        round
        position="bottom"
        :style="{ height: '60%' }"
      >
        <div class="check-popup" v-if="currentCp">
          <h3>{{ currentCp.name }}</h3>

          <div class="check-form">
            <div class="form-item">
              <label>检查结果</label>
              <van-radio-group
                v-model="checkForm.riskFlag"
                direction="horizontal"
              >
                <van-radio name="normal">
                  <span class="radio-label normal">正常</span>
                </van-radio>
                <van-radio name="attention">
                  <span class="radio-label attention">关注</span>
                </van-radio>
                <van-radio name="danger">
                  <span class="radio-label danger">危险</span>
                </van-radio>
              </van-radio-group>
            </div>

            <div class="form-item">
              <label>备注说明</label>
              <van-field
                v-model="checkForm.note"
                type="textarea"
                rows="3"
                placeholder="记录检查情况..."
              />
            </div>

            <div class="form-item">
              <label>现场照片</label>
              <div class="photo-grid">
                <div class="photo-add" @click="takePhoto">
                  <van-icon name="photograph" size="24" color="#8899aa" />
                </div>
                <div
                  class="photo-item"
                  v-for="(img, i) in checkForm.images"
                  :key="i"
                >
                  <img :src="img" />
                  <van-icon
                    name="cross"
                    class="photo-del"
                    @click.stop="removePhoto(i)"
                  />
                </div>
              </div>
            </div>

            <button class="btn-primary full-width" @click="submitCheck">
              提交检查
            </button>
          </div>
        </div>
      </van-popup>
    </template>

    <van-empty v-else description="任务不存在" :image-size="80" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive } from "vue";
import { useRoute } from "vue-router";
import { useAppStore } from "@/stores/app";
import { formatDate, statusLabel } from "@/utils";
import type { Checkpoint } from "@/stores/app";

const route = useRoute();
const store = useAppStore();

const task = computed(() =>
  store.patrolTasks.find((t) => t.id === route.params.id),
);

const checkedCount = computed(
  () => task.value?.checkpoints.filter((c) => c.checked).length ?? 0,
);
const progress = computed(() =>
  task.value?.checkpoints.length
    ? Math.round((checkedCount.value / task.value.checkpoints.length) * 100)
    : 0,
);

const showCheck = ref(false);
const currentCp = ref<Checkpoint | null>(null);

const checkForm = reactive({
  riskFlag: "normal" as "normal" | "attention" | "danger",
  note: "",
  images: [] as string[],
});

function openCheckpoint(cp: Checkpoint, _idx: number) {
  currentCp.value = cp;
  checkForm.riskFlag = (cp.riskFlag || "normal") as
    | "normal"
    | "attention"
    | "danger";
  checkForm.note = cp.note || "";
  checkForm.images = cp.images || [];
  showCheck.value = true;
}

function submitCheck() {
  if (!task.value || !currentCp.value) return;
  store.updateCheckpoint(task.value.id, currentCp.value.id, {
    checked: true,
    riskFlag: checkForm.riskFlag,
    note: checkForm.note,
    images: checkForm.images,
  });
  showCheck.value = false;
}

function takePhoto() {
  // H5 环境通过 input[type=file] 或调用相机
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.capture = "environment";
  input.onchange = () => {
    const file = input.files?.[0];
    if (file) {
      const url = URL.createObjectURL(file);
      checkForm.images.push(url);
    }
  };
  input.click();
}

function removePhoto(index: number) {
  checkForm.images.splice(index, 1);
}
</script>

<style scoped>
.detail-header {
  margin-bottom: 16px;
}
.dh-status-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}
.dh-title {
  font-size: 18px;
  font-weight: 600;
  margin-bottom: 6px;
}
.dh-section {
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.dh-info-row {
  display: flex;
  gap: 16px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 10px;
}
.mt-12 {
  margin-top: 12px;
}
.progress-label {
  font-size: 10px;
  color: var(--text-muted);
  text-align: right;
  margin-top: 4px;
}

.checkpoint-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.checkpoint-item {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}
.checkpoint-item:active {
  transform: scale(0.98);
}
.cp-index {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: rgba(0, 212, 255, 0.1);
  border: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--primary);
  flex-shrink: 0;
}
.cp-content {
  flex: 1;
}
.cp-name {
  font-size: 14px;
  font-weight: 500;
}
.cp-coords {
  font-size: 11px;
  color: var(--text-muted);
}
.cp-pending {
  font-size: 11px;
  color: var(--text-muted);
}

.check-popup {
  padding: 20px 16px;
}
.check-popup h3 {
  font-size: 16px;
  margin-bottom: 20px;
}
.check-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.form-item label {
  display: block;
  font-size: 13px;
  color: var(--text-secondary);
  margin-bottom: 8px;
}
.radio-label {
  font-size: 13px;
  padding: 4px 12px;
  border-radius: 16px;
}
.radio-label.normal {
  color: var(--accent);
}
.radio-label.attention {
  color: var(--warning);
}
.radio-label.danger {
  color: var(--danger);
}
.full-width {
  width: 100%;
}

.ar-entry-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 16px;
  margin-bottom: 14px;
  background: linear-gradient(
    135deg,
    rgba(0, 212, 255, 0.08),
    rgba(0, 212, 255, 0.02)
  );
  border: 1px solid var(--border);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}
.ar-entry-bar:active {
  border-color: var(--border-active);
  background: rgba(0, 212, 255, 0.12);
}
.ar-entry-left {
  display: flex;
  align-items: center;
  gap: 12px;
}
.ar-entry-icon {
  font-size: 28px;
}
.ar-entry-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--primary);
}
.ar-entry-desc {
  font-size: 11px;
  color: var(--text-secondary);
  margin-top: 2px;
}

.photo-grid {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.photo-add {
  width: 64px;
  height: 64px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.photo-item {
  width: 64px;
  height: 64px;
  border-radius: 8px;
  overflow: hidden;
  position: relative;
}
.photo-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-del {
  position: absolute;
  top: 2px;
  right: 2px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  padding: 2px;
  cursor: pointer;
}
</style>
