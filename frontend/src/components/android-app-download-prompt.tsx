import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  dismissAndroidAppPrompt,
  getAndroidAppDownloadUrl,
  isAndroidAppPromptDismissed,
  isAndroidPhoneBrowser,
} from "@/lib/mobile-detect";

export function AndroidAppDownloadPrompt() {
  const [open, setOpen] = useState(false);
  const downloadUrl = getAndroidAppDownloadUrl();

  useEffect(() => {
    if (!isAndroidPhoneBrowser() || isAndroidAppPromptDismissed()) return;

    const timer = window.setTimeout(() => setOpen(true), 900);
    return () => window.clearTimeout(timer);
  }, []);

  const closePrompt = () => {
    dismissAndroidAppPrompt();
    setOpen(false);
  };

  const handleDownload = () => {
    if (downloadUrl) {
      window.open(downloadUrl, "_blank", "noopener,noreferrer");
    }
    closePrompt();
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) closePrompt();
        else setOpen(true);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <div className="mx-auto mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Smartphone className="h-6 w-6" />
          </div>
          <DialogTitle className="text-center">Download the Rweezy Android app</DialogTitle>
          <DialogDescription className="text-center">
            You&apos;re using Rweezy on your phone browser. For notifications, faster loading, and a
            smoother experience, install our Android app. Right now it is available for Android
            phones only.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {downloadUrl ? (
            <>
              <Button className="w-full" onClick={handleDownload}>
                Download Android app
              </Button>
              <Button variant="ghost" className="w-full" onClick={closePrompt}>
                Continue on website
              </Button>
            </>
          ) : (
            <Button className="w-full" onClick={closePrompt}>
              Continue on website
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
