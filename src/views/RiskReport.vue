<template>
  <div class="page risk-report-page">
    <!-- 顶部栏 -->
    <div class="report-topbar">
      <span class="report-back" @click="router.back()">
        <van-icon name="arrow-left" size="18" color="#fff" />
        <span class="report-title">险情上报</span>
      </span>
      <span class="report-dam" @click="showDamPicker = true">
        <van-icon name="location-o" size="12" color="var(--text-muted)" />
        江宁堤段 K12+400
        <van-icon name="arrow" size="10" color="var(--text-muted)" />
      </span>
    </div>

    <div class="report-scroll">
      <!-- 现场照片 -->
      <div class="report-section">
        <div class="section-title">现场照片/证据（3/9）</div>
        <div class="photo-grid">
          <div class="photo-main">
            <img src="https://picsum.photos/seed/dam1/400/300" alt="现场照片" />
            <span class="photo-tag main-tag">主图</span>
            <span class="photo-time">2024-06-20 09:41</span>
            <span class="photo-expand">⛶</span>
          </div>
          <div class="photo-side-list">
            <div class="photo-side-item">
              <img src="https://picsum.photos/seed/dam2/200/150" alt="照片2" />
              <span class="photo-time">2024-06-20 09:40</span>
              <span class="photo-close">✕</span>
            </div>
            <div class="photo-side-item">
              <img src="https://picsum.photos/seed/dam3/200/150" alt="AR标注" />
              <span class="photo-tag ar-tag">AR</span>
              <span class="photo-time">2024-06-20 09:41</span>
              <span class="photo-close">✕</span>
            </div>
          </div>
        </div>
      </div>

      <!-- 位置信息 -->
      <div class="report-section location-section">
        <div class="section-header">
          <div class="section-title">
            <van-icon name="location-o" size="14" color="var(--primary)" />
            位置信息（自动获取）
          </div>
          <span class="reloc-btn" @click="reLocate">
            <van-icon name="aim" size="12" color="#00d4ff" />
            重新定位
          </span>
        </div>
        <div class="location-grid">
          <div class="loc-item">
            <div class="loc-label">当前位置</div>
            <div class="loc-val">31.988506, 118.838451</div>
            <div class="loc-sub">精度 1.2m</div>
          </div>
          <div class="loc-item">
            <div class="loc-label">堤段</div>
            <div class="loc-val">江宁堤段 K12+400</div>
            <div class="loc-sub">右岸</div>
          </div>
          <div class="loc-item">
            <div class="loc-label">桩号</div>
            <div class="loc-val">K12+400</div>
            <div class="loc-sub">迎水侧</div>
          </div>
        </div>
      </div>

      <!-- 险情类型 -->
      <div class="report-section">
        <div class="section-title">
          <van-icon name="shield-o" size="14" color="var(--primary)" />
          险情类型（单选）
        </div>
        <div class="type-grid">
          <div
            v-for="t in riskTypes"
            :key="t.key"
            class="type-card"
            :class="{ active: form.type === t.key }"
            @click="form.type = t.key"
          >
            <span class="type-icon">{{ t.icon }}</span>
            <span class="type-name">{{ t.name }}</span>
          </div>
        </div>
      </div>

      <!-- 险情等级 -->
      <div class="report-section">
        <div class="section-title">
          <van-icon name="warn-o" size="14" color="var(--primary)" />
          险情等级（单选）
        </div>
        <div class="level-grid">
          <div
            v-for="lv in riskLevels"
            :key="lv.key"
            class="level-card"
            :class="{ active: form.level === lv.key }"
            @click="form.level = lv.key"
          >
            <div class="level-top">
              <span class="level-icon">{{ lv.icon }}</span>
              <span class="level-name">{{ lv.name }}</span>
            </div>
            <div class="level-desc">{{ lv.desc }}</div>
          </div>
        </div>
      </div>

      <!-- 现场描述 -->
      <div class="report-section">
        <div class="section-header">
          <div class="section-title">
            <van-icon name="edit" size="14" color="var(--primary)" />
            现场描述（选填）
          </div>
          <span class="voice-btn" @click="onVoice">
            <van-icon name="volume-o" size="12" color="#00d4ff" />
            语音转文字
          </span>
        </div>
        <div class="desc-box">
          <textarea
            v-model="form.description"
            class="desc-textarea"
            placeholder="请描述现场情况..."
            maxlength="300"
          />
          <div class="desc-count">{{ form.description.length }}/300</div>
        </div>
      </div>

      <!-- 位置预览 + 处置建议 -->
      <div class="report-section dual-section">
        <div class="dual-left">
          <div class="section-title">
            <van-icon name="location-o" size="14" color="var(--primary)" />
            位置预览
          </div>
          <div class="mini-map" ref="miniMapRef"></div>
          <div class="map-link" @click="openFullMap">
            查看大图 <van-icon name="expand-o" size="10" />
          </div>
        </div>
        <div class="dual-right">
          <div class="section-title">
            <van-icon name="setting-o" size="14" color="var(--primary)" />
            处置建议（选填）
          </div>
          <div class="suggest-box" @click="showSuggestPicker = true">
            <span class="suggest-placeholder" v-if="!form.suggest">请选择或输入处置建议</span>
            <span class="suggest-val" v-else>{{ form.suggest }}</span>
            <van-icon name="arrow" size="12" color="var(--text-muted)" />
          </div>
          <div class="review-row">
            <span class="review-label">是否请求复核</span>
            <div class="review-btns">
              <span class="review-btn" :class="{ active: form.review === false }" @click="form.review = false">否</span>
              <span class="review-btn" :class="{ active: form.review === true }" @click="form.review = true">是</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部操作栏 -->
    <div class="report-bottom">
      <div class="bottom-btn draft" @click="saveDraft">
        <van-icon name="orders-o" size="16" />
        保存草稿
      </div>
      <div class="bottom-btn submit" @click="submitReport">
        <van-icon name="guide-o" size="16" />
        提交上报
      </div>
    </div>

    <!-- 处置建议选择弹窗 -->
    <van-popup v-model:show="showSuggestPicker" position="bottom" round>
      <van-picker
        :columns="suggestOptions as any"
        @confirm="onSuggestConfirm"
        @cancel="showSuggestPicker = false"
        title="选择处置建议"
      />
    </van-popup>

    <!-- 堤坝选择弹窗 -->
    <van-popup v-model:show="showDamPicker" position="bottom" round>
      <van-picker
        :columns="damOptions as any"
        @confirm="onDamConfirm"
        @cancel="showDamPicker = false"
        title="选择堤段"
      />
    </van-popup>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import { showToast, showDialog } from 'vant'

const router = useRouter()

const riskTypes = [
  { key: 'seepage', name: '渗漏', icon: '💧' },
  { key: 'piping', name: '管涌', icon: '〰️' },
  { key: 'crack', name: '裂缝', icon: '⚡' },
  { key: 'collapse', name: '塌陷', icon: '🕳️' },
  { key: 'other', name: '其他', icon: '⋯' },
]

const riskLevels = [
  { key: 'normal', name: '一般', desc: '可控', icon: '🏳️', color: '#00d4ff' },
  { key: 'attention', name: '较重', desc: '需关注', icon: '⚠️', color: '#ffa502' },
  { key: 'serious', name: '严重', desc: '需处置', icon: '🔔', color: '#ff4757' },
  { key: 'urgent', name: '紧急', desc: '立即处置', icon: '🚨', color: '#ff2e63' },
]

const suggestOptions = [
  '加设反滤围井',
  '开挖导渗沟',
  '铺设土工布',
  '增设观测点',
  '限制通行',
  '紧急加固',
  '上报上级部门',
  '持续监测',
]

const damOptions = ['江宁堤段 K12+400', '江宁堤段 K13+200', '江宁堤段 K14+800']

const form = reactive({
  type: 'seepage',
  level: 'attention',
  description: '迎水坡脚发现渗漏，水流携带细沙，流量稳定约 0.5L/s，周边无新增变形。',
  suggest: '',
  review: false,
})

const showSuggestPicker = ref(false)
const showDamPicker = ref(false)
const miniMapRef = ref<HTMLElement | null>(null)

function onSuggestConfirm(val: any) {
  form.suggest = val.selectedValues[0]
  showSuggestPicker.value = false
}

function onDamConfirm(val: any) {
  showDamPicker.value = false
}

function reLocate() {
  showToast('正在重新定位...')
  setTimeout(() => showToast('定位成功'), 1200)
}

function onVoice() {
  showToast('语音识别中...')
}

function openFullMap() {
  router.push('/map-full?lng=118.838451&lat=31.988506')
}

function saveDraft() {
  showToast('草稿已保存')
}

function submitReport() {
  showDialog({
    title: '确认上报',
    message: '请确认险情信息无误，提交后将通知相关责任人。',
    showCancelButton: true,
  }).then(() => {
    showToast('上报成功')
    setTimeout(() => router.back(), 800)
  }).catch(() => {})
}

/* 迷你地图 */
let miniMap: any = null
onMounted(() => {
  if (!miniMapRef.value) return
  const AMap = (window as any).AMap
  if (!AMap) {
    const script = document.createElement('script')
    script.src = `https://webapi.amap.com/maps?v=2.0&key=${import.meta.env.VITE_AMAP_KEY || 'YOUR_KEY'}`
    script.onload = () => initMiniMap()
    document.head.appendChild(script)
  } else {
    initMiniMap()
  }
})

function initMiniMap() {
  const AMap = (window as any).AMap
  if (!AMap || !miniMapRef.value) return
  miniMap = new AMap.Map(miniMapRef.value, {
    zoom: 16,
    center: [118.838451, 31.988506],
    viewMode: '2D',
    mapStyle: 'amap://styles/darkblue',
    dragEnable: false,
    zoomEnable: false,
  })
  new AMap.Marker({
    position: [118.838451, 31.988506],
    map: miniMap,
    icon: new AMap.Icon({
      image: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0Ij48Y2lyY2xlIGN4PSIxMiIgY3k9IjEyIiByPSIxMCIgZmlsbD0iIzAwZDRmZiIgc3Ryb2tlPSIjZmZmIiBzdHJva2Utd2lkdGg9IjIiLz48L3N2Zz4=',
      size: new AMap.Size(24, 24),
      imageSize: new AMap.Size(24, 24),
    }),
  })
}
</script>

<style scoped>
.risk-report-page {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0e17;
}

/* 顶部栏 */
.report-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: rgba(10, 14, 23, 0.95);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
.report-back {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}
.report-title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
}
.report-dam {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--text-muted);
  background: rgba(255, 255, 255, 0.04);
  padding: 4px 10px;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  cursor: pointer;
}

/* 滚动区 */
.report-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  padding-bottom: 80px;
}

/* 通用区块 */
.report-section {
  margin-bottom: 14px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.04);
  border-radius: 12px;
  padding: 12px;
}
.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}

/* 照片区域 */
.photo-grid {
  display: flex;
  gap: 8px;
}
.photo-main {
  position: relative;
  flex: 1.2;
  aspect-ratio: 4/3;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1f2e;
}
.photo-main img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-tag {
  position: absolute;
  top: 6px;
  left: 6px;
  font-size: 10px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}
.main-tag {
  background: #00d4ff;
  color: #0a0e17;
}
.ar-tag {
  background: #00d4ff;
  color: #0a0e17;
}
.photo-time {
  position: absolute;
  bottom: 6px;
  left: 6px;
  font-size: 9px;
  color: rgba(255, 255, 255, 0.8);
  background: rgba(0, 0, 0, 0.5);
  padding: 1px 6px;
  border-radius: 4px;
}
.photo-expand {
  position: absolute;
  bottom: 6px;
  right: 6px;
  font-size: 14px;
  color: #fff;
  background: rgba(0, 0, 0, 0.5);
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}
.photo-side-list {
  flex: 0.8;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.photo-side-item {
  position: relative;
  flex: 1;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1f2e;
}
.photo-side-item img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.photo-close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.6);
  color: #fff;
  font-size: 10px;
  border-radius: 50%;
  cursor: pointer;
}

/* 位置信息 */
.location-section {
  padding: 12px;
}
.reloc-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #00d4ff;
  cursor: pointer;
}
.location-grid {
  display: grid;
  grid-template-columns: 1.2fr 1fr 1fr;
  gap: 10px;
}
.loc-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.loc-label {
  font-size: 10px;
  color: var(--text-muted);
}
.loc-val {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
  word-break: break-all;
}
.loc-sub {
  font-size: 9px;
  color: var(--text-muted);
}

/* 险情类型 */
.type-grid {
  display: grid;
  grid-template-columns: repeat(5, 1fr);
  gap: 8px;
}
.type-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px 4px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 0.2s;
}
.type-card.active {
  border-color: #00d4ff;
  background: rgba(0, 212, 255, 0.08);
}
.type-icon {
  font-size: 20px;
}
.type-name {
  font-size: 11px;
  color: var(--text-secondary);
}
.type-card.active .type-name {
  color: #00d4ff;
}

/* 险情等级 */
.level-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}
.level-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 4px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(255, 255, 255, 0.02);
  cursor: pointer;
  transition: all 0.2s;
  gap: 4px;
}
.level-card.active {
  border-color: #00d4ff;
  background: rgba(0, 212, 255, 0.08);
}
.level-top {
  display: flex;
  align-items: center;
  gap: 4px;
}
.level-icon {
  font-size: 14px;
}
.level-name {
  font-size: 12px;
  font-weight: 600;
  color: #fff;
}
.level-desc {
  font-size: 9px;
  color: var(--text-muted);
}

/* 现场描述 */
.voice-btn {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: #00d4ff;
  cursor: pointer;
}
.desc-box {
  position: relative;
}
.desc-textarea {
  width: 100%;
  min-height: 80px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  padding: 10px;
  color: #fff;
  font-size: 12px;
  line-height: 1.6;
  resize: vertical;
  outline: none;
}
.desc-textarea::placeholder {
  color: var(--text-muted);
}
.desc-count {
  text-align: right;
  font-size: 10px;
  color: var(--text-muted);
  margin-top: 4px;
}

/* 双栏布局 */
.dual-section {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  padding: 12px;
}
.dual-left, .dual-right {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.mini-map {
  width: 100%;
  height: 100px;
  border-radius: 8px;
  overflow: hidden;
  background: #1a1f2e;
}
.map-link {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  font-size: 10px;
  color: #00d4ff;
  cursor: pointer;
  padding: 4px;
}
.suggest-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  cursor: pointer;
  min-height: 36px;
}
.suggest-placeholder {
  font-size: 11px;
  color: var(--text-muted);
}
.suggest-val {
  font-size: 11px;
  color: #fff;
}
.review-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}
.review-label {
  font-size: 11px;
  color: var(--text-secondary);
}
.review-btns {
  display: flex;
  gap: 8px;
}
.review-btn {
  padding: 4px 16px;
  font-size: 11px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--text-muted);
  cursor: pointer;
  transition: all 0.2s;
}
.review-btn.active {
  background: rgba(0, 212, 255, 0.1);
  border-color: #00d4ff;
  color: #00d4ff;
}

/* 底部操作栏 */
.report-bottom {
  display: flex;
  gap: 10px;
  padding: 10px 16px;
  padding-bottom: calc(10px + env(safe-area-inset-bottom));
  background: rgba(10, 14, 23, 0.95);
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}
.bottom-btn {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 12px;
  border-radius: 10px;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s;
}
.bottom-btn.draft {
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: var(--text-secondary);
}
.bottom-btn.submit {
  background: linear-gradient(135deg, rgba(0, 212, 255, 0.15), rgba(0, 212, 255, 0.05));
  border: 1px solid rgba(0, 212, 255, 0.3);
  color: #00d4ff;
}

/* 弹窗适配 */
:deep(.van-picker) {
  background: #0f1520;
}
:deep(.van-picker__toolbar) {
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
:deep(.van-picker__cancel),
:deep(.van-picker__confirm) {
  color: #00d4ff;
}
:deep(.van-picker__title) {
  color: #fff;
}
:deep(.van-picker-column__item) {
  color: var(--text-secondary);
}
:deep(.van-picker-column__item--selected) {
  color: #fff;
}
:deep(.van-popup) {
  background: #0f1520;
}
</style>
