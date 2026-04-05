import { useEffect, useRef, useState, useCallback } from 'react'
import * as faceapi from 'face-api.js'
import './App.css'

type EmotionState = 'neutral' | 'happy' | 'sad' | 'loading' | 'error'

const HAPPY_THRESHOLD = 0.6
const SAD_THRESHOLD = 0.4
const SOUND_COOLDOWN_MS = 2000

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastSoundTimeRef = useRef<number>(0)
  const detectionLoopRef = useRef<number | null>(null)

  const [status, setStatus] = useState<EmotionState>('loading')
  const [emotionLabel, setEmotionLabel] = useState('')
  const [modelsLoaded, setModelsLoaded] = useState(false)
  const [log, setLog] = useState<string[]>([])

  const addLog = (msg: string) => {
    setLog(prev => [msg, ...prev].slice(0, 5))
  }

  // Web Audio API 초기화
  const getAudioCtx = () => {
    if (!audioCtxRef.current || audioCtxRef.current.state === 'closed') {
      audioCtxRef.current = new AudioContext()
    }
    if (audioCtxRef.current.state === 'suspended') {
      audioCtxRef.current.resume()
    }
    return audioCtxRef.current
  }

  // 낄낄낄 웃음 소리 합성
  const playGiggle = useCallback(() => {
    const ctx = getAudioCtx()
    const laughCount = 4 + Math.floor(Math.random() * 3)

    for (let i = 0; i < laughCount; i++) {
      setTimeout(() => {
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        const distortion = ctx.createWaveShaper()

        // 웃음소리 특유의 거칠고 높은 배음 느낌
        const curve = new Float32Array(256)
        for (let j = 0; j < 256; j++) {
          const x = (j * 2) / 256 - 1
          curve[j] = (Math.PI + 300) * x / (Math.PI + 300 * Math.abs(x))
        }
        distortion.curve = curve

        osc.connect(distortion)
        distortion.connect(gain)
        gain.connect(ctx.destination)

        const baseFreq = 500 + Math.random() * 300
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(baseFreq, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.6, ctx.currentTime + 0.12)

        gain.gain.setValueAtTime(0, ctx.currentTime)
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02)
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.14)

        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.14)
      }, i * 160)
    }
  }, [])

  // 우는 소리 합성
  const playCrying = useCallback(() => {
    const ctx = getAudioCtx()

    // 1차: 끄응 올라가는 소리
    const makeCrySegment = (startTime: number, startFreq: number, endFreq: number, duration: number) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      const lfo = ctx.createOscillator()
      const lfoGain = ctx.createGain()

      lfo.connect(lfoGain)
      lfoGain.connect(osc.frequency)
      osc.connect(gain)
      gain.connect(ctx.destination)

      osc.type = 'sine'
      osc.frequency.setValueAtTime(startFreq, startTime)
      osc.frequency.linearRampToValueAtTime(endFreq, startTime + duration * 0.4)
      osc.frequency.exponentialRampToValueAtTime(startFreq * 0.7, startTime + duration)

      // 우는 소리의 떨림 (비브라토)
      lfo.type = 'sine'
      lfo.frequency.setValueAtTime(5, startTime)
      lfoGain.gain.setValueAtTime(8, startTime)

      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(0.35, startTime + 0.05)
      gain.gain.setValueAtTime(0.35, startTime + duration * 0.7)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration)

      lfo.start(startTime)
      osc.start(startTime)
      lfo.stop(startTime + duration)
      osc.stop(startTime + duration)
    }

    const t = ctx.currentTime
    makeCrySegment(t, 280, 380, 0.8)
    makeCrySegment(t + 0.9, 260, 360, 1.0)
    makeCrySegment(t + 2.1, 240, 340, 0.9)
  }, [])

  // 모델 로드
  useEffect(() => {
    const loadModels = async () => {
      try {
        await faceapi.nets.tinyFaceDetector.loadFromUri('/models')
        await faceapi.nets.faceExpressionNet.loadFromUri('/models')
        setModelsLoaded(true)
      } catch (e) {
        console.error(e)
        setStatus('error')
      }
    }
    loadModels()
  }, [])

  // 웹캠 시작
  useEffect(() => {
    if (!modelsLoaded) return

    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true })
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.onloadedmetadata = () => {
            videoRef.current!.play()
            setStatus('neutral')
          }
        }
      } catch {
        setStatus('error')
      }
    }
    startCamera()
  }, [modelsLoaded])

  // 표정 감지 루프
  useEffect(() => {
    if (status === 'loading' || status === 'error') return
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const detect = async () => {
      if (video.paused || video.ended) return

      const result = await faceapi
        .detectSingleFace(video, new faceapi.TinyFaceDetectorOptions())
        .withFaceExpressions()

      if (result) {
        const { expressions } = result

        // 캔버스에 표정 바 표시
        const dims = faceapi.matchDimensions(canvas, video, true)
        const resized = faceapi.resizeResults(result, dims)
        const ctx = canvas.getContext('2d')!
        ctx.clearRect(0, 0, canvas.width, canvas.height)
        faceapi.draw.drawDetections(canvas, resized)

        const happy = expressions.happy ?? 0
        const sad = expressions.sad ?? 0
        const now = Date.now()
        const canPlaySound = now - lastSoundTimeRef.current > SOUND_COOLDOWN_MS

        if (happy > HAPPY_THRESHOLD) {
          setStatus('happy')
          setEmotionLabel(`😄 웃음 감지! (${(happy * 100).toFixed(0)}%)`)
          if (canPlaySound) {
            lastSoundTimeRef.current = now
            playGiggle()
            addLog(`😄 낄낄낄~ (행복도 ${(happy * 100).toFixed(0)}%)`)
          }
        } else if (sad > SAD_THRESHOLD) {
          setStatus('sad')
          setEmotionLabel(`😢 슬픔 감지! (${(sad * 100).toFixed(0)}%)`)
          if (canPlaySound) {
            lastSoundTimeRef.current = now
            playCrying()
            addLog(`😢 엉엉~ (슬픔도 ${(sad * 100).toFixed(0)}%)`)
          }
        } else {
          setStatus('neutral')
          const topExpr = Object.entries(expressions)
            .sort((a, b) => b[1] - a[1])[0]
          setEmotionLabel(`😐 ${topExpr ? topExprLabel(topExpr[0]) : '중립'} (${topExpr ? (topExpr[1] * 100).toFixed(0) : 0}%)`)
        }
      } else {
        setStatus('neutral')
        setEmotionLabel('얼굴을 카메라에 비춰주세요')
      }

      detectionLoopRef.current = requestAnimationFrame(detect)
    }

    video.addEventListener('play', () => {
      detectionLoopRef.current = requestAnimationFrame(detect)
    }, { once: true })

    if (!video.paused) {
      detectionLoopRef.current = requestAnimationFrame(detect)
    }

    return () => {
      if (detectionLoopRef.current) cancelAnimationFrame(detectionLoopRef.current)
    }
  }, [status === 'loading', status === 'error', playGiggle, playCrying])

  const topExprLabel = (expr: string) => {
    const map: Record<string, string> = {
      neutral: '무표정', happy: '행복', sad: '슬픔',
      angry: '화남', fearful: '두려움', disgusted: '역겨움', surprised: '놀람'
    }
    return map[expr] ?? expr
  }

  const bgClass = status === 'happy' ? 'bg-happy' : status === 'sad' ? 'bg-sad' : 'bg-neutral'

  return (
    <div className={`app-container ${bgClass}`}>
      <h1 className="title">
        {status === 'happy' ? '낄낄낄 😂' : status === 'sad' ? '엉엉 😭' : '표정 감지기 👀'}
      </h1>

      {status === 'loading' && (
        <p className="status-text">AI 모델 불러오는 중...</p>
      )}
      {status === 'error' && (
        <p className="status-text error">카메라 접근 실패 또는 모델 로드 오류</p>
      )}

      <div className="video-wrapper">
        <video ref={videoRef} className="video" muted playsInline />
        <canvas ref={canvasRef} className="canvas-overlay" />
      </div>

      {emotionLabel && (
        <div className="emotion-badge">{emotionLabel}</div>
      )}

      {log.length > 0 && (
        <div className="log-box">
          {log.map((entry, i) => (
            <div key={i} className="log-entry" style={{ opacity: 1 - i * 0.18 }}>
              {entry}
            </div>
          ))}
        </div>
      )}

      <p className="hint">
        웃으면 <strong>낄낄낄</strong> 소리가, 울면 <strong>엉엉</strong> 소리가 납니다
      </p>
    </div>
  )
}
