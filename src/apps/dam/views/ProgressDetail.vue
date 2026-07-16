<template>
  <div class="page">
    <van-nav-bar title="进度详情" left-arrow fixed placeholder @click-left="$router.back()" />
    <div class="card card-glow">
      <h3>今日巡查进度</h3>
      <div class="pg-progress">
        <svg viewBox="0 0 120 120" width="120" height="120">
          <circle cx="60" cy="60" r="48" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="8"/>
          <circle cx="60" cy="60" r="48" fill="none" stroke="url(#pg)" stroke-width="8" stroke-linecap="round" stroke-dasharray="150 301.6" transform="rotate(-90 60 60)"/>
          <defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="0"><stop offset="0%" stop-color="#00d4ff"/><stop offset="100%" stop-color="#00ff88"/></linearGradient></defs>
          <text x="60" y="56" text-anchor="middle" fill="#00d4ff" font-size="20" font-weight="700">50%</text>
        </svg>
      </div>
      <div class="pg-stats"><span>已检查 3/6 个点位</span><span>预计剩余 1.5h</span></div>
    </div>
  </div>
</template>
<style scoped>.pg-progress { display: flex; justify-content: center; margin: 16px 0; }.pg-stats { display: flex; justify-content: space-around; font-size: 12px; color: var(--text-secondary); }</style>
