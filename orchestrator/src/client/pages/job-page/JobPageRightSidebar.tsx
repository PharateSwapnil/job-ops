import type {
  ApplicationTask,
  AutomationPlatform,
  Job,
} from "@shared/types.js";
import {
  AUTOMATION_PLATFORM_CAPABILITIES,
  AUTOMATION_PLATFORM_VALUES,
} from "@shared/types.js";
import {
  Bot,
  CalendarClock,
  CheckCircle2,
  Copy,
  Download,
  Edit2,
  ExternalLink,
  FileText,
  Loader2,
  MoreHorizontal,
  PlusCircle,
  RefreshCcw,
  Sparkles,
  Upload,
  XCircle,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { toast } from "sonner";
import {
  enqueueAutomationTask,
  getConfiguredPlatforms,
} from "@/client/api/automation";
import { TooltipWhenDisabled } from "@/client/components/TooltipWhenDisabled";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatTimestamp } from "@/lib/utils";

type JobPageRightSidebarProps = {
  job: Job;
  tasks: ApplicationTask[];
  jobLink: string | null;
  isDiscovered: boolean;
  isReady: boolean;
  isApplied: boolean;
  isInProgress: boolean;
  canLogEvents: boolean;
  isBusy: boolean;
  isUploadingPdf: boolean;
  pdfActionsDisabled: boolean;
  pdfRegeneratingReason: string | null;
  pdfViewLabel: string;
  pdfDownloadLabel: string;
  onStartTailoring: () => void;
  onMarkApplied: () => void;
  onMoveToInProgress: () => void;
  onOpenLogEvent: () => void;
  onEditTailoring: () => void;
  onViewPdf: () => void;
  onDownloadPdf: () => void;
  onUploadPdf: () => void;
  onRegeneratePdf: () => void;
  onSkip: () => void;
  onOpenEditDetails: () => void;
  onViewJobDescription: () => void;
  onCopyJobInfo: () => void;
  onRescore: () => void;
  onCheckSponsor: () => void;
  onGenerateTailoredResume: () => void;
};

export const JobPageRightSidebar: React.FC<JobPageRightSidebarProps> = ({
  job,
  tasks,
  jobLink,
  isDiscovered,
  isReady,
  isApplied,
  isInProgress,
  canLogEvents,
  isBusy,
  isUploadingPdf,
  pdfActionsDisabled,
  pdfRegeneratingReason,
  pdfViewLabel,
  pdfDownloadLabel,
  onStartTailoring,
  onMarkApplied,
  onMoveToInProgress,
  onOpenLogEvent,
  onEditTailoring,
  onViewPdf,
  onDownloadPdf,
  onUploadPdf,
  onRegeneratePdf,
  onSkip,
  onOpenEditDetails,
  onViewJobDescription,
  onCopyJobInfo,
  onRescore,
  onCheckSponsor,
  onGenerateTailoredResume,
}) => {
  const [autoApplyOpen, setAutoApplyOpen] = useState(false);
  const [selectedPlatform, setSelectedPlatform] =
    useState<AutomationPlatform>("linkedin");
  const [configuredPlatforms, setConfiguredPlatforms] = useState<
    AutomationPlatform[]
  >([]);
  const [enqueueing, setEnqueueing] = useState(false);

  const openAutoApply = async () => {
    const platforms = await getConfiguredPlatforms().catch(() => []);
    setConfiguredPlatforms(platforms);
    if (platforms.length > 0) setSelectedPlatform(platforms[0]);
    setAutoApplyOpen(true);
  };

  const handleEnqueue = async () => {
    if (!job) return;
    setEnqueueing(true);
    try {
      await enqueueAutomationTask({
        jobId: job.id,
        platform: selectedPlatform,
      });
      toast.success(
        `Added to ${AUTOMATION_PLATFORM_CAPABILITIES[selectedPlatform].label} automation queue`,
      );
      setAutoApplyOpen(false);
    } catch {
      toast.error("Failed to enqueue automation task");
    } finally {
      setEnqueueing(false);
    }
  };

  return (
    <aside className="space-y-4 xl:sticky xl:top-5">
      <section className="rounded-xl border border-border/50 bg-card/85 p-3">
        <div className="mb-3 flex items-center gap-2 px-1 text-sm font-semibold">
          Actions
        </div>
        <div className="space-y-2">
          {jobLink && (
            <Button
              asChild
              size="sm"
              variant="outline"
              className="w-full justify-start"
            >
              <a href={jobLink} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open Job Listing
              </a>
            </Button>
          )}

          {isDiscovered && (
            <Button
              size="sm"
              variant="outline"
              className="w-full justify-start"
              onClick={onStartTailoring}
              disabled={isBusy}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Start Tailoring
            </Button>
          )}

          {isReady && (
            <Button
              size="sm"
              className="w-full justify-start"
              variant="outline"
              onClick={onMarkApplied}
              disabled={isBusy}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Mark Applied
            </Button>
          )}

          {isReady && (
            <Button
              size="sm"
              className="w-full justify-start"
              variant="default"
              onClick={openAutoApply}
              disabled={isBusy}
            >
              <Bot className="mr-1.5 h-3.5 w-3.5" />
              Auto Apply
            </Button>
          )}

          {isDiscovered && (
            <Button
              size="sm"
              className="w-full justify-start"
              variant="outline"
              onClick={onGenerateTailoredResume}
              disabled={isBusy}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Generate Tailored Resume
            </Button>
          )}

          {isApplied && (
            <Button
              size="sm"
              className="w-full justify-start"
              variant="outline"
              onClick={onMoveToInProgress}
              disabled={isBusy}
            >
              <CheckCircle2 className="mr-1.5 h-3.5 w-3.5" />
              Move to In Progress
            </Button>
          )}

          {isInProgress && (
            <Button
              size="sm"
              className="w-full justify-start"
              variant="outline"
              onClick={onOpenLogEvent}
              disabled={!canLogEvents || isBusy}
            >
              <PlusCircle className="mr-1.5 h-3.5 w-3.5" />
              Log event
            </Button>
          )}

          {isReady && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-full justify-start"
              onClick={onEditTailoring}
              disabled={isBusy}
            >
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              Edit Tailoring
            </Button>
          )}

          {job.pdfPath && (
            <TooltipWhenDisabled
              reason={pdfRegeneratingReason}
              className="w-full"
            >
              <Button
                size="sm"
                variant="outline"
                className="h-9 w-full justify-start"
                onClick={onViewPdf}
                disabled={pdfActionsDisabled}
              >
                <FileText className="mr-1.5 h-3.5 w-3.5" />
                {pdfViewLabel}
              </Button>
            </TooltipWhenDisabled>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-9 w-full justify-start"
            onClick={onUploadPdf}
            disabled={isUploadingPdf}
          >
            <Upload className="mr-1.5 h-3.5 w-3.5" />
            {isUploadingPdf
              ? "Uploading PDF"
              : job.pdfPath
                ? "Replace PDF"
                : "Upload PDF"}
          </Button>

          {isReady && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-full justify-start"
              onClick={onRegeneratePdf}
              disabled={isBusy || Boolean(pdfRegeneratingReason)}
            >
              <RefreshCcw className="mr-1.5 h-3.5 w-3.5" />
              Regenerate PDF
            </Button>
          )}

          {(isReady || isDiscovered) && (
            <Button
              size="sm"
              variant="outline"
              className="h-9 w-full justify-start"
              onClick={onSkip}
              disabled={isBusy}
            >
              <XCircle className="mr-1.5 h-3.5 w-3.5" />
              Skip Job
            </Button>
          )}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-9 w-full justify-start text-muted-foreground"
              >
                <MoreHorizontal className="mr-1.5 h-3.5 w-3.5" />
                More actions
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onOpenEditDetails}>
                <Edit2 className="mr-2 h-4 w-4" />
                Edit details
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onViewJobDescription}>
                <Edit2 className="mr-2 h-4 w-4" />
                View job description
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={onCopyJobInfo}>
                <Copy className="mr-2 h-4 w-4" />
                Copy job info
              </DropdownMenuItem>
              {(isReady || isDiscovered) && (
                <DropdownMenuItem onSelect={onRescore}>
                  <RefreshCcw className="mr-2 h-4 w-4" />
                  Recalculate match
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={onUploadPdf}
                disabled={isUploadingPdf}
              >
                <Upload className="mr-2 h-4 w-4" />
                {isUploadingPdf
                  ? "Uploading PDF..."
                  : job.pdfPath
                    ? "Replace PDF"
                    : "Upload PDF"}
              </DropdownMenuItem>
              {job.pdfPath && (
                <>
                  <DropdownMenuItem
                    onSelect={onViewPdf}
                    disabled={pdfActionsDisabled}
                  >
                    <ExternalLink className="mr-2 h-4 w-4" />
                    {pdfViewLabel}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={onDownloadPdf}
                    disabled={pdfActionsDisabled}
                  >
                    <Download className="mr-2 h-4 w-4" />
                    {pdfDownloadLabel}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                </>
              )}
              <DropdownMenuItem onSelect={onCheckSponsor}>
                Check sponsorship status
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {tasks.length > 0 && (
        <section className="rounded-xl border border-border/50 bg-card/70 p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4" />
            Upcoming tasks
          </div>
          <div className="space-y-3">
            {tasks.map((task) => (
              <div key={task.id} className="space-y-1">
                <div className="text-sm font-medium">{task.title}</div>
                {task.notes && (
                  <div className="text-xs text-muted-foreground">
                    {task.notes}
                  </div>
                )}
                <Badge
                  variant="outline"
                  className="text-[10px] uppercase tracking-wide"
                >
                  {formatTimestamp(task.dueDate)}
                </Badge>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Auto Apply dialog */}
      <Dialog
        open={autoApplyOpen}
        onOpenChange={(v) => !v && setAutoApplyOpen(false)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Bot className="h-4 w-4" />
              Auto Apply
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {configuredPlatforms.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No platforms configured. Go to the Automation page and add your
                credentials first.
              </p>
            ) : (
              <>
                <div className="space-y-1.5">
                  <label
                    htmlFor="auto-apply-platform"
                    className="text-sm font-medium"
                  >
                    Platform
                  </label>
                  <Select
                    value={selectedPlatform}
                    onValueChange={(v) =>
                      setSelectedPlatform(v as AutomationPlatform)
                    }
                  >
                    <SelectTrigger id="auto-apply-platform">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {configuredPlatforms.map((p) => (
                        <SelectItem key={p} value={p}>
                          {AUTOMATION_PLATFORM_CAPABILITIES[p].label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  onClick={handleEnqueue}
                  disabled={enqueueing}
                  className="w-full"
                >
                  {enqueueing ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Bot className="h-4 w-4 mr-2" />
                  )}
                  Add to queue
                </Button>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </aside>
  );
};
