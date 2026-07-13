/**
 * AutomationPage — Browser automation dashboard.
 *
 * Shows:
 *  - Credential configuration per platform
 *  - Current automation queue
 *  - Live task progress with SSE streaming
 */

import type {
  AutomationPlatform,
  AutomationProgressEvent,
  AutomationTaskSummary,
} from "@shared/types";
import { AUTOMATION_PLATFORM_CAPABILITIES } from "@shared/types";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bot,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  CircleDashed,
  Eye,
  Key,
  Loader2,
  Play,
  RotateCcw,
  Settings,
  Trash2,
  XCircle,
} from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  cancelAutomationTask,
  deleteCredentials,
  getAutomationQueue,
  getConfiguredPlatforms,
  streamTaskProgress,
  upsertCredentials,
} from "@/client/api/automation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ─── Status badge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const map: Record<
    string,
    {
      label: string;
      variant: "default" | "secondary" | "destructive" | "outline";
    }
  > = {
    queued: { label: "Queued", variant: "secondary" },
    running: { label: "Running", variant: "default" },
    completed: { label: "Completed", variant: "outline" },
    failed: { label: "Failed", variant: "destructive" },
    cancelled: { label: "Cancelled", variant: "secondary" },
    paused: { label: "Paused", variant: "secondary" },
    idle: { label: "Idle", variant: "outline" },
  };
  const { label, variant } = map[status] ?? {
    label: status,
    variant: "secondary",
  };
  return <Badge variant={variant}>{label}</Badge>;
}

// ─── Live task card ───────────────────────────────────────────────────────────

function TaskCard({
  task,
  onCancel,
}: {
  task: AutomationTaskSummary;
  onCancel: (id: string) => void;
}) {
  const [events, setEvents] = useState<AutomationProgressEvent[]>([]);
  const [liveProgress, setLiveProgress] = useState(task.stepProgress);
  const [liveStep, setLiveStep] = useState(task.currentStep);
  const [liveStatus, setLiveStatus] = useState(task.status);
  const [expanded, setExpanded] = useState(task.status === "running");
  const unsubRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (task.status === "running" || task.status === "queued") {
      const unsub = streamTaskProgress(task.id, (event) => {
        setEvents((prev) => [...prev.slice(-49), event]);
        setLiveProgress(event.stepProgress);
        setLiveStep(event.currentStep);
        setLiveStatus(event.status);
      });
      unsubRef.current = unsub;
      return () => unsub();
    }
  }, [task.id, task.status]);

  const caps =
    AUTOMATION_PLATFORM_CAPABILITIES[task.platform as AutomationPlatform];

  return (
    <Card className="relative overflow-hidden">
      <div
        className={`absolute top-0 left-0 h-1 w-full ${
          liveStatus === "running"
            ? "bg-blue-500 animate-pulse"
            : liveStatus === "completed"
              ? "bg-green-500"
              : liveStatus === "failed"
                ? "bg-red-500"
                : "bg-muted"
        }`}
      />
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base truncate">
              {task.jobTitle}
            </CardTitle>
            <CardDescription className="truncate">
              {task.employer}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Badge variant="outline" className="text-xs">
              {caps?.label ?? task.platform}
            </Badge>
            <StatusBadge status={liveStatus} />
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-3">
        {(liveStatus === "running" || liveStatus === "queued") && (
          <div className="space-y-1">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{liveStep ? liveStep.replace(/_/g, " ") : "Waiting"}</span>
              <span>{liveProgress}%</span>
            </div>
            <Progress value={liveProgress} className="h-1.5" />
          </div>
        )}

        {task.errorMessage && (
          <p className="text-xs text-destructive line-clamp-2">
            {task.errorMessage}
          </p>
        )}

        {task.retryCount > 0 && (
          <p className="text-xs text-muted-foreground">
            Retry {task.retryCount}
          </p>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {(liveStatus === "queued" || liveStatus === "running") && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onCancel(task.id)}
                disabled={liveStatus === "running"}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                Cancel
              </Button>
            )}
          </div>

          {events.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setExpanded((p) => !p)}
              className="text-xs"
            >
              {expanded ? (
                <>
                  <ChevronUp className="h-3 w-3 mr-1" />
                  Hide log
                </>
              ) : (
                <>
                  <ChevronDown className="h-3 w-3 mr-1" />
                  Show log ({events.length})
                </>
              )}
            </Button>
          )}
        </div>

        {expanded && events.length > 0 && (
          <div className="rounded-md bg-muted/50 p-2 max-h-32 overflow-y-auto space-y-0.5">
            {events.map((e) => (
              <p
                key={`${e.timestamp}-${e.type}`}
                className="text-xs font-mono text-muted-foreground"
              >
                {e.message ?? e.type}
              </p>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Credential dialog ────────────────────────────────────────────────────────

function CredentialDialog({
  open,
  onClose,
  onSaved,
  configured,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  configured: AutomationPlatform[];
}) {
  const [platform, setPlatform] = useState<AutomationPlatform>("linkedin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!username || !password) return;
    setSaving(true);
    try {
      await upsertCredentials(platform, username, password);
      toast.success(
        `${AUTOMATION_PLATFORM_CAPABILITIES[platform].label} credentials saved`,
      );
      setUsername("");
      setPassword("");
      onSaved();
      onClose();
    } catch (err) {
      toast.error("Failed to save credentials");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (p: AutomationPlatform) => {
    try {
      await deleteCredentials(p);
      toast.success(
        `${AUTOMATION_PLATFORM_CAPABILITIES[p].label} credentials removed`,
      );
      onSaved();
    } catch {
      toast.error("Failed to remove credentials");
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Key className="h-4 w-4" />
            Platform Credentials
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          {configured.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Configured platforms</p>
              {configured.map((p) => (
                <div
                  key={p}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm">
                    {AUTOMATION_PLATFORM_CAPABILITIES[p].label}
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDelete(p)}
                    className="h-7 text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3">
            <p className="text-sm font-medium">Add / update credentials</p>

            <div className="space-y-1.5">
              <Label htmlFor="cred-platform">Platform</Label>
              <Select
                value={platform}
                onValueChange={(v) => setPlatform(v as AutomationPlatform)}
              >
                <SelectTrigger id="cred-platform">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.values(AUTOMATION_PLATFORM_CAPABILITIES).map((c) => (
                    <SelectItem key={c.platform} value={c.platform}>
                      {c.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cred-username">Username / Email</Label>
              <Input
                id="cred-username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="you@example.com"
                autoComplete="off"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="cred-password">Password</Label>
              <Input
                id="cred-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="new-password"
              />
            </div>

            <Button
              onClick={handleSave}
              disabled={!username || !password || saving}
              className="w-full"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save credentials
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export function AutomationPage() {
  const qc = useQueryClient();
  const [credDialogOpen, setCredDialogOpen] = useState(false);

  const queueQuery = useQuery({
    queryKey: ["automation-queue"],
    queryFn: () => getAutomationQueue(),
    refetchInterval: 5_000,
  });

  const configuredQuery = useQuery({
    queryKey: ["automation-credentials"],
    queryFn: () => getConfiguredPlatforms(),
  });

  const cancelMutation = useMutation({
    mutationFn: cancelAutomationTask,
    onSuccess: () => {
      toast.success("Task cancelled");
      qc.invalidateQueries({ queryKey: ["automation-queue"] });
    },
    onError: () => toast.error("Failed to cancel task"),
  });

  const queue = queueQuery.data;
  const configured = configuredQuery.data ?? [];

  return (
    <div className="container mx-auto max-w-5xl px-4 py-8 space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Bot className="h-6 w-6" />
            Browser Automation
          </h1>
          <p className="text-sm text-muted-foreground">
            Automatically apply to jobs across LinkedIn, Naukri, Indeed, and 7
            more platforms.
          </p>
        </div>
        <Button
          variant="outline"
          onClick={() => setCredDialogOpen(true)}
          className="gap-2"
        >
          <Key className="h-4 w-4" />
          Credentials
        </Button>
      </div>

      {/* Stats row */}
      {queue && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Queued", value: queue.queued, icon: CircleDashed },
            { label: "Running", value: queue.running, icon: Loader2 },
            { label: "Completed", value: queue.completed, icon: CheckCircle },
            { label: "Failed", value: queue.failed, icon: XCircle },
          ].map(({ label, value, icon: Icon }) => (
            <Card key={label} className="text-center">
              <CardContent className="pt-4 pb-3">
                <Icon className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
                <p className="text-2xl font-bold">{value}</p>
                <p className="text-xs text-muted-foreground">{label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* No credentials notice */}
      {configured.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-3">
            <Key className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-medium">No credentials configured</p>
            <p className="text-sm text-muted-foreground max-w-xs mx-auto">
              Add your login credentials for the platforms you want to automate.
              Credentials are encrypted and stored locally.
            </p>
            <Button onClick={() => setCredDialogOpen(true)}>
              Add credentials
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Task queue */}
      {queue && queue.tasks.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Application queue</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() =>
                qc.invalidateQueries({ queryKey: ["automation-queue"] })
              }
            >
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" />
              Refresh
            </Button>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {queue.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onCancel={(id) => cancelMutation.mutate(id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Empty queue */}
      {queue && queue.tasks.length === 0 && configured.length > 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center space-y-2">
            <Play className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="font-medium">Queue is empty</p>
            <p className="text-sm text-muted-foreground">
              Open a job and click "Auto Apply" to add it to the queue.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Credential dialog */}
      <CredentialDialog
        open={credDialogOpen}
        onClose={() => setCredDialogOpen(false)}
        onSaved={() => {
          configuredQuery.refetch();
        }}
        configured={configured}
      />
    </div>
  );
}
