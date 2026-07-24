import type { HTMLAttributes, ImgHTMLAttributes } from "react";
import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useState,
} from "react";
import { cn } from "../lib/cn.js";

const AvatarContext = createContext<{
  loaded: boolean;
  setLoaded: (loaded: boolean) => void;
} | null>(null);

export const Avatar = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement>
>(({ className, children, ...props }, ref) => {
  const [loaded, setLoaded] = useState(false);

  return (
    <AvatarContext.Provider value={{ loaded, setLoaded }}>
      <div
        ref={ref}
        className={cn(
          "relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full",
          className,
        )}
        {...props}
      >
        {children}
      </div>
    </AvatarContext.Provider>
  );
});
Avatar.displayName = "Avatar";

export const AvatarImage = forwardRef<
  HTMLImageElement,
  ImgHTMLAttributes<HTMLImageElement>
>(({ className, onLoad, onError, alt = "", ...props }, ref) => {
  const context = useContext(AvatarContext);

  return (
    <img
      ref={ref}
      alt={alt}
      className={cn(
        "aspect-square h-full w-full",
        !context?.loaded && "invisible",
        className,
      )}
      onLoad={(event) => {
        context?.setLoaded(true);
        onLoad?.(event);
      }}
      onError={(event) => {
        context?.setLoaded(false);
        onError?.(event);
      }}
      {...props}
    />
  );
});
AvatarImage.displayName = "AvatarImage";

export interface AvatarFallbackProps extends HTMLAttributes<HTMLDivElement> {
  delayMs?: number;
}

export const AvatarFallback = forwardRef<HTMLDivElement, AvatarFallbackProps>(
  ({ className, delayMs = 0, ...props }, ref) => {
    const context = useContext(AvatarContext);
    const [visible, setVisible] = useState(delayMs === 0);

    useEffect(() => {
      if (context?.loaded) {
        setVisible(false);
        return;
      }
      if (delayMs === 0) {
        setVisible(true);
        return;
      }
      const timeout = setTimeout(() => setVisible(true), delayMs);
      return () => clearTimeout(timeout);
    }, [context?.loaded, delayMs]);

    if (context?.loaded || !visible) return null;

    return (
      <div
        ref={ref}
        className={cn(
          "absolute inset-0 flex h-full w-full items-center justify-center rounded-full bg-muted",
          className,
        )}
        {...props}
      />
    );
  },
);
AvatarFallback.displayName = "AvatarFallback";
