import { useEffect, useRef, useState, useCallback } from 'react'
import * as faceapi from 'face-api.js'
import './App.css'

type EmotionState = 'neutral' | 'happy' | 'sad' | 'surprised' | 'loading' | 'error'

const HAPPY_THRESHOLD = 0.6
const SAD_THRESHOLD = 0.4
const SURPRISED_THRESHOLD = 0.5
const SOUND_COOLDOWN_MS = 2500
const STABLE_FRAMES = 5 // 같은 감정이 N프레임 연속돼야 표시 업데이트

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const lastSoundTimeRef = useRef<number>(0)
  const loopRef = useRef<number | null>(null)
  const runningRef = useRef(false)
  const streamRef = useRef<MediaStream | null>(null)
  const stableCountRef = useRef(0)
  const pendingStatusRef = useRef<EmotionState>('neutral')

  const [status, setStatus] = useState<EmotionState>('loading')
  const [emotionLabel, setEmotionLabel] = useState('')
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

  // 깔깔깔 — 비웃는 냉소적 웃음
  const playGiggle = useCallback(() => {
    const ctx = getAudioCtx()
    const bursts = 6

    for (let i = 0; i < bursts; i++) {
      const t = ctx.currentTime + i * 0.13

      const osc1 = ctx.createOscillator()
      const osc2 = ctx.createOscillator()
      const dist = ctx.createWaveShaper()
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()

      const curve = new Float32Array(256)
      for (let j = 0; j < 256; j++) {
        const x = (j * 2) / 256 - 1
        curve[j] = Math.sign(x) * (1 - Math.exp(-Math.abs(x) * 6))
      }
      dist.curve = curve

      osc1.type = 'sawtooth'
      osc2.type = 'square'

      const baseF = 680 + (i % 3) * 60 + Math.random() * 60
      osc1.frequency.setValueAtTime(baseF * 1.4, t)
      osc1.frequency.exponentialRampToValueAtTime(baseF, t + 0.035)
      osc1.frequency.exponentialRampToValueAtTime(baseF * 0.6, t + 0.13)

      osc2.frequency.setValueAtTime(baseF * 0.5, t)

      filter.type = 'bandpass'
      filter.frequency.value = 1600
      filter.Q.value = 1.8

      osc1.connect(dist); osc2.connect(dist)
      dist.connect(filter); filter.connect(gain); gain.connect(ctx.destination)

      gain.gain.setValueAtTime(0, t)
      gain.gain.linearRampToValueAtTime(0.3, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14)

      osc1.start(t); osc1.stop(t + 0.15)
      osc2.start(t); osc2.stop(t + 0.15)
    }
  }, [])

  // 엉엉 — 곡(哭)하듯 우는 소리
  const playCrying = useCallback(() => {
    const ctx = getAudioCtx()

    const wail = (startTime: number, freq: number, dur: number, vol: number) => {
      const osc = ctx.createOscillator()
      const harm = ctx.createOscillator()
      const lfo = ctx.createOscillator()
      const lfoGain = ctx.createGain()
      const filter = ctx.createBiquadFilter()
      const gain = ctx.createGain()

      lfo.connect(lfoGain)
      lfoGain.connect(osc.frequency)
      lfoGain.connect(harm.frequency)
      osc.connect(filter); harm.connect(filter)
      filter.connect(gain); gain.connect(ctx.destination)

      osc.type = 'sawtooth'
      harm.type = 'sawtooth'

      // 곡 윤곽: 오르다가 떨어짐
      osc.frequency.setValueAtTime(freq, startTime)
      osc.frequency.linearRampToValueAtTime(freq * 1.55, startTime + dur * 0.35)
      osc.frequency.exponentialRampToValueAtTime(freq * 0.6, startTime + dur)

      harm.frequency.setValueAtTime(freq * 2.1, startTime)
      harm.frequency.linearRampToValueAtTime(freq * 3.1, startTime + dur * 0.35)
      harm.frequency.exponentialRampToValueAtTime(freq * 1.3, startTime + dur)

      lfo.type = 'sine'
      lfo.frequency.setValueAtTime(7, startTime)
      lfoGain.gain.setValueAtTime(20, startTime)

      filter.type = 'bandpass'
      filter.frequency.value = 750
      filter.Q.value = 2.5

      gain.gain.setValueAtTime(0, startTime)
      gain.gain.linearRampToValueAtTime(vol, startTime + 0.09)
      gain.gain.setValueAtTime(vol * 0.8, startTime + dur * 0.6)
      gain.gain.exponentialRampToValueAtTime(0.001, startTime + dur)

      lfo.start(startTime); osc.start(startTime); harm.start(startTime)
      lfo.stop(startTime + dur); osc.stop(startTime + dur); harm.stop(startTime + dur)
    }

    const t = ctx.currentTime
    wail(t, 210, 0.95, 0.3)
    wail(t + 1.05, 240, 1.1, 0.42)
    wail(t + 2.3, 220, 1.0, 0.38)
  }, [])

  // 왓더팍! — 충격 + 임팩트 펀치
  const playSurprise = useCallback(() => {
    const ctx = getAudioCtx()
    const t = ctx.currentTime

    // "WAH!" — 큰 주파수 스윕
    const osc1 = ctx.createOscillator()
    const filter1 = ctx.createBiquadFilter()
    const gain1 = ctx.createGain()
    osc1.connect(filter1); filter1.connect(gain1); gain1.connect(ctx.destination)
    osc1.type = 'sawtooth'
    filter1.type = 'lowpass'
    osc1.frequency.setValueAtTime(110, t)
    osc1.frequency.exponentialRampToValueAtTime(850, t + 0.11)
    osc1.frequency.exponentialRampToValueAtTime(170, t + 0.42)
    filter1.frequency.setValueAtTime(350, t)
    filter1.frequency.exponentialRampToValueAtTime(3500, t + 0.13)
    filter1.frequency.exponentialRampToValueAtTime(550, t + 0.42)
    gain1.gain.setValueAtTime(0, t)
    gain1.gain.linearRampToValueAtTime(0.55, t + 0.04)
    gain1.gain.exponentialRampToValueAtTime(0.001, t + 0.42)
    osc1.start(t); osc1.stop(t + 0.42)

    // "더" — 짧은 중간음
    const osc2 = ctx.createOscillator()
    const gain2 = ctx.createGain()
    osc2.connect(gain2); gain2.connect(ctx.destination)
    osc2.type = 'sawtooth'
    osc2.frequency.setValueAtTime(370, t + 0.4)
    osc2.frequency.exponentialRampToValueAtTime(190, t + 0.52)
    gain2.gain.setValueAtTime(0.3, t + 0.4)
    gain2.gain.exponentialRampToValueAtTime(0.001, t + 0.52)
    osc2.start(t + 0.4); osc2.stop(t + 0.52)

    // "팍!" — 노이즈 펀치
    const punchSize = Math.floor(ctx.sampleRate * 0.28)
    const punchBuf = ctx.createBuffer(1, punchSize, ctx.sampleRate)
    const punchData = punchBuf.getChannelData(0)
    for (let i = 0; i < punchSize; i++) {
      punchData[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / punchSize, 3)
    }
    const noise = ctx.createBufferSource()
    noise.buffer = punchBuf
    const pFilter = ctx.createBiquadFilter()
    pFilter.type = 'bandpass'
    pFilter.frequency.value = 700
    pFilter.Q.value = 0.7
    const pGain = ctx.createGain()
    pGain.gain.setValueAtTime(0.9, t + 0.5)
    pGain.gain.exponentialRampToValueAtTime(0.001, t + 0.78)
    noise.connect(pFilter); pFilter.connect(pGain); pGain.connect(ctx.destination)
    noise.start(t + 0.5); noise.stop(t + 0.78)
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

        const { happy = 0, sad = 0, surprised = 0 } = result.expressions

        let detected: EmotionState = 'neutral'
        if (happy > HAPPY_THRESHOLD) detected = 'happy'
        else if (sad > SAD_THRESHOLD) detected = 'sad'
        else if (surprised > SURPRISED_THRESHOLD) detected = 'surprised'

        // 안정화: 같은 감정이 연속 N프레임 이상일 때만 업데이트
        if (detected === pendingStatusRef.current) {
          stableCountRef.current++
        } else {
          pendingStatusRef.current = detected
          stableCountRef.current = 1
        }

        if (stableCountRef.current >= STABLE_FRAMES) {
          const now = Date.now()
          const canPlay = now - lastSoundTimeRef.current > SOUND_COOLDOWN_MS

          setStatus(detected)

          if (detected === 'happy') {
            setEmotionLabel('😄 웃음!')
            if (canPlay) {
              lastSoundTimeRef.current = now
              playGiggle()
              addLog('😄 낄낄낄~')
            }
          } else if (detected === 'sad') {
            setEmotionLabel('😢 슬픔!')
            if (canPlay) {
              lastSoundTimeRef.current = now
              playCrying()
              addLog('😢 엉엉~')
            }
          } else if (detected === 'surprised') {
            setEmotionLabel('😲 놀람!')
            if (canPlay) {
              lastSoundTimeRef.current = now
              playSurprise()
              addLog('😲 왓더팍!')
            }
          } else {
            const top = Object.entries(result.expressions).sort((a, b) => b[1] - a[1])[0]
            const labels: Record<string, string> = {
              neutral: '😐 무표정', angry: '😠 화남',
              fearful: '😨 두려움', disgusted: '🤢 역겨움',
            }
            setEmotionLabel(labels[top[0]] ?? '😐 무표정')
          }
        }
      } else {
        pendingStatusRef.current = 'neutral'
        stableCountRef.current = 0
        setStatus('neutral')
        setEmotionLabel('얼굴을 카메라에 비춰주세요')
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
    happy: '낄낄낄 😂', sad: '엉엉 😭', surprised: '왓더팍! 😲',
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

      {log.length > 0 && (
        <div className="log-box">
          {log.map((entry, i) => (
            <div key={i} className="log-entry" style={{ opacity: 1 - i * 0.18 }}>{entry}</div>
          ))}
        </div>
      )}

      <p className="hint">웃으면 <strong>낄낄낄</strong>, 울면 <strong>엉엉</strong>, 놀라면 <strong>왓더팍!</strong></p>
    </div>
  )
}
