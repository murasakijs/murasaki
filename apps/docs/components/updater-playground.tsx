"use client";

import {
  Alert,
  AlertDescription,
  AlertTitle,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  cn,
  Label,
  Progress,
  Switch,
} from "@murasakijs/ui";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

type DemoStatus =
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "ready"
  | "error";

type Locale = "en" | "ja";

const statuses: DemoStatus[] = [
  "idle",
  "checking",
  "available",
  "not-available",
  "downloading",
  "ready",
  "error",
];

const copy = {
  en: {
    simulation: "Simulation only",
    simulationDescription:
      "No update server is contacted. This playground never downloads files, quits the app, or restarts it.",
    scenarios: "Updater state",
    mandatory: "Mandatory update",
    current: "Current",
    latest: "Latest",
    releaseNotes: "Release notes",
    releaseNotesText:
      "Faster startup, improved Windows packaging, and updater reliability fixes.",
    check: "Check for updates",
    checking: "Checking…",
    update: "Update to v0.56.0",
    downloading: "Downloading update…",
    restart: "Restart to update",
    currentVersion: "You’re up to date",
    tryAgain: "Try again",
    idleDescription: "Check the signed manifest when you are ready.",
    checkingDescription: "Fetching and verifying the signed update manifest.",
    availableDescription: "A signed update is ready to download.",
    notAvailableDescription: "Version 0.55.6 is the latest available release.",
    downloadingDescription:
      "Downloading the matching artifact and verifying SHA-256.",
    readyDescription: "The verified update will be installed after restart.",
    errorDescription: "The manifest signature could not be verified.",
    errorTitle: "Update check failed",
    restartTitle: "Restart simulated",
    restartDescription:
      "A real Murasaki app now hands the verified payload to the native launcher.",
    reset: "Reset",
    state: "Hook state",
    status: "status",
  },
  ja: {
    simulation: "シミュレーション",
    simulationDescription:
      "更新サーバーには接続しません。ファイルのダウンロード、アプリの終了、再起動も行いません。",
    scenarios: "アップデーターの状態",
    mandatory: "必須アップデート",
    current: "現在",
    latest: "最新版",
    releaseNotes: "リリースノート",
    releaseNotesText:
      "起動の高速化、Windowsパッケージングの改善、アップデーターの信頼性修正。",
    check: "アップデートを確認",
    checking: "確認中…",
    update: "v0.56.0へアップデート",
    downloading: "ダウンロード中…",
    restart: "再起動して更新",
    currentVersion: "最新版を使用中です",
    tryAgain: "もう一度試す",
    idleDescription: "準備ができたら署名済みマニフェストを確認します。",
    checkingDescription: "署名済み更新マニフェストを取得して検証しています。",
    availableDescription: "署名済みアップデートをダウンロードできます。",
    notAvailableDescription: "バージョン0.55.6が現在の最新版です。",
    downloadingDescription:
      "対応する成果物をダウンロードし、SHA-256を検証しています。",
    readyDescription: "検証済みアップデートは再起動後に適用されます。",
    errorDescription: "マニフェストの署名を検証できませんでした。",
    errorTitle: "アップデートの確認に失敗しました",
    restartTitle: "再起動をシミュレーションしました",
    restartDescription:
      "実際のMurasakiアプリでは、検証済みペイロードをネイティブランチャーへ渡します。",
    reset: "リセット",
    state: "フックの状態",
    status: "status",
  },
} as const;

function StatusBadge({ status }: { status: DemoStatus }) {
  const variant =
    status === "error"
      ? "destructive"
      : status === "available" || status === "ready"
        ? "default"
        : "secondary";

  return (
    <Badge variant={variant} className="font-mono">
      {status}
    </Badge>
  );
}

export function UpdaterPlayground({ locale = "en" }: { locale?: Locale }) {
  const t = copy[locale];
  const [status, setStatus] = useState<DemoStatus>("available");
  const [mandatory, setMandatory] = useState(false);
  const [progress, setProgress] = useState(0);
  const [restartSimulated, setRestartSimulated] = useState(false);

  useEffect(() => {
    if (status !== "checking") return;

    const timer = window.setTimeout(() => {
      setStatus("available");
    }, 700);

    return () => window.clearTimeout(timer);
  }, [status]);

  useEffect(() => {
    if (status !== "downloading") return;

    const timer = window.setInterval(() => {
      setProgress((current) => {
        const next = Math.min(current + 4, 100);
        if (next === 100) {
          window.clearInterval(timer);
          setStatus("ready");
        }
        return next;
      });
    }, 80);

    return () => window.clearInterval(timer);
  }, [status]);

  const description = useMemo(
    () =>
      ({
        idle: t.idleDescription,
        checking: t.checkingDescription,
        available: t.availableDescription,
        "not-available": t.notAvailableDescription,
        downloading: t.downloadingDescription,
        ready: t.readyDescription,
        error: t.errorDescription,
      })[status],
    [status, t],
  );

  const chooseStatus = (next: DemoStatus) => {
    setStatus(next);
    setProgress(next === "ready" ? 100 : next === "downloading" ? 42 : 0);
    setRestartSimulated(false);
  };

  const runPrimaryAction = () => {
    setRestartSimulated(false);

    if (status === "available") {
      setProgress(0);
      setStatus("downloading");
      return;
    }

    if (status === "ready") {
      setRestartSimulated(true);
      return;
    }

    setStatus("checking");
  };

  const action = {
    idle: t.check,
    checking: t.checking,
    available: t.update,
    "not-available": t.currentVersion,
    downloading: t.downloading,
    ready: t.restart,
    error: t.tryAgain,
  }[status];

  const disabled =
    status === "checking" ||
    status === "downloading" ||
    status === "not-available";

  const state = {
    status,
    current: "0.55.6",
    ...(status !== "idle" &&
      status !== "checking" && {
        latest: status === "not-available" ? "0.55.6" : "0.56.0",
      }),
    ...(status === "available" || status === "downloading" || status === "ready"
      ? {
          notes: t.releaseNotesText,
          mandatory,
        }
      : {}),
    ...(status === "downloading" || status === "ready"
      ? { progress: progress / 100 }
      : {}),
    ...(status === "error"
      ? { error: "Update manifest signature verification failed" }
      : {}),
  };

  return (
    <div className="w-full max-w-5xl space-y-4">
      <Alert>
        <ShieldCheck className="size-4" />
        <AlertTitle>{t.simulation}</AlertTitle>
        <AlertDescription>{t.simulationDescription}</AlertDescription>
      </Alert>

      <div className="grid gap-4 lg:grid-cols-[1.35fr_0.65fr]">
        <Card>
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle>Murasaki Updater</CardTitle>
                <CardDescription>{description}</CardDescription>
              </div>
              <StatusBadge status={status} />
            </div>

            <div className="space-y-2">
              <Label>{t.scenarios}</Label>
              <div className="flex flex-wrap gap-2">
                {statuses.map((item) => (
                  <Button
                    key={item}
                    type="button"
                    size="sm"
                    variant={status === item ? "default" : "outline"}
                    className="font-mono text-xs"
                    onClick={() => chooseStatus(item)}
                  >
                    {item}
                  </Button>
                ))}
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-5">
            <div className="grid grid-cols-2 gap-3 rounded-lg border p-4 text-sm">
              <div>
                <div className="text-muted-foreground">{t.current}</div>
                <div className="font-mono font-medium">0.55.6</div>
              </div>
              <div>
                <div className="text-muted-foreground">{t.latest}</div>
                <div className="font-mono font-medium">
                  {status === "not-available" ? "0.55.6" : "0.56.0"}
                </div>
              </div>
            </div>

            {(status === "available" ||
              status === "downloading" ||
              status === "ready") && (
              <div className="space-y-3">
                <div>
                  <div className="text-sm font-medium">{t.releaseNotes}</div>
                  <p className="text-sm text-muted-foreground">
                    {t.releaseNotesText}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Switch
                    id={`mandatory-${locale}`}
                    checked={mandatory}
                    onCheckedChange={setMandatory}
                  />
                  <Label htmlFor={`mandatory-${locale}`}>{t.mandatory}</Label>
                </div>
              </div>
            )}

            {status === "downloading" && (
              <div className="space-y-2">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t.downloading}</span>
                  <span className="font-mono tabular-nums">{progress}%</span>
                </div>
                <Progress value={progress} />
              </div>
            )}

            {status === "error" && (
              <Alert variant="destructive">
                <AlertCircle className="size-4" />
                <AlertTitle>{t.errorTitle}</AlertTitle>
                <AlertDescription>{t.errorDescription}</AlertDescription>
              </Alert>
            )}

            {restartSimulated && (
              <Alert>
                <CheckCircle2 className="size-4" />
                <AlertTitle>{t.restartTitle}</AlertTitle>
                <AlertDescription>{t.restartDescription}</AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={disabled}
                onClick={runPrimaryAction}
                className={cn(mandatory && status === "available" && "w-full")}
              >
                {status === "checking" ? (
                  <RefreshCw className="size-4 animate-spin" />
                ) : status === "ready" ? (
                  <RotateCcw className="size-4" />
                ) : (
                  <Download className="size-4" />
                )}
                {action}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => chooseStatus("available")}
              >
                {t.reset}
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card className="min-w-0">
          <CardHeader>
            <CardTitle className="text-base">{t.state}</CardTitle>
            <CardDescription>
              <code>useUpdate()</code>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="max-h-[420px] overflow-auto rounded-lg bg-muted p-4 text-xs leading-relaxed">
              <code>{JSON.stringify(state, null, 2)}</code>
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
