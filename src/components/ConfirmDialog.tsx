import { useEffect } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';

export type ConfirmDialogDontShowAgain = {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
};

interface ConfirmDialogProps {
  title: string;
  description: string;
  bullets?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  dontShowAgain?: ConfirmDialogDontShowAgain;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmDialog({
  title,
  description,
  bullets,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  dontShowAgain,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter') onConfirm();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel, onConfirm]);

  return (
    <AlertDialog open onOpenChange={(open) => !open && onCancel()}>
      <AlertDialogContent className="max-w-[420px]">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-2">
              <p>{description}</p>
              {bullets && bullets.length > 0 ? (
                <ul className="flex flex-col gap-1 text-foreground">
                  {bullets.map((b) => (
                    <li key={b} className="flex items-start gap-2">
                      <span
                        className="mt-2 inline-block size-1 shrink-0 rounded-full bg-muted-foreground"
                        aria-hidden
                      />
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        {dontShowAgain ? (
          <div className="flex items-center gap-2">
            <Checkbox
              id="confirm-dont-show-again"
              checked={dontShowAgain.checked}
              onCheckedChange={(value) => dontShowAgain.onChange(value === true)}
            />
            <Label htmlFor="confirm-dont-show-again" className="text-sm font-normal text-muted-foreground">
              {dontShowAgain.label}
            </Label>
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            className={cn(destructive && 'bg-destructive text-destructive-foreground hover:bg-destructive/90')}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
