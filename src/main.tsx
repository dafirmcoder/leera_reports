import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from './App'
import { AuthProvider } from './context/AuthContext'
import { SchoolProvider } from './context/SchoolContext'
import './styles.css'

registerSW({ immediate: true })

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <SchoolProvider>
          <App />
        </SchoolProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
)
