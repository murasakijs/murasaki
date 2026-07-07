"use client";

import { Input, Label } from "@murasakijs/ui";

export function LabelDemo() {
  return (
    <div className="grid w-full max-w-sm items-center gap-1.5">
      <Label htmlFor="label-demo-email">Email</Label>
      <Input type="email" id="label-demo-email" placeholder="Email" />
    </div>
  );
}
