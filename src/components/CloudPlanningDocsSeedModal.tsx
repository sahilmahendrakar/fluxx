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
import { Spinner } from '@/components/ui/spinner';

interface Props {
  projectName: string;
  localDocCount: number;
  busy: boolean;
  onUploadToCloud: () => void;
  onSkip: () => void;
}

/**
 * One-time offer when Firestore planning docs are empty but the local mirror has files.
 */
export function CloudPlanningDocsSeedModal({
  projectName,
  localDocCount,
  busy,
  onUploadToCloud,
  onSkip,
}: Props) {
  return (
    <AlertDialog open onOpenChange={(open) => !open && !busy && onSkip()}>
      <AlertDialogContent className="max-w-[440px]">
        <AlertDialogHeader>
          <AlertDialogTitle>Initialize shared planning docs?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="flex flex-col gap-3 text-sm">
              <p>
                Cloud project <span className="font-medium text-foreground">{projectName}</span> has no
                shared planning documents yet, but this machine already has{' '}
                <span className="font-medium text-foreground">{localDocCount}</span> markdown file
                {localDocCount === 1 ? '' : 's'} under planning.
              </p>
              <ul className="flex flex-col gap-1 text-foreground">
                <li className="flex items-start gap-2">
                  <span className="mt-2 inline-block size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                  <span>
                    <strong className="font-medium">Upload from this folder</strong> copies your local
                    planning markdown into the shared cloud docs teammates will see.
                  </span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-2 inline-block size-1 shrink-0 rounded-full bg-muted-foreground" aria-hidden />
                  <span>
                    <strong className="font-medium">Not now</strong> leaves the cloud empty until someone
                    else initializes docs or you upload later — nothing is overwritten silently.
                  </span>
                </li>
              </ul>
              <p className="text-xs text-muted-foreground">
                Files under <code className="text-foreground">_flux_unsynced/</code> are never uploaded.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onSkip}>
            Not now
          </AlertDialogCancel>
          <AlertDialogAction disabled={busy} onClick={onUploadToCloud}>
            {busy ? (
              <>
                <Spinner />
                Uploading…
              </>
            ) : (
              'Upload from this folder'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
