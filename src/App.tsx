import './App.css'
import { ThreeCanvas } from './ThreeCanvas'

function App() {
  return (
    <main className="app">
      <header className="hud">
        <div className="title">Rival Race</div>
        <div className="subtitle">Three.js + React + TypeScript</div>
      </header>
      <ThreeCanvas />
    </main>
  )
}

export default App
