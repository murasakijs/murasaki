import { cn } from "./cn.js";

type RenderClassName<T> =
  | string
  | ((values: T & { defaultClassName: string | undefined }) => string);

export function ariaClassName<T>(
  base: string,
  className?: RenderClassName<T>,
): RenderClassName<T> {
  if (typeof className === "function") {
    return (values) => cn(base, className(values));
  }

  return cn(base, className);
}
