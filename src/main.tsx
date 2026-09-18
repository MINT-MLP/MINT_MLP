import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from '@/App'
import { initErrorLogging } from '@/utils/errorLog'
import { captureAttribution } from '@/utils/attribution'
import { trackEvent } from '@/utils/analytics'

initErrorLogging()

// 어느 광고로 들어왔는지는 최초 문서 URL에만 적혀 있다. 라우팅·로그인 복귀가 search를 지우기 전,
// React 렌더보다도 먼저 여기서 읽어둔다(URL은 읽기만 한다 — 정리는 하지 않는다).
// 발화를 attribution.ts 안의 동적 import로 하지 않는 이유: 그러면 Rollup이 analytics를
// entry에서 도달하는 동적 진입점으로 보고 supabase 203kB를 index 청크에 접어 넣는다(실측 확인).
// errorLog가 이미 supabase를 정적으로 물고 있어 여기서 analytics를 정적으로 써도 첫 로드 비용은 0이다.
const entryView = captureAttribution()
if (entryView) trackEvent('entry_view', { ...entryView })

// 모바일 브라우저 UI가 접히거나 전체화면으로 전환될 때 실제 가시 높이를 앱 레이아웃에 즉시 반영한다.
let fullscreenNoticeGuard = 0
let fullscreenNoticeTimer: ReturnType<typeof setTimeout> | null = null

function syncAppViewportHeight() {
  const height = window.visualViewport?.height ?? window.innerHeight
  document.documentElement.style.setProperty(
    '--mint-app-height',
    `${Math.max(480, Math.round(height - fullscreenNoticeGuard))}px`,
  )
}

syncAppViewportHeight()
window.addEventListener('resize', syncAppViewportHeight)
window.visualViewport?.addEventListener('resize', syncAppViewportHeight)
document.addEventListener('fullscreenchange', () => {
  if (fullscreenNoticeTimer) clearTimeout(fullscreenNoticeTimer)
  // Android/Chrome의 강제 전체화면 안내가 하단 CTA를 가리는 동안만 버튼 영역을 위로 피한다.
  fullscreenNoticeGuard = document.fullscreenElement ? 104 : 0
  requestAnimationFrame(syncAppViewportHeight)
  if (document.fullscreenElement) {
    fullscreenNoticeTimer = setTimeout(() => {
      fullscreenNoticeGuard = 0
      syncAppViewportHeight()
    }, 4200)
  }
})

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
