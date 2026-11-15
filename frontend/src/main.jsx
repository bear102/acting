import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// No StrictMode: its double-mount would open the camera and load MediaPipe twice.
createRoot(document.getElementById('root')).render(<App />)
