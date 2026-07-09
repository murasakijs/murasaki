"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@murasakijs/ui";

export function AvatarDemo() {
  return (
    <Avatar>
      <AvatarImage
        src="https://avatars.githubusercontent.com/u/297658745?s=400"
        alt="Murasaki"
      />
      <AvatarFallback>MU</AvatarFallback>
    </Avatar>
  );
}
