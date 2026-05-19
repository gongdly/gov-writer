import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HubPage from './routes/HubPage'
import WritePage from './routes/WritePage'
import SettingsPage from './routes/SettingsPage'
import PlaceholderPage from './routes/PlaceholderPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HubPage />} />
        <Route path="/write" element={<WritePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/result" element={<PlaceholderPage title="작성 결과" phase="Phase 3-4" />} />
        <Route path="/history" element={<PlaceholderPage title="작성 이력" phase="Phase 5" />} />
        <Route path="/personas" element={<PlaceholderPage title="페르소나 관리" phase="Phase 5" />} />
        <Route path="*" element={<PlaceholderPage title="페이지 없음" phase="" />} />
      </Routes>
    </BrowserRouter>
  )
}
