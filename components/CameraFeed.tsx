import React, { useEffect, useRef, useState } from 'react';

interface CameraFeedProps {
  onFrame: (base64: string) => void;
  active: boolean;
}

const CameraFeed: React.FC<CameraFeedProps> = ({ onFrame, active }) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onFrameRef = useRef(onFrame);
  const [streamReady, setStreamReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Keep latest onFrame callback without triggering useEffect re-runs
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

    const startCamera = async () => {
      try {
        setCameraError(null);
        // Request standard 640x480 video feed
        const mediaStream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: 'user'
          },
          audio: false
        });

        if (!mounted) {
          mediaStream.getTracks().forEach(track => track.stop());
          return;
        }

        stream = mediaStream;

        if (videoRef.current) {
          videoRef.current.srcObject = mediaStream;
          videoRef.current.onloadedmetadata = async () => {
            if (!mounted) return;
            try {
              await videoRef.current?.play();
              if (mounted) setStreamReady(true);
            } catch (playErr: any) {
              if (playErr.name !== 'AbortError') {
                console.warn('Video playback warning:', playErr);
              }
            }
          };
        }

        // Frame capture loop: 2 FPS (every 500ms) with lightweight resolution to avoid stutter
        intervalId = window.setInterval(() => {
          if (!mounted || !videoRef.current || !canvasRef.current) return;
          const video = videoRef.current;
          const canvas = canvasRef.current;

          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
            // Downscale to 480px width for fast AI transmission without saturating network
            const targetWidth = 480;
            const targetHeight = Math.round((video.videoHeight / video.videoWidth) * targetWidth) || 360;

            canvas.width = targetWidth;
            canvas.height = targetHeight;

            const ctx = canvas.getContext('2d');
            if (ctx) {
              ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
              const base64 = canvas.toDataURL('image/jpeg', 0.65);
              onFrameRef.current(base64);
            }
          }
        }, 500);

      } catch (err: any) {
        if (mounted) {
          console.error('Camera access failed:', err);
          setCameraError(err.message || 'Camera permission denied or hardware unavailable');
        }
      }
    };

    startCamera();

    return () => {
      mounted = false;
      if (intervalId !== null) {
        clearInterval(intervalId);
      }
      if (stream) {
        stream.getTracks().forEach(track => track.stop());
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    };
  }, [active]); // Strictly depend ONLY on `active` to prevent glitching/flicker

  return (
    <div className="relative w-full h-full min-h-[220px] rounded-2xl overflow-hidden bg-[#0d0e12] border border-white/[0.08] flex items-center justify-center">
      {cameraError ? (
        <div className="p-4 text-center text-xs text-red-300">
          <div className="font-medium mb-1">Camera Inactive</div>
          <div className="text-[10px] text-red-400/80">{cameraError}</div>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            muted
            playsInline
            autoPlay
            className={`w-full h-full object-cover transition-opacity duration-300 ${streamReady ? 'opacity-90' : 'opacity-0'}`}
          />
          <canvas ref={canvasRef} className="hidden" />

          {/* Elegant Viewfinder Overlay */}
          <div className="absolute top-2.5 left-2.5 flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/60 backdrop-blur-md border border-white/[0.08]">
            <div className={`w-1.5 h-1.5 rounded-full ${streamReady ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`} />
            <span className="text-[10px] text-[#e0ded6] font-mono-code font-medium">
              {streamReady ? 'Optical Sensor Active' : 'Initializing...'}
            </span>
          </div>

          <div className="absolute bottom-2 right-2 px-2 py-0.5 rounded bg-black/50 text-[9px] text-[#8c887e] font-mono-code">
            2 FPS • AI Ready
          </div>
        </>
      )}
    </div>
  );
};

export default CameraFeed;
