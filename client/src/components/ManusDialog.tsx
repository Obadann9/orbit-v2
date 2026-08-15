import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog";

interface ManusDialogProps {
  title?: string;
  logo?: string;
  open?: boolean;
  onLogin: () => void;
  onOpenChange?: (open: boolean) => void;
  onClose?: () => void;
}

export function ManusDialog({
  title,
  logo,
  open = false,
  onLogin,
  onOpenChange,
  onClose,
}: ManusDialogProps) {
  const [internalOpen, setInternalOpen] = useState(open);

  useEffect(() => {
    if (!onOpenChange) {
      setInternalOpen(open);
    }
  }, [open, onOpenChange]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (onOpenChange) {
      onOpenChange(nextOpen);
    } else {
      setInternalOpen(nextOpen);
    }

    if (!nextOpen) {
      onClose?.();
    }
  };

  return (
    <Dialog
      open={onOpenChange ? open : internalOpen}
      onOpenChange={handleOpenChange}
    >
      <DialogContent className="w-[400px] gap-0 rounded-[20px] border border-[var(--line)] bg-[var(--panel)] p-0 py-5 text-center text-[var(--ink)] shadow-[0px_4px_11px_0px_rgba(0,0,0,0.12)] backdrop-blur-2xl">
        <div className="flex flex-col items-center gap-2 p-5 pt-12">
          {logo ? (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-[var(--line)] bg-[var(--panel-2)]">
              <img
                src={logo}
                alt="Dialog graphic"
                className="w-10 h-10 rounded-md"
              />
            </div>
          ) : null}

          {/* Title and subtitle */}
          {title ? (
            <DialogTitle className="text-xl leading-[26px] font-semibold tracking-[-0.44px] text-[var(--ink)]">
              {title}
            </DialogTitle>
          ) : null}
          <DialogDescription className="text-sm leading-5 tracking-[-0.154px] text-[var(--muted)]">
            Please login with Manus to continue
          </DialogDescription>
        </div>

        <DialogFooter className="px-5 py-5">
          {/* Login button */}
          <Button
            onClick={onLogin}
            className="h-10 w-full rounded-[10px] bg-[var(--ink)] text-sm leading-5 font-medium tracking-[-0.154px] text-[var(--panel)] hover:bg-[var(--ink)]/90"
          >
            Login with Manus
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
