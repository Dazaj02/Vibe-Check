import { useEffect, useMemo, useRef, useState } from 'react'

type Song = {
  title: string
  artist: string
  duration: string
  pitch: number
  audio_url: string
}

type PlaylistState = {
  songs: Song[]
  current: Song | null
}

const API_BASE = import.meta.env.VITE_API_URL || '/api'

const toPlayableUrl = (audioUrl: string) => {
  if (audioUrl.startsWith('http://') || audioUrl.startsWith('https://')) {
    return `${API_BASE}/stream?url=${encodeURIComponent(audioUrl)}`
  }
  if (audioUrl.startsWith('/stream?url=')) {
    return `${API_BASE}${audioUrl}`
  }
  if (audioUrl.startsWith('/')) {
    return `${API_BASE}${audioUrl}`
  }
  return audioUrl
}

function App() {
  const [playlist, setPlaylist] = useState<Song[]>([])
  const [current, setCurrent] = useState<Song | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [message, setMessage] = useState('Ready')
  const [form, setForm] = useState({
    title: '',
    artist: '',
    duration: '03:00',
    pitch: '1',
    audio_url: '',
  })
  const [m3uText, setM3uText] = useState('')

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const waveformDataRef = useRef<Uint8Array | null>(null)

  const currentIndex = useMemo(
    () => playlist.findIndex((song) => song.title === current?.title),
    [playlist, current],
  )

  const previousTitle = currentIndex > 0 ? playlist[currentIndex - 1]?.title : '[Head]'
  const nextTitle =
    currentIndex >= 0 && currentIndex < playlist.length - 1
      ? playlist[currentIndex + 1]?.title
      : '[Tail]'

  const refreshState = async () => {
    const response = await fetch(`${API_BASE}/playlist`)
    const data = (await response.json()) as PlaylistState
    setPlaylist(data.songs)
    setCurrent(data.current)
  }

  const postState = async (path: string, body?: unknown, method = 'POST') => {
    const response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })

    if (!response.ok) {
      const error = await response.json()
      setMessage(error.detail || 'Request failed')
      return
    }

    const data = (await response.json()) as PlaylistState
    setPlaylist(data.songs)
    setCurrent(data.current)
  }

  const setupAudioAnalyzer = () => {
    if (!audioRef.current || ctxRef.current) {
      return
    }

    const audioContext = new window.AudioContext()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 256
    analyser.smoothingTimeConstant = 0.8

    const source = audioContext.createMediaElementSource(audioRef.current)
    source.connect(analyser)
    analyser.connect(audioContext.destination)

    ctxRef.current = audioContext
    analyserRef.current = analyser
  }

  const animateBackground = () => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) {
      return
    }

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      return
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth
    const height = window.innerHeight
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const bufferLength = analyser.frequencyBinCount
    const dataArray = new Uint8Array(bufferLength)

    const draw = () => {
      analyser.getByteFrequencyData(dataArray)
      waveformDataRef.current = new Uint8Array(dataArray)

      const avg = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength
      const pulse = avg / 255

      const gradient = ctx.createRadialGradient(
        width * 0.5,
        height * 0.55,
        20,
        width * 0.5,
        height * 0.55,
        Math.max(width, height) * 0.75,
      )
      gradient.addColorStop(0, `rgba(255, 165, 0, ${0.14 + pulse * 0.3})`)
      gradient.addColorStop(0.5, `rgba(255, 60, 30, ${0.08 + pulse * 0.22})`)
      gradient.addColorStop(1, 'rgba(2, 6, 23, 0.92)')

      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)

      const barCount = 96
      const barWidth = width / barCount
      for (let i = 0; i < barCount; i += 1) {
        const index = Math.floor((i / barCount) * bufferLength)
        const value = dataArray[index]
        const barHeight = (value / 255) * height * 0.48
        const hue = 18 + (value / 255) * 30
        ctx.fillStyle = `hsla(${hue}, 100%, 58%, ${0.2 + value / 400})`
        ctx.fillRect(i * barWidth, height - barHeight, Math.max(barWidth - 1, 1), barHeight)
      }

      rafRef.current = requestAnimationFrame(draw)
    }

    draw()
  }

  const beginPlayback = async () => {
    setupAudioAnalyzer()
    if (ctxRef.current?.state === 'suspended') {
      await ctxRef.current.resume()
    }

    if (audioRef.current) {
      try {
        await audioRef.current.play()
        setMessage('Playback running')
      } catch {
        setMessage('Could not play this track. Try another URL or M3U source.')
      }
    }
    if (!rafRef.current) {
      animateBackground()
    }
  }

  const togglePlayPause = async () => {
    if (!audioRef.current) {
      return
    }

    if (isPlaying) {
      audioRef.current.pause()
    } else {
      await beginPlayback()
    }
  }

  const handleProgressChange = (newTime: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = newTime
      setCurrentTime(newTime)
    }
  }

  const handlePitchChange = (delta: number) => {
    postState('/player/pitch', { delta })
  }

  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return '00:00'
    const mins = Math.floor(seconds / 60)
    const secs = Math.floor(seconds % 60)
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }

  useEffect(() => {
    refreshState().catch(() => setMessage('Could not load API'))
  }, [])

  useEffect(() => {
    if (!audioRef.current || !current) {
      return
    }
    const nextSrc = toPlayableUrl(current.audio_url)
    if (audioRef.current.src !== nextSrc) {
      audioRef.current.src = nextSrc
      audioRef.current.load()
    }
    audioRef.current.playbackRate = current.pitch
  }, [current])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) {
      return
    }

    const onError = () => setMessage('Audio failed to load. Check URL format or server access.')
    const onCanPlay = () => {
      setMessage('Track ready. Press Play.')
      setDuration(audio.duration)
    }
    const onPlay = () => setIsPlaying(true)
    const onPause = () => setIsPlaying(false)
    const onEnded = () => setIsPlaying(false)
    const onTimeUpdate = () => setCurrentTime(audio.currentTime)
    const onLoadedMetadata = () => setDuration(audio.duration)

    audio.addEventListener('error', onError)
    audio.addEventListener('canplay', onCanPlay)
    audio.addEventListener('play', onPlay)
    audio.addEventListener('pause', onPause)
    audio.addEventListener('ended', onEnded)
    audio.addEventListener('timeupdate', onTimeUpdate)
    audio.addEventListener('loadedmetadata', onLoadedMetadata)

    return () => {
      audio.removeEventListener('error', onError)
      audio.removeEventListener('canplay', onCanPlay)
      audio.removeEventListener('play', onPlay)
      audio.removeEventListener('pause', onPause)
      audio.removeEventListener('ended', onEnded)
      audio.removeEventListener('timeupdate', onTimeUpdate)
      audio.removeEventListener('loadedmetadata', onLoadedMetadata)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
      }
      ctxRef.current?.close().catch(() => undefined)
    }
  }, [])

  return (
    <div className="page">
      <canvas ref={canvasRef} className="visualizer-bg" />
      <audio ref={audioRef} crossOrigin="anonymous" />

      <main className="shell">
        <header className="hero">
          <h1>Doubly Linked DJ Player</h1>
          <p>
            Real audio playback + bidirectional navigation with a true doubly linked list pointer model.
          </p>
        </header>

        <section className="panel current-panel">
          <h2>Now Playing</h2>
          <p className="title">{current ? `${current.title} - ${current.artist}` : 'No track selected'}</p>
          <p className="meta">Duration {current?.duration ?? '--:--'} | Pitch x{current?.pitch?.toFixed(2) ?? '1.00'}</p>
          <p className="meta">
            Pointers: prev -&gt; {previousTitle} | next -&gt; {nextTitle}
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.2rem' }}>
            <div className={`vinyl-record ${isPlaying ? 'playing' : ''}`} />
          </div>

          <div className="waveform-container">
            {[...Array(32)].map((_, i) => {
              const dataIndex = Math.floor((i / 32) * (waveformDataRef.current?.length || 0))
              const value = (waveformDataRef.current?.[dataIndex] || 0) / 255
              return (
                <div
                  key={i}
                  className="waveform-bar"
                  style={{
                    height: `${20 + value * 80}%`,
                  }}
                />
              )
            })}
          </div>

          <div className="progress-container">
            <div
              className="progress-bar"
              style={{
                width: duration > 0 ? `${(currentTime / duration) * 100}%` : '0%',
              }}
              onClick={(e) => {
                const rect = e.currentTarget.parentElement?.getBoundingClientRect()
                if (rect) {
                  const newTime = ((e.clientX - rect.left) / rect.width) * duration
                  handleProgressChange(newTime)
                }
              }}
            />
          </div>

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              marginTop: '0.5rem',
              fontSize: '0.8rem',
              color: 'var(--muted)',
            }}
          >
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          <div className="row">
            <button onClick={() => postState('/player/previous')}>◀ Previous</button>
            <button onClick={togglePlayPause}>{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
            <button onClick={() => postState('/player/next')}>Next ▶</button>
          </div>

          <div className="pitch-slider-container">
            <label>Pitch</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={current?.pitch ?? 1}
              onChange={(e) => {
                const newPitch = parseFloat(e.target.value)
                const delta = newPitch - (current?.pitch ?? 1)
                handlePitchChange(delta)
              }}
              className="pitch-slider"
            />
            <span style={{ fontSize: '0.9rem', minWidth: '40px' }}>x{(current?.pitch ?? 1).toFixed(2)}</span>
          </div>

          <div className="row">
            <button
              onClick={async () => {
                const response = await fetch(`${API_BASE}/player/download`)
                const data = (await response.json()) as { message: string }
                setMessage(data.message)
              }}
            >
              ⬇ Download Current
            </button>
            <button onClick={() => postState('/playlist/sort', { by: 'title' })}>Sort by Title</button>
            <button onClick={() => postState('/playlist/sort', { by: 'artist' })}>Sort by Artist</button>
          </div>
        </section>

        <section className="panel add-panel">
          <h2>Add Song</h2>
          <div className="grid">
            <input
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              placeholder="Title"
            />
            <input
              value={form.artist}
              onChange={(event) => setForm((prev) => ({ ...prev, artist: event.target.value }))}
              placeholder="Artist"
            />
            <input
              value={form.duration}
              onChange={(event) => setForm((prev) => ({ ...prev, duration: event.target.value }))}
              placeholder="mm:ss"
            />
            <input
              value={form.pitch}
              type="number"
              min={0.5}
              max={2}
              step={0.1}
              onChange={(event) => setForm((prev) => ({ ...prev, pitch: event.target.value }))}
              placeholder="Pitch"
            />
            <input
              value={form.audio_url}
              onChange={(event) => setForm((prev) => ({ ...prev, audio_url: event.target.value }))}
              placeholder="Direct MP3 URL"
            />
          </div>
          <div className="row">
            <button
              onClick={() =>
                postState('/playlist/start', {
                  ...form,
                  pitch: Number(form.pitch),
                })
              }
            >
              Insert at Start
            </button>
            <button
              onClick={() =>
                postState('/playlist/end', {
                  ...form,
                  pitch: Number(form.pitch),
                })
              }
            >
              Insert at End
            </button>
          </div>
        </section>

        <section className="panel add-panel">
          <h2>Import M3U</h2>
          <textarea
            value={m3uText}
            onChange={(event) => setM3uText(event.target.value)}
            placeholder="#EXTM3U&#10;#EXTINF:245,Artist - Song Title&#10;https://example.com/song.mp3"
            rows={8}
          />
          <div className="row">
            <button
              onClick={() =>
                postState('/playlist/import-m3u', {
                  content: m3uText,
                  insert_at_start: false,
                  clear_existing: true,
                })
              }
            >
              Replace with M3U
            </button>
            <button
              onClick={() =>
                postState('/playlist/import-m3u', {
                  content: m3uText,
                  insert_at_start: false,
                  clear_existing: false,
                })
              }
            >
              Append M3U
            </button>
          </div>
        </section>

        <section className="panel list-panel">
          <h2>Playlist</h2>
          <ul>
            {playlist.map((song) => (
              <li key={`${song.title}-${song.artist}`} className={song.title === current?.title ? 'active' : ''}>
                <div>
                  <strong>{song.title}</strong>
                  <small>
                    {song.artist} | {song.duration} | x{song.pitch.toFixed(2)}
                  </small>
                </div>
                <div className="row compact">
                  <button onClick={() => postState(`/player/select/${encodeURIComponent(song.title)}`)}>Go</button>
                  <button
                    className="danger"
                    onClick={() => postState(`/playlist/${encodeURIComponent(song.title)}`, undefined, 'DELETE')}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className="status">{message}</footer>
      </main>

      <div className="player-bar">
        <button className="player-btn prev-btn" onClick={() => postState('/player/previous')} title="Previous">
          ◀
        </button>
        <button className="player-btn play-btn" onClick={togglePlayPause} title={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying ? '⏸' : '▶'}
        </button>
        <button className="player-btn next-btn" onClick={() => postState('/player/next')} title="Next">
          ▶
        </button>
        <div className="player-info">
          <span className="song-title">{current ? current.title : 'No track selected'}</span>
          <span className="song-artist">{current ? current.artist : ''}</span>
        </div>
      </div>
    </div>
  )
}

export default App
