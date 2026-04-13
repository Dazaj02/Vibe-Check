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
  const [localPitch, setLocalPitch] = useState(1)
  const [volume, setVolume] = useState(1)
  const [isVisualizerActive, setIsVisualizerActive] = useState(false)
  const [isDraggingProgress, setIsDraggingProgress] = useState(false)
  const [message, setMessage] = useState('Ready')
  const [localFiles, setLocalFiles] = useState<File[]>([])
  const [isDraggingFiles, setIsDraggingFiles] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const waveformDataRef = useRef<Uint8Array | null>(null)
  const progressRef = useRef<HTMLDivElement | null>(null)
  const volumeRef = useRef<number>(1)

  const currentIndex = useMemo(
    () => playlist.findIndex((song) => song.title === current?.title),
    [playlist, current],
  )

  const previousTitle = currentIndex > 0 ? playlist[currentIndex - 1]?.title : '[Head]'
  const nextTitle =
    currentIndex >= 0 && currentIndex < playlist.length - 1
      ? playlist[currentIndex + 1]?.title
      : '[Tail]'

  // Get upcoming songs for the queue (next 5 songs)
  const queueSongs = useMemo(() => {
    if (currentIndex < 0 || currentIndex >= playlist.length) return []
    const upcoming = playlist.slice(currentIndex + 1)
    return upcoming.slice(0, 5)
  }, [playlist, currentIndex])

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
    
    // Auto-play the new song if we were already playing
    if (data.current && isPlaying && audioRef.current) {
      setTimeout(() => {
        audioRef.current?.play().catch(() => {
          setMessage('Could not auto-play next track')
        })
        // Restart visualizer animation for the new track
        if (!rafRef.current) {
          animateBackground()
        }
      }, 100)
    }
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

  const stopVisualizerAnimation = () => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    setIsVisualizerActive(false)
    
    // Draw static background
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const width = window.innerWidth + (window.innerWidth - document.documentElement.clientWidth)
    const height = window.innerHeight
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    
    // Static gradient (initial state)
    const gradient = ctx.createLinearGradient(0, 0, width, height)
    gradient.addColorStop(0, '#0a0e27')
    gradient.addColorStop(0.25, '#1a0033')
    gradient.addColorStop(0.5, '#1a0a40')
    gradient.addColorStop(0.75, '#0d3b66')
    gradient.addColorStop(1, '#0a0e27')
    
    ctx.fillStyle = gradient
    ctx.fillRect(0, 0, width, height)
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
    const width = window.innerWidth + (window.innerWidth - document.documentElement.clientWidth)
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

      // Multicolor gradient background based on audio
      const gradient = ctx.createRadialGradient(
        width * 0.5,
        height * 0.55,
        20,
        width * 0.5,
        height * 0.55,
        Math.max(width, height) * 0.75,
      )
      
      // Dynamic colors based on average frequency and volume
      const hueShift = (pulse * 360) % 360
      const volumeBoost = volumeRef.current
      gradient.addColorStop(0, `hsla(${hueShift}, 100%, 60%, ${(0.2 + pulse * 0.3) * volumeBoost})`)
      gradient.addColorStop(0.5, `hsla(${(hueShift + 120) % 360}, 100%, 50%, ${(0.12 + pulse * 0.2) * volumeBoost})`)
      gradient.addColorStop(1, 'rgba(2, 6, 23, 0.92)')

      ctx.fillStyle = gradient
      ctx.fillRect(0, 0, width, height)

      // Calculate bar count based on screen width - 1 bar per 2 pixels for dense coverage
      const barCount = Math.ceil(width / 2)
      const barWidth = width / barCount
      for (let i = 0; i < barCount; i += 1) {
        const index = Math.floor((i / barCount) * bufferLength)
        const value = dataArray[index]
        const barHeight = (value / 255) * height * 0.48
        
        // Multicolor bars based on frequency and position
        const hue = (hueShift + (i / barCount) * 360) % 360
        const saturation = 100 - (20 * Math.sin((i / barCount) * Math.PI))
        const volumeModifier = 0.3 + (volumeRef.current * 0.4)
        
        ctx.fillStyle = `hsla(${hue}, ${saturation}%, ${55 + value / 255 * 15}%, ${volumeModifier + value / 300})`
        ctx.fillRect(i * barWidth, height - barHeight, barWidth, barHeight)
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
        setIsVisualizerActive(true)
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
      stopVisualizerAnimation()
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
    // Initialize static background
    stopVisualizerAnimation()
  }, [])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume
      volumeRef.current = volume
    }
  }, [volume])

  useEffect(() => {
    if (!audioRef.current || !current) {
      return
    }
    const nextSrc = toPlayableUrl(current.audio_url)
    if (audioRef.current.src !== nextSrc) {
      audioRef.current.src = nextSrc
      audioRef.current.load()
      // Don't stop the visualizer animation here - let it continue
    }
    audioRef.current.playbackRate = current.pitch
    setLocalPitch(current.pitch)
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

  useEffect(() => {
    const handleMouseUp = () => setIsDraggingProgress(false)
    const handleTouchEnd = () => setIsDraggingProgress(false)
    
    window.addEventListener('mouseup', handleMouseUp)
    window.addEventListener('touchend', handleTouchEnd)
    
    return () => {
      window.removeEventListener('mouseup', handleMouseUp)
      window.removeEventListener('touchend', handleTouchEnd)
    }
  }, [])

  return (
    <div className="page">
      <canvas ref={canvasRef} className="visualizer-bg" />
      <audio ref={audioRef} crossOrigin="anonymous" />

      <main className="shell">
        <header className="hero">
          <h1>Vibe Check</h1>
        </header>

        <div className="columns-container">
        <section className="panel current-panel">
          <h2>Now Playing</h2>
          <p className="title">{current ? `${current.title} - ${current.artist}` : 'No track selected'}</p>
          <p className="meta">Duration {current?.duration ?? '--:--'} | Pitch x{current?.pitch?.toFixed(2) ?? '1.00'}</p>
          <p className="meta">
            Pointers: prev -&gt; {previousTitle} | next -&gt; {nextTitle}
          </p>

          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '1.2rem' }}>
            <div className={`vinyl-record ${isPlaying && current ? 'playing' : ''}`} />
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

          <div
            ref={progressRef}
            className="progress-container"
            onMouseDown={() => setIsDraggingProgress(true)}
            onTouchStart={() => setIsDraggingProgress(true)}
            onMouseUp={() => setIsDraggingProgress(false)}
            onTouchEnd={() => setIsDraggingProgress(false)}
            onMouseMove={(e) => {
              if (isDraggingProgress && progressRef.current) {
                const rect = progressRef.current.getBoundingClientRect()
                const newTime = ((e.clientX - rect.left) / rect.width) * duration
                handleProgressChange(Math.max(0, Math.min(newTime, duration)))
              }
            }}
            onTouchMove={(e) => {
              if (isDraggingProgress && progressRef.current) {
                const touch = e.touches[0]
                const rect = progressRef.current.getBoundingClientRect()
                const newTime = ((touch.clientX - rect.left) / rect.width) * duration
                handleProgressChange(Math.max(0, Math.min(newTime, duration)))
              }
            }}
          >
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
            <button onClick={() => postState('/player/previous')}>⏮ Previous</button>
            <button onClick={togglePlayPause}>{isPlaying ? '⏸ Pause' : '▶ Play'}</button>
            <button onClick={() => postState('/player/next')}>Next ⏭</button>
          </div>

          <div className="pitch-slider-container">
            <label>Pitch</label>
            <input
              type="range"
              min="0.5"
              max="2"
              step="0.1"
              value={localPitch}
              onChange={(e) => {
                const newPitch = parseFloat(e.target.value)
                setLocalPitch(newPitch)
                if (audioRef.current) {
                  audioRef.current.playbackRate = newPitch
                }
              }}
              onMouseUp={(e) => {
                const newPitch = parseFloat(e.currentTarget.value)
                handlePitchChange(newPitch - (current?.pitch ?? 1))
              }}
              onTouchEnd={(e) => {
                const newPitch = parseFloat(e.currentTarget.value)
                handlePitchChange(newPitch - (current?.pitch ?? 1))
              }}
              className="pitch-slider"
            />
            <span style={{ fontSize: '0.9rem', minWidth: '40px' }}>x{localPitch.toFixed(2)}</span>
          </div>

          <div className="pitch-slider-container">
            <label>Volume</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={volume}
              onChange={(e) => {
                const newVolume = parseFloat(e.target.value)
                setVolume(newVolume)
              }}
              className="pitch-slider"
            />
            <span style={{ fontSize: '0.9rem', minWidth: '40px' }}>{Math.round(volume * 100)}%</span>
          </div>

          <div className="row">
            <button
              onClick={async () => {
                if (!current) {
                  setMessage('No song selected to download.')
                  return
                }
                try {
                  setMessage('Downloading...')
                  const response = await fetch(`${API_BASE}/player/download`)
                  if (!response.ok) {
                    const error = await response.json()
                    setMessage(error.detail || 'Download failed.')
                    return
                  }
                  
                  const blob = await response.blob()
                  const url = window.URL.createObjectURL(blob)
                  const link = document.createElement('a')
                  link.href = url
                  link.download = `${current.artist}_${current.title}.mp3`
                  document.body.appendChild(link)
                  link.click()
                  document.body.removeChild(link)
                  window.URL.revokeObjectURL(url)
                  setMessage(`Downloaded: ${current.title}`)
                } catch (error) {
                  setMessage(`Download error: ${error}`)
                }
              }}
            >
              ⬇ Download Current
            </button>
            <button onClick={() => postState('/playlist/sort', { by: 'title' })}>Sort by Title</button>
            <button onClick={() => postState('/playlist/sort', { by: 'artist' })}>Sort by Artist</button>
          </div>
        </section>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
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

        <section className="panel add-panel">
          <h2>Upload Local Music</h2>
          <div
            className="upload-zone"
            style={{
              border: `2px dashed ${isDraggingFiles ? '#4CAF50' : 'var(--border)'}`,
              borderRadius: '8px',
              padding: '2rem',
              textAlign: 'center',
              cursor: 'pointer',
              transition: 'all 0.3s ease',
              backgroundColor: isDraggingFiles ? 'rgba(76, 175, 80, 0.1)' : 'transparent',
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDraggingFiles(true)
            }}
            onDragLeave={() => setIsDraggingFiles(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDraggingFiles(false)
              const files = Array.from(e.dataTransfer.files).filter((file) =>
                file.type.startsWith('audio/'),
              )
              setLocalFiles((prev) => [...prev, ...files])
            }}
          >
            <input
              type="file"
              multiple
              accept="audio/*"
              id="file-input"
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = Array.from(e.currentTarget.files || [])
                setLocalFiles((prev) => [...prev, ...files])
              }}
            />
            <label htmlFor="file-input" style={{ cursor: 'pointer', display: 'block' }}>
              <p style={{ marginBottom: '0.5rem' }}>Drag and drop audio files here</p>
              <small style={{ color: 'var(--muted)' }}>Supported: MP3, WAV, FLAC, OGG</small>
            </label>
          </div>

          <button
            onClick={() => document.getElementById('file-input')?.click()}
            style={{ width: '100%', marginTop: '1rem' }}
          >
            📁 Browse Files
          </button>

          {localFiles.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h3 style={{ fontSize: '0.95rem', marginBottom: '0.5rem' }}>Selected Files:</h3>
              <ul style={{ listStyle: 'none', padding: 0 }}>
                {localFiles.map((file, index) => (
                  <li
                    key={index}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '0.5rem',
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    <span style={{ fontSize: '0.9rem' }}>{file.name}</span>
                    <button
                      onClick={() => setLocalFiles((prev) => prev.filter((_, i) => i !== index))}
                      className="danger"
                      style={{ padding: '0.3rem 0.6rem', fontSize: '0.85rem' }}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="row" style={{ marginTop: '1rem' }}>
            <button
              onClick={async () => {
                if (localFiles.length === 0) {
                  setMessage('No files selected to upload.')
                  return
                }

                try {
                  setMessage('Uploading files...')
                  const formData = new FormData()
                  localFiles.forEach((file) => {
                    formData.append('files', file)
                  })

                  const response = await fetch(`${API_BASE}/playlist/upload-local`, {
                    method: 'POST',
                    body: formData,
                    // Don't set Content-Type header - browser will set it automatically with boundary
                  })

                  if (!response.ok) {
                    let errorMessage = 'Upload failed.'
                    try {
                      const error = await response.json()
                      errorMessage = error.detail || errorMessage
                    } catch {
                      errorMessage = `HTTP ${response.status}: ${response.statusText}`
                    }
                    setMessage(errorMessage)
                    return
                  }

                  const data = (await response.json()) as PlaylistState
                  setPlaylist(data.songs)
                  setCurrent(data.current)
                  const uploadedCount = localFiles.length
                  setLocalFiles([])
                  setMessage(`Successfully uploaded ${uploadedCount} file(s).`)
                } catch (error) {
                  const errorMsg = error instanceof Error ? error.message : String(error)
                  setMessage(`Upload error: ${errorMsg}`)
                }
              }}
              disabled={localFiles.length === 0}
            >
              ⬆ Upload to Playlist
            </button>
            <button
              onClick={() => setLocalFiles([])}
              disabled={localFiles.length === 0}
            >
               Clear Selection
             </button>
            </div>
          </section>
        </div>

        <section className="panel queue-panel">
          <h2>Up Next</h2>
          {queueSongs.length === 0 ? (
            <p style={{ color: 'var(--muted)', margin: 0, marginTop: '0.5rem' }}>
              No songs queued. Add more songs or navigate the playlist.
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.8rem', marginTop: '0.5rem' }}>
              {queueSongs.map((song, index) => (
                <div
                  key={`${song.title}-${index}`}
                  className="queue-item"
                  onClick={() => postState(`/player/select/${encodeURIComponent(song.title)}`)}
                >
                  <div className="queue-item-text">
                    <p className="queue-item-title">{index + 1}. {song.title}</p>
                    <p className="queue-item-artist">{song.artist}</p>
                  </div>
                  <div className="queue-item-duration">{song.duration}</div>
                </div>
              ))}
            </div>
          )}
        </section>
        </div>

        <footer className="status">{message}</footer>
      </main>
    </div>
  )
}

export default App
