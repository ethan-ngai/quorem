/** @file StreakArtwork.tsx @description Sharpnd flame and ember artwork. @module dashboard */
import { useId } from "react";
import "./streak-motion.css";

export function StreakArtwork({ active }: { active: boolean }) {
  const id = useId();
  return active ? (
    <svg className="ignite-sequence" aria-hidden="true" viewBox="0 -12 100 119">
      <defs>
        <linearGradient id={`fireOuter-${id}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#ea580c" />
          <stop offset="50%" stopColor="#ef4444" />
          <stop offset="100%" stopColor="#b91c1c" />
        </linearGradient>
        <linearGradient id={`fireMid-${id}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#f59e0b" />
          <stop offset="60%" stopColor="#f97316" />
          <stop offset="100%" stopColor="#ea580c" />
        </linearGradient>
        <linearGradient id={`fireInner-${id}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#fef08a" />
          <stop offset="50%" stopColor="#fde047" />
          <stop offset="100%" stopColor="#eab308" />
        </linearGradient>
        <filter id={`glow-${id}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>
      <g>
        <circle className="spark" cx="40" cy="80" r="1.5" fill="#fde047" />
        <circle className="spark" cx="65" cy="75" r="1" fill="#f59e0b" />
        <circle className="spark" cx="50" cy="70" r="2" fill="#fef08a" />
      </g>
      <g className="fire-group" filter={`url(#glow-${id})`}>
        <path
          d="M50,15 C30,40 20,60 20,75 A30 30 0 0 0 80,75 C80,60 70,40 50,15 Z"
          fill={`url(#fireOuter-${id})`}
        />
        <path
          d="M50,30 C36,50 28,65 28,78 A22 22 0 0 0 72,78 C72,65 64,50 50,30 Z"
          fill={`url(#fireMid-${id})`}
        />
        <path
          d="M50,48 C42,60 36,70 36,78 A14 14 0 0 0 64,78 C64,70 58,60 50,48 Z"
          fill={`url(#fireInner-${id})`}
        />
      </g>
    </svg>
  ) : (
    <svg className="smoke-sequence" aria-hidden="true" viewBox="0 -12 100 119">
      <defs>
        <linearGradient id={`smokeGrad-${id}`} x1="0%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="var(--color-text-secondary)" stopOpacity="0.68" />
          <stop offset="50%" stopColor="var(--color-text-secondary)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--color-text-secondary)" stopOpacity="0" />
        </linearGradient>
        <filter id={`smokeSoftness-${id}`} x="-40%" y="-30%" width="180%" height="160%">
          <feGaussianBlur stdDeviation="1.8" />
        </filter>
        <linearGradient id={`coalGrad-${id}`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#334155" />
          <stop offset="100%" stopColor="#0f172a" />
        </linearGradient>
      </defs>
      <g filter={`url(#smokeSoftness-${id})`}>
        <path
          className="wisp wisp-1"
          d="M 46,90 C 45,77 33,73 39,62 S 53,51 46,41"
          fill="none"
          stroke={`url(#smokeGrad-${id})`}
          strokeWidth="9"
          strokeLinecap="round"
        />
        <path
          className="wisp wisp-2"
          d="M 54,89 C 52,76 67,73 63,62 S 48,53 57,43"
          fill="none"
          stroke={`url(#smokeGrad-${id})`}
          strokeWidth="10"
          strokeLinecap="round"
        />
        <path
          className="wisp wisp-3"
          d="M 50,90 C 55,79 42,73 48,61 S 64,50 61,38"
          fill="none"
          stroke={`url(#smokeGrad-${id})`}
          strokeWidth="10"
          strokeLinecap="round"
        />
      </g>
      <g className="coal">
        <path
          d="M 30,90 Q 40,84 50,85 Q 65,82 72,88 Q 78,94 70,97 Q 50,102 28,96 Q 22,93 30,90 Z"
          fill={`url(#coalGrad-${id})`}
        />
        <path
          d="M 30,90 Q 40,84 50,85 Q 65,82 72,88 Q 78,94 70,97 Q 50,102 28,96 Q 22,93 30,90 Z"
          fill="none"
          stroke="#475569"
          strokeWidth="1"
        />
        <path
          d="M 40,90 L 45,93 L 52,90 L 60,94 L 65,91"
          fill="none"
          stroke="#ef4444"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.3"
        />
      </g>
    </svg>
  );
}
