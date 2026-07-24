import { forwardRef } from "react";
import {
  Slider as AriaSlider,
  type SliderProps as AriaSliderProps,
  SliderFill,
  SliderThumb,
  SliderTrack,
} from "react-aria-components";
import { ariaClassName } from "../lib/react-aria.js";

export interface SliderProps
  extends Omit<
    AriaSliderProps<number[]>,
    "isDisabled" | "minValue" | "maxValue"
  > {
  disabled?: boolean;
  min?: number;
  max?: number;
}

export const Slider = forwardRef<HTMLDivElement, SliderProps>(
  ({ className, value, defaultValue, disabled, min, max, ...props }, ref) => {
    const thumbCount = value?.length ?? defaultValue?.length ?? 1;
    const thumbs = Array.from(
      { length: thumbCount },
      (_, index) => `thumb-${index + 1}`,
    );

    return (
      <AriaSlider
        ref={ref}
        className={ariaClassName(
          "relative flex w-full touch-none select-none items-center data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col",
          className,
        )}
        value={value}
        defaultValue={defaultValue}
        isDisabled={disabled}
        minValue={min}
        maxValue={max}
        {...props}
      >
        <SliderTrack className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2">
          <SliderFill className="absolute h-full bg-primary data-[orientation=vertical]:w-full" />
          {thumbs.map((thumbKey, index) => (
            <SliderThumb
              key={thumbKey}
              index={index}
              className="block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors outline-none data-[focus-visible]:ring-2 data-[focus-visible]:ring-ring data-[focus-visible]:ring-offset-2 data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
            />
          ))}
        </SliderTrack>
      </AriaSlider>
    );
  },
);
Slider.displayName = "Slider";
