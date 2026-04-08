import './App.css'
import { GameAudioProvider } from './audio/GameAudioContext'
import { ThreeCanvas } from './ThreeCanvas'

function App() {
  return (
    <GameAudioProvider>
      <main className="app">
        <ThreeCanvas />
      </main>
    </GameAudioProvider>
  )
}

export default App
