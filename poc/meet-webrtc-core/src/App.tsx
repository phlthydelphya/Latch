import { Routes, Route, Navigate } from 'react-router-dom';
import { LandingPage } from './pages/LandingPage';
import { PreJoinPage } from './pages/PreJoinPage';
import { MeetingPage } from './pages/MeetingPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { LoadingScreen } from './components/LoadingScreen';
import { ReloadPrompt } from './components/ReloadPrompt';
import { useAppStore } from './store/appStore';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { roomId, participantId, jwt } = useAppStore();
  
  if (!roomId || !participantId || !jwt) {
    return <Navigate to="/" replace />;
  }
  
  return <>{children}</>;
}

export function App() {
  return (
    <ErrorBoundary>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <ReloadPrompt />
      <LoadingScreen />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/r/:roomId" element={<PreJoinPage />} />
        <Route
          path="/r/:roomId/join"
          element={
            <PrivateRoute>
              <MeetingPage />
            </PrivateRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ErrorBoundary>
  );
}