import { Progress } from '@/components/ui/progress';

interface StepIndicatorProps {
  steps: string[];
  currentIndex: number;
}

export function StepIndicator({ steps, currentIndex }: StepIndicatorProps) {
  const progress = ((currentIndex + 1) / steps.length) * 100;

  return (
    <div className="mb-8">
      {/* Mobile: compact label */}
      <p className="mb-2 text-sm text-muted-foreground md:hidden">
        Paso {currentIndex + 1} de {steps.length}:{' '}
        <span className="font-medium text-foreground">{steps[currentIndex]}</span>
      </p>

      {/* Desktop: step bubbles */}
      <ol className="mb-3 hidden items-center md:flex">
        {steps.map((label, i) => {
          const done = i < currentIndex;
          const active = i === currentIndex;
          return (
            <li key={label} className="flex flex-1 items-center">
              <div className="flex flex-col items-center">
                <div
                  className={[
                    'flex h-8 w-8 items-center justify-center rounded-full border-2 text-sm font-semibold',
                    done
                      ? 'border-primary bg-primary text-primary-foreground'
                      : active
                        ? 'border-primary bg-background text-primary'
                        : 'border-muted-foreground/30 bg-background text-muted-foreground',
                  ].join(' ')}
                >
                  {done ? '✓' : i + 1}
                </div>
                <span
                  className={[
                    'mt-1 hidden text-xs lg:block',
                    active ? 'font-semibold text-primary' : 'text-muted-foreground',
                  ].join(' ')}
                >
                  {label}
                </span>
              </div>
              {i < steps.length - 1 && (
                <div
                  className={[
                    'mx-1 h-0.5 flex-1',
                    i < currentIndex ? 'bg-primary' : 'bg-muted-foreground/20',
                  ].join(' ')}
                />
              )}
            </li>
          );
        })}
      </ol>

      <Progress value={progress} className="h-1.5" />
    </div>
  );
}
