"use client";
import { cva, type VariantProps } from "class-variance-authority";
import { motion, type HTMLMotionProps } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { springBouncy, springSnappy, useMagnetic, useReducedMotionSafe } from "@/lib/motion";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-semibold outline-none transition-colors focus-visible:shadow-[var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-ultra text-white hover:bg-[image:var(--grad-ultra)] active:bg-ultra-600",
        secondary: "border-2 border-ink bg-paper text-ink hover:bg-paper-2",
        soft: "bg-ultra-100 text-ultra-600 hover:bg-ultra-100/70",
        lime: "bg-lime text-lime-ink hover:brightness-95",
        ghost: "bg-transparent text-ink hover:bg-paper-2",
        danger: "bg-bad text-ink hover:brightness-95",
      },
      size: {
        sm: "h-9 min-w-9 px-4 text-[13px] [&_svg]:size-4",
        md: "h-11 min-w-11 px-5 text-[15px] [&_svg]:size-5",
        lg: "h-14 min-w-14 px-7 text-[17px] [&_svg]:size-5",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

// Legacy names used by pre-redesign pages (U06–U12 migrate them): mapped, not removed.
const LEGACY_VARIANT = { default: "primary", outline: "secondary", destructive: "danger" } as const;
const LEGACY_SIZE = { default: "md" } as const;

type NewVariant = NonNullable<VariantProps<typeof buttonVariants>["variant"]>;
type NewSize = NonNullable<VariantProps<typeof buttonVariants>["size"]>;

export interface ButtonProps extends Omit<HTMLMotionProps<"button">, "children"> {
  variant?: NewVariant | keyof typeof LEGACY_VARIANT;
  size?: NewSize | keyof typeof LEGACY_SIZE;
  loading?: boolean;
  /** Icon rendered before the label. */
  icon?: ReactNode;
  /** Pull toward the cursor within 80 px (primary CTAs only). */
  magnetic?: boolean;
  children?: ReactNode;
}

function Dots() {
  return (
    <span className="inline-flex items-center gap-1" role="status" aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="size-1.5 rounded-full bg-current"
          animate={{ y: [0, -4, 0] }}
          transition={{ duration: 0.6, repeat: Infinity, delay: i * 0.12, ease: "easeInOut" }}
        />
      ))}
    </span>
  );
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  icon,
  magnetic = false,
  className,
  children,
  disabled,
  type = "button",
  style,
  ...rest
}: ButtonProps) {
  const reduced = useReducedMotionSafe();
  const mag = useMagnetic<HTMLButtonElement>({ disabled: !magnetic });
  const v = (variant in LEGACY_VARIANT ? LEGACY_VARIANT[variant as keyof typeof LEGACY_VARIANT] : variant) as NewVariant;
  const s = (size in LEGACY_SIZE ? LEGACY_SIZE[size as keyof typeof LEGACY_SIZE] : size) as NewSize;
  /* eslint-disable react-hooks/refs -- motion values are ref-backed but safe to pass as style */
  return (
    <motion.button
      ref={mag.setRef}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant: v, size: s }), className)}
      style={{ ...(magnetic ? mag.style : null), ...style }}
      whileHover={reduced ? undefined : { scale: 1.04 }}
      whileTap={reduced ? undefined : { scale: 0.96 }}
      transition={springSnappy}
      {...rest}
    >
      {loading ? (
        <Dots />
      ) : (
        <>
          {icon ? (
            <motion.span
              className="inline-flex"
              whileHover={reduced ? undefined : { rotate: [0, 6, -6, 0] }}
              transition={springBouncy}
            >
              {icon}
            </motion.span>
          ) : null}
          {children}
        </>
      )}
    </motion.button>
  );
  /* eslint-enable react-hooks/refs */
}
