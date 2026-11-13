import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Monitor, Camera, X, Maximize2, Minimize2, Eye, ShieldCheck, RefreshCw } from 'lucide-react';

export type VisionMode = 'screen' | 'camera';

interface VisionSensorProps {
  active: boolean;
  mode: VisionMode;
  onFrame: (base64: string) => void;
  onToggle: (active: boolean) => void;
  onModeChange: (mode: VisionMode) => void;
}

export const VisionSensor: React.FC<VisionSensorProps> = ({
  active,
  mode,
  onFrame,
  onToggle,
  onModeChange
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFrameRef = useRef(onFrame);
  const [streamReady, setStreamReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [streamTitle, setStreamTitle] = useState<string>('Visual Feed');
  const [fps, setFps] = useState<number>(0);
  const frameCountRef = useRef<number>(0);

  useEffect(() => {
    onFrameRef.current = onFrame;
  }, [onFrame]);

  useEffect(() => {
    if (!active) {
      setStreamReady(false);
      return;
    }

    let mounted = true;
    let stream: MediaStream | null = null;
    let intervalId: number | null = null;

    const startVision = async () => {
      try {
        setError(null);

        if (mode === 'screen') {
          // Request Screen / Window / VS Code Display Media
          // DisplaySurface can hint 'monitor' or 'window'
          const displayStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: 'window' as any,
              cursor: 'always' as any,
              frameRate: { ideal: 10, max: 15 }
            },
            audio: false
          });

          if (!mounted) {
            displayStream.getTracks().forEach(t => t.stop());
            return;
          }

          stream = displayStream;
          const videoTrack = displayStream.getVideoTracks()[0];
          setStreamTitle(videoTrack?.label || 'Screen Share (VS Code)');

          // When user clicks the native browser "Stop sharing" button
          videoTrack.onended = () => {
            if (mounted) {
              onToggle(false);
            }
          };

        } else {
          // Request standard Webcam Feed
          const cameraStream = await navigator.mediaDevices.getUserMedia({
            video: {
              width: { ideal: 1280 },
              height: { ideal: 720 },
              facingMode: 'user'
            },
            audio: false
          });

          if (!mounted) {
            cameraStream.getTracks().forEach(t => t.stop());
            return;
          }

          stream = cameraStream;
          setStreamTitle('Optical Camera');
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = async () => {
            if (!mounted) return;
            try {
              await videoRef.current?.play();
              if (mounted) setStreamReady(true);
            } catch (playErr: any) {
              if (playErr.name !== 'AbortError') {
                console.warn('Vision sensor playback warning:', playErr);
              }
            }
          };
        }

        // Frame capture loop: 2 FPS (every 500ms) with crisp resolution so Gemini vision reads code cleanly
        intervalId = window.setInterval(() => {
          if (!mounted || !videoRef.current || !canvasRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
            // For screen share, use 1024px width so code text, font ligature, and syntax are clear
            const targetWidth = mode === 'screen' ? 1024 : 640;
            const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth) || (mode === 'screen' ? 576 : 480);

            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
              // High-clarity JPEG compression (0.80) ensures code legibility
              const base64 = canvas.toDataURL('image/jpeg', 0.80);
              onFrameRef.current(base64);
              frameCountRef.current++;
            }
          }
        }, 500);

      } catch (err: any) {
        if (mounted) {
          console.error('Vision sensor activation failed:', err);
          setError(err.message || 'Permission denied or feed cancelled');
          onToggle(false);
        }
      }
    };

    startVision();

    // FPS counter update
    const fpsInterval = window.setInterval(() => {
      setFps(frameCountRef.current * 2);
      frameCountRef.current = 0;
    }, 1000);

    return () => {
      mounted = false;
      if (intervalId !== null) clearInterval(intervalId);
      clearInterval(fpsInterval);
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [active, mode, onToggle]);

  if (!active && !error) return null;

  return (
    <div className={`fixed bottom-24 right-6 z-40 transition-all duration-300 pointer-events-auto ${
      minimized ? 'w-64 h-12' : 'w-72 sm:w-80 h-52'
    }`}>
      <div className="w-full h-full rounded-2xl glass-panel border border-[#d4af77]/30 shadow-2xl flex flex-col overflow-hidden bg-[#0d0e14]/95 backdrop-blur-2xl">
        
        {/* Header Bar */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-white/[0.08] bg-black/40 text-xs">
          <div className="flex items-center gap-2 truncate">
            <span className="relative flex h-2 w-2">
              <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${streamReady ? 'bg-emerald-400' : 'bg-amber-400'} opacity-75`}></span>
              <span className={`relative inline-flex rounded-full h-2 w-2 ${streamReady ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
            </span>
            <span className="font-medium text-[#f5eedc] text-[11px] truncate flex items-center gap-1.5">
              {mode === 'screen' ? <Monitor className="w-3.5 h-3.5 text-[#d4af77]" /> : <Camera className="w-3.5 h-3.5 text-[#d4af77]" />}
              {streamTitle}
            </span>
          </div>

          <div className="flex items-center gap-1">
            {/* Mode Switcher */}
            <button
              onClick={() => onModeChange(mode === 'screen' ? 'camera' : 'screen')}
              title={`Switch to ${mode === 'screen' ? 'Camera' : 'Screen Share'}`}
              className="p-1 rounded-md text-[#8c887e] hover:text-[#f5eedc] hover:bg-white/[0.06] transition-colors"
            >
              {mode === 'screen' ? <Camera className="w-3 h-3" /> : <Monitor className="w-3 h-3" />}
            </button>

            {/* Minimize */}
            <button
              onClick={() => setMinimized(!minimized)}
              title={minimized ? "Expand preview" : "Minimize preview"}
              className="p-1 rounded-md text-[#8c887e] hover:text-[#f5eedc] hover:bg-white/[0.06] transition-colors"
            >
              {minimized ? <Maximize2 className="w-3 h-3" /> : <Minimize2 className="w-3 h-3" />}
            </button>

            {/* Close / Stop Sharing */}
            <button
              onClick={() => onToggle(false)}
              title="Stop Vision Feed"
              className="p-1 rounded-md text-[#8c887e] hover:text-red-400 hover:bg-white/[0.06] transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
        </div>

        {/* Video Canvas Body */}
        {!minimized && (
          <div className="flex-1 relative bg-black/60 flex items-center justify-center overflow-hidden">
            {error ? (
              <div className="p-4 text-center text-xs text-red-300">
                <div className="font-medium mb-1">Vision Feed Offline</div>
                <div className="text-[10px] text-red-400/80 leading-relaxed">{error}</div>
              </div>
            ) : (
              <>
                <video
                  ref={videoRef}
                  muted
                  playsInline
                  autoPlay
                  className={`w-full h-full object-contain transition-opacity duration-300 ${streamReady ? 'opacity-95' : 'opacity-20'}`}
                />
                <canvas ref={canvasRef} className="hidden" />

                {/* Floating Telemetry Badge */}
                <div className="absolute bottom-2 left-2 flex items-center gap-2 px-2 py-0.5 rounded-md bg-black/75 backdrop-blur-md border border-white/[0.08] text-[9px] font-mono-code text-[#cfcbbe]">
                  <Eye className="w-2.5 h-2.5 text-[#d4af77]" />
                  <span>June Live Vision: 2 FPS</span>
                </div>

                <div className="absolute top-2 right-2 px-1.5 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/30 text-[9px] font-mono-code text-emerald-300">
                  AI Stream Active
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VisionSensor;
