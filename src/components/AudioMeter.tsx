import { useMemo } from 'react';

interface AudioMeterProps {
  level: number; // 0 - 100
  isMuted?: boolean;
  label?: string;
  showDbScale?: boolean;
  compact?: boolean;
}

export function AudioMeter({
  level,
  isMuted = false,
  label = 'Nivel de Audio',
  showDbScale = true,
  compact = false,
}: AudioMeterProps) {
  const currentLevel = isMuted ? 0 : Math.max(0, Math.min(100, level));

  // Determine LED bar segments (24 segments)
  const segments = useMemo(() => {
    const total = compact ? 16 : 24;
    return Array.from({ length: total }, (_, i) => {
      const threshold = ((i + 1) / total) * 100;
      const isLit = currentLevel >= threshold;

      // Color coding: Green (0-60%), Yellow (60-85%), Red (>85%)
      let colorClass = 'bg-emerald-500';
      let glowClass = 'shadow-[0_0_8px_rgba(16,185,129,0.7)]';
      if (threshold > 85) {
        colorClass = 'bg-rose-500';
        glowClass = 'shadow-[0_0_8px_rgba(244,63,94,0.7)]';
      } else if (threshold > 65) {
        colorClass = 'bg-amber-400';
        glowClass = 'shadow-[0_0_8px_rgba(251,191,36,0.7)]';
      }

      return {
        isLit,
        colorClass,
        glowClass,
      };
    });
  }, [currentLevel, compact]);

  return (
    <div className="w-full space-y-1.5" id="audio-meter-container">
      {label && (
        <div className="flex items-center justify-between text-xs font-medium text-zinc-400">
          <span>{label}</span>
          <span
            className={`font-mono text-[11px] ${
              isMuted
                ? 'text-rose-400'
                : currentLevel > 85
                ? 'text-rose-400 font-bold'
                : currentLevel > 50
                ? 'text-amber-300'
                : 'text-zinc-400'
            }`}
          >
            {isMuted ? 'SILENCIADO' : `${currentLevel}%`}
          </span>
        </div>
      )}

      {/* Meter Bar */}
      <div className="flex items-center gap-1 p-1 bg-zinc-900/90 border border-zinc-800 rounded-lg overflow-hidden h-7">
        {segments.map((seg, i) => (
          <div
            key={i}
            className={`h-full flex-1 rounded-xs transition-colors duration-75 ${
              seg.isLit
                ? `${seg.colorClass} ${seg.glowClass}`
                : 'bg-zinc-800/60'
            }`}
          />
        ))}
      </div>

      {/* dB Scale indicators */}
      {showDbScale && (
        <div className="flex justify-between px-1 text-[10px] text-zinc-500 font-mono select-none">
          <span>-∞ dB</span>
          <span>-24 dB</span>
          <span>-12 dB</span>
          <span>-6 dB</span>
          <span className="text-rose-400">0 dB CLIP</span>
        </div>
      )}
    </div>
  );
}
