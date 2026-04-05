import { useEffect, useRef, useState, useCallback } from 'react'
import * as faceapi from 'face-api.js'
import './App.css'

type EmotionState = 'neutral' | 'happy' | 'sad' | 'surprised' | 'loading' | 'error'

const HAPPY_THRESHOLD = 0.6
const SAD_THRESHOLD = 0.4
const SURPRISED_THRESHOLD = 0.5
const SOUND_COOLDOWN_MS = 2000

const EXPR_LABELS: Record<string, string> = {
  neutral: '무표정', happy: '행복', sad: '슬픔',
  angry: '화남', fearful: '두려움', disgusted: '역겨움', surprised: '놀람',
}

const EXPR_EMOJI: Record<string, string> = {
  neutral: '😐', happy: '😄', sad: '😢',
  angry: '😠', fearful: '😨', disgusted: '🤢', surprised: '😲',
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastSoundTimeRef = useRef<number>(0)
  const loopRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)

  const [status, setStatus] = useState<EmotionState>('loading')
  const [emotionLabel, setEmotionLabel] = useState('')
  const [expressions, setExpressions] = useState<Record<string, number>>({})
  const [log, setLog] = useState<string[]>([])

  const addLog = useCallback((msg: string) => {
    setLog(prev => [msg, ...prev].slice(0, 5))
  }, [])

  const getAudioCtx = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  const playGiggle = useCallback(() => {
    const ctx = getAudioCtx()
    const count = 4 + Math.floor(Math.random() * 3)
    for (let i = 0; i < count; i++) {
      setTimeout(() => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const curve = new Float32Array(256)
        for (let j = 0; j < 256; j++) {
          const x = (j * 2) / 256 - 1
          curve[j] = (Math.PI + 300) * x / (Math.PI + 300 * Math.abs(x))
        }
        const dist = ctx.createWaveShaper()
        dist.curve = curve
        osc.connect(dist); dist.connect(gain); gain.connect(ctx.destination)
        const freq = 500 + Math.random() * 300
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(freq, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(freq * 0.6, ctx.currentTime + 0.12)
        gain.gain.setValueAtTime(0, ctx.currentTime)
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14)
        osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.14)
      }, i * 160)
    }
  }, [])

  const playCrying = useCallback(() => {
    const ctx = getAudioCtx()
    const seg = (startTime: number, startFreq: number, endFreq: number, dur: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const lfo = ctx.createOscillator()
      const lfoGain = ctx.createGain()
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency)
      osc.connect(gain); gain.connect(ctx.destination)
      osc.type = 'sine'
      osc.frequency.setValueAtTime(startFreq, startTime)
      osc.frequency.linearRampToValueAtTime(endFreq, startTime + dur * 0.4)
      osc.frequency.exponentialRampToValueAtTime(startFreq * 0.7, startTime + dur)
      lfo.type = 'sine'
      lfo.frequency.setValueAtTime(5, startTime)
      lfoGain.gain.setValueAtTime(8, startTime)
      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(0.35, startTime + 0.05)
      gain.gain.setValueAtTime(0.35, startTime + dur * 0.7)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur)
      lfo.start(startTime); osc.start(startTime)
      lfo.stop(startTime + dur); osc.stop(startTime + dur)
    }
    const t = ctx.currentTime
    seg(t, 280, 380, 0.8)
    seg(t + 0.9, 260, 360, 1.0)
    seg(t + 2.1, 240, 340, 0.9)
  }, [])

  const playSurprise = useCallback(() => {
    const ctx = getAudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain); gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.setValueAtTime(300, ctx.currentTime)
    osc.frequency.exponentialRampToValueAtTime(900, ctx.currentTime + 0.15)
    osc.frequency.exponentialRampToValueAtTime(600, ctx.currentTime + 0.4)
    gain.gain.setValueAtTime(0, ctx.currentTime)
    gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + 0.05)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.45)
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.45)
  }, [])

  const startDetectionLoop = useCallback(() => {
    if (runningRef.current) return
    runningRef.current = true

    const tick = async () => {
      if (!runningRef.current) return

      const video = videoRef.current
      const canvas = canvasRef.current
      if (!video || !canvas || video.paused || video.readyState < 2) {
        loopRef.current = requestAnimationFrame(tick)
        return
      }

      const result = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceExpressions()

      if (!runningRef.current) return

      if (result) {
        const dims = faceapi.matchDimensions(canvas, video, true)
        const resized = faceapi.resizeResults(result, dims)
        const ctx2d = canvas.getContext('2d')!
        ctx2d.clearRect(0, 0, canvas.width, canvas.height)
        faceapi.draw.drawDetections(canvas, resized)

        const exprs = result.expressions
        setExpressions(exprs as unknown as Record<string, number>)

        const { happy = 0, sad = 0, surprised = 0 } = exprs
        const now = Date.now()
        const canPlay = now - lastSoundTimeRef.current > SOUND_COOLDOWN_MS

        if (happy > HAPPY_THRESHOLD) {
          setStatus('happy')
          setEmotionLabel(`😄 웃음! (${(happy * 100).toFixed(0)}%)`)
          if (canPlay) {
            lastSoundTimeRef.current = now
            playGiggle()
            addLog(`😄 낄낄낄~ (${(happy * 100).toFixed(0)}%)`)
          }
        } else if (sad > SAD_THRESHOLD) {
          setStatus('sad')
          setEmotionLabel(`😢 슬픔! (${(sad * 100).toFixed(0)}%)`)
          if (canPlay) {
            lastSoundTimeRef.current = now
            playCrying()
            addLog(`😢 엉엉~ (${(sad * 100).toFixed(0)}%)`)
          }
        } else if (surprised > SURPRISED_THRESHOLD) {
          setStatus('surprised')
          setEmotionLabel(`😲 놀람! (${(surprised * 100).toFixed(0)}%)`)
          if (canPlay) {
            lastSoundTimeRef.current = now
            playSurprise()
            addLog(`😲 깜짝! (${(surprised * 100).toFixed(0)}%)`)
          }
        } else {
          setStatus('neutral')
          const top = Object.entries(exprs).sort((a, b) => b[1] - a[1])[0]
          setEmotionLabel(`${EXPR_EMOJI[top[0]] ?? '😐'} ${EXPR_LABELS[top[0]] ?? top[0]} (${(top[1] * 100).toFixed(0)}%)`)
        }
      } else {
        setStatus('neutral')
        setEmotionLabel('얼굴을 카메라에 비춰주세요')
        setExpressions({})
      }

      loopRef.current = requestAnimationFrame(tick)
    }

    loopRef.current = requestAnimationFrame(tick)
  }, [playGiggle, playCrying, playSurprise, addLog])

  useEffect(() => {
    const init = async () => {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
        await faceapi.nets.faceExpressionNet.loadFromUri('/models')

        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        streamRef.current = stream
        const video = videoRef.current!
        video.srcObject = stream
        await video.play()

        setStatus('neutral')
        startDetectionLoop()
      } catch (e) {
        console.error(e)
        setStatus('error')
      }
    }
    init()

    return () => {
      runningRef.current = false
      if (loopRef.current) cancelAnimationFrame(loopRef.current)
      streamRef.current?.getTracks().forEach(t => t.stop())
    }
  }, [startDetectionLoop])

  const bgClass = {
    happy: 'bg-happy', sad: 'bg-sad', surprised: 'bg-surprised',
    loading: 'bg-neutral', error: 'bg-neutral', neutral: 'bg-neutral',
  }[status]

  const titleText = {
    happy: '낄낄낄 😂', sad: '엉엉 😭', surprised: '깜짝! 😲',
    loading: '표정 감지기 👀', error: '표정 감지기 👀', neutral: '표정 감지기 👀',
  }[status]

  return (
    <div className={`app-container ${bgClass}`}>
      <h1 className="title">{titleText}</h1>

      {status === 'loading' && (
        <div className="loading-state">
          <div className="spinner" />
          <p className="status-text">AI 모델 불러오는 중...</p>
        </div>
      )}
      {status === 'error' && <p className="status-text error">카메라 접근 실패 또는 모델 로드 오류</p>}

      <div className="video-wrapper">
        <video ref={videoRef} className="video" muted playsInline />
        <canvas ref={canvasRef} className="canvas-overlay" />
      </div>

      {emotionLabel && <div className="emotion-badge">{emotionLabel}</div>}

      {Object.keys(expressions).length > 0 && (
        <div className="expr-bars">
          {Object.entries(expressions)
            .sort((a, b) => b[1] - a[1])
            .map(([key, val]) => (
              <div key={key} className="expr-bar-row">
                <span className="expr-bar-label">{EXPR_EMOJI[key]} {EXPR_LABELS[key] ?? key}</span>
                <div className="expr-bar-track">
                  <div
                    className={`expr-bar-fill expr-bar-${key}`}
                    style={{ width: `${(val * 100).toFixed(1)}%` }}
                  />
                </div>
                <span className="expr-bar-pct">{(val * 100).toFixed(0)}%</span>
              </div>
            ))}
        </div>
      )}

      {log.length > 0 && (
        <div className="log-box">
          {log.map((entry, i) => (
            <div key={i} className="log-entry" style={{ opacity: 1 - i * 0.18 }}>{entry}</div>
          ))}
        </div>
      )}

      <p className="hint">웃으면 <strong>낄낄낄</strong>, 울면 <strong>엉엉</strong>, 놀라면 <strong>깜짝!</strong></p>
    </div>
  )
}
