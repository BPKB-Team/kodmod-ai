import * as React from "react";
import clsx from "clsx";

export interface GameProgressProps extends React.ProgressHTMLAttributes<HTMLProgressElement> {
  value: number;
  max?: number;
  label?: React.ReactNode;
  subtitle?: React.ReactNode;
  showPercentage?: boolean;
  variant?: "cyan" | "emerald" | "amber" | "purple" | "default";
  size?: "sm" | "md" | "lg";
  className?: string;
  pillText?: string;
}

export const GameProgress = React.forwardRef<HTMLProgressElement, GameProgressProps>(
  (
    {
      value,
      max = 100,
      label,
      subtitle,
      showPercentage = true,
      variant = "default",
      size = "md",
      className,
      pillText,
      "aria-label": ariaLabel,
      ...props
    },
    ref
  ) => {
    const safeMax = Math.max(1, max);
    const safeValue = Math.min(safeMax, Math.max(0, value));
    const percentNum = Math.round((safeValue / safeMax) * 100);
    const displayPill = pillText ?? `${percentNum}%`;

    return (
      <div
        className={clsx(
          "game-progress-hud",
          variant !== "default" && `game-progress-${variant}`,
          size !== "md" && `game-progress-${size}`,
          className
        )}
      >
        {(label || showPercentage || pillText) && (
          <div className="game-progress-hud-top">
            {label ? (
              <span className="game-progress-hud-label">
                <span className="game-hud-dot" aria-hidden="true" />
                {label}
              </span>
            ) : (
              <span />
            )}
            {showPercentage && (
              <span className="game-progress-hud-badge" aria-hidden="true">
                <span className="game-hud-num">{displayPill}</span>
              </span>
            )}
          </div>
        )}
        <div className="game-progress-track">
          <progress
            ref={ref}
            value={safeValue}
            max={safeMax}
            className="game-progress-bar"
            aria-label={ariaLabel || `${percentNum}%`}
            {...props}
          />
        </div>
        {subtitle && <p className="game-progress-hud-subtitle">{subtitle}</p>}
      </div>
    );
  }
);

GameProgress.displayName = "GameProgress";
