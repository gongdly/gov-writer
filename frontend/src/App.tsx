import { BrowserRouter, Routes, Route } from 'react-router-dom'
import HubPage from './routes/HubPage'
import WritePage from './routes/WritePage'
import SettingsPage from './routes/SettingsPage'
import HistoryPage from './routes/HistoryPage'
import PersonasPage from './routes/PersonasPage'
import PlaceholderPage from './routes/PlaceholderPage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HubPage />} />
        <Route path="/write" element={<WritePage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/personas" element={<PersonasPage />} />
        <Route path="*" element={<PlaceholderPage title="페이지 없음" phase="" />} />
      </Routes>
    </BrowserRouter>
  )
}
