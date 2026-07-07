"use client";

import { Alert, AlertDescription, AlertTitle } from "@murasakijs/ui";
import { AlertCircle } from "lucide-react";

export function AlertDestructiveDemo() {
  return (
    <Alert variant="destructive">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Error</AlertTitle>
      <AlertDescription>
        Your session has expired. Please log in again.
      </AlertDescription>
    </Alert>
  );
}
